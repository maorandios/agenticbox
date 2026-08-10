"use client";

import * as React from "react";
import {
  Bold,
  ChevronDown,
  FileText,
  Forward,
  Italic,
  Link2,
  List,
  Paperclip,
  Plus,
  Reply,
  ReplyAll,
  Send,
  Sparkles,
  TextCursorInput,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { getDisplayInitials } from "@/lib/initials";
import { sleep } from "@/lib/sleep";
import {
  CURRENT_USER_ID,
  getMessagesForThread,
  getParticipant,
  getThreadSnapshot,
  messages as allMessages,
} from "@/mocks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useWorkspace,
  type ComposerMode,
} from "@/state/workspace";
import type { Participant } from "@/types/domain";

type RecipientField = "to" | "cc" | "bcc";

type ComposerAttachment = {
  id: string;
  fileName: string;
  sizeLabel: string;
  progress: number;
  cancelled?: boolean;
};

type PolishStyle =
  | "professional"
  | "shorter"
  | "friendlier"
  | "fixes";

const MODE_LABEL: Record<ComposerMode, string> = {
  reply: "השב",
  replyAll: "השב לכולם",
  forward: "העבר",
};

const MODE_ICON: Record<
  ComposerMode,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  reply: Reply,
  replyAll: ReplyAll,
  forward: Forward,
};

const POLISH_LABEL: Record<PolishStyle, string> = {
  professional: "מקצועי וברור",
  shorter: "קצר יותר",
  friendlier: "ידידותי יותר",
  fixes: "תקן שגיאות בלבד",
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} ב׳`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ק״ב`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} מ״ב`;
}

function buildImprovedText(text: string, style: PolishStyle) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  switch (style) {
    case "shorter":
      return trimmed
        .split(/\n+/)
        .filter(Boolean)
        .slice(0, 2)
        .join("\n");
    case "friendlier":
      return `היי,\n\n${trimmed}\n\nתודה רבה!`;
    case "fixes":
      return trimmed.replace(/\s+/g, " ").trim();
    default:
      return `שלום,\n\n${trimmed}\n\nבברכה`;
  }
}

function ToolIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function MiniPersonAvatar({
  person,
  size = "md",
}: {
  person: Participant;
  size?: "sm" | "md";
}) {
  const initials = getDisplayInitials(person.name) || person.initials || "?";
  const box = size === "sm" ? "size-6 text-[9px]" : "size-7 text-[10px]";

  if (person.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]",
          size === "sm" ? "size-6" : "size-7",
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-selected)] font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border)]",
        box,
      )}
    >
      {initials}
    </div>
  );
}

function RecipientHoverCard({ person }: { person: Participant }) {
  const [open, setOpen] = React.useState(false);

  return (
    <span
      className="relative inline-flex max-w-full"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className="max-w-full truncate text-start font-medium text-[var(--text-primary)] underline-offset-2 hover:underline"
        dir="ltr"
      >
        <bdi>{person.email}</bdi>
      </button>
      {open ? (
        <span
          role="tooltip"
          className="absolute top-full z-50 mt-1.5 min-w-[180px] max-w-[240px] rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-[var(--shadow-overlay)]"
          style={{ insetInlineStart: 0 }}
        >
          <span className="flex items-center gap-2.5" dir="rtl">
            <MiniPersonAvatar person={person} />
            <span className="min-w-0 text-start">
              <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                <bdi>{person.name || person.email}</bdi>
              </span>
              <span
                className="mt-0.5 block truncate text-[11.5px] text-[var(--text-muted)]"
                dir="ltr"
              >
                <bdi>{person.email}</bdi>
              </span>
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

const VISIBLE_RECIPIENTS = 3;

function collectCorrespondenceContacts(): Participant[] {
  const byId = new Map<string, Participant>();
  for (const m of allMessages) {
    for (const id of [m.fromId, ...m.toIds, ...(m.ccIds ?? [])]) {
      if (id === CURRENT_USER_ID) continue;
      const person = getParticipant(id);
      if (person) byId.set(person.id, person);
    }
  }
  return [...byId.values()];
}

function matchContacts(
  contacts: Participant[],
  query: string,
  excludeIds: Set<string>,
): Participant[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return contacts
    .filter((p) => !excludeIds.has(p.id))
    .filter(
      (p) =>
        p.email.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.company?.toLowerCase().includes(q) ?? false),
    )
    .slice(0, 6);
}

function RecipientChip({
  person,
  onRemove,
}: {
  person: Participant;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-[170px] items-center gap-0.5 rounded-[999px] border border-[var(--border)] bg-white py-px ps-1.5 pe-px text-[11px] leading-tight">
      <RecipientHoverCard person={person} />
      <button
        type="button"
        aria-label={`הסר את ${person.email}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="size-2.5" strokeWidth={1.75} />
      </button>
    </span>
  );
}

function MoreRecipientsPopover({
  people,
  onRemove,
}: {
  people: Participant[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (people.length === 0) setOpen(false);
  }, [people.length]);

  if (people.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-[999px] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
        >
          הצג עוד {people.length} מיילים
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[260px] p-1.5"
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ul className="max-h-[220px] space-y-0.5 overflow-y-auto">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-[var(--surface-subtle)]"
            >
              <MiniPersonAvatar person={person} size="sm" />
              <span className="min-w-0 flex-1 text-start">
                <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                  <bdi>{person.name || person.email}</bdi>
                </span>
                <span
                  className="block truncate text-[11px] text-[var(--text-muted)]"
                  dir="ltr"
                >
                  <bdi>{person.email}</bdi>
                </span>
              </span>
              <button
                type="button"
                aria-label={`הסר את ${person.email}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(person.id);
                }}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="size-3" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function RecipientAddInput({
  query,
  suggestions,
  onQueryChange,
  onSubmit,
  onCancel,
  onPick,
}: {
  query: string;
  suggestions: Participant[];
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPick: (person: Participant) => void;
}) {
  const [highlight, setHighlight] = React.useState(0);
  const ignoreBlurRef = React.useRef(false);

  React.useEffect(() => {
    setHighlight(0);
  }, [query]);

  return (
    <span className="relative inline-flex min-w-[120px] max-w-[220px] flex-col">
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && suggestions.length) {
            e.preventDefault();
            setHighlight((h) => (h + 1) % suggestions.length);
            return;
          }
          if (e.key === "ArrowUp" && suggestions.length) {
            e.preventDefault();
            setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (suggestions[highlight]) onPick(suggestions[highlight]);
            else onSubmit();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (ignoreBlurRef.current) {
              ignoreBlurRef.current = false;
              return;
            }
            if (query.trim()) onSubmit();
            else onCancel();
          }, 120);
        }}
        placeholder="הוסף מייל…"
        className="w-full min-w-[120px] bg-transparent px-0.5 py-0.5 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        dir="ltr"
        autoFocus
      />
      {suggestions.length > 0 ? (
        <ul
          className="absolute top-full z-50 mt-1 w-[240px] max-w-[min(240px,70vw)] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-overlay)]"
          style={{ insetInlineStart: 0 }}
          onMouseDown={() => {
            ignoreBlurRef.current = true;
          }}
        >
          {suggestions.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => onPick(person)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-start transition-colors",
                  index === highlight
                    ? "bg-[var(--surface-selected)]"
                    : "hover:bg-[var(--surface-subtle)]",
                )}
              >
                <MiniPersonAvatar person={person} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">
                    <bdi>{person.name || person.email}</bdi>
                  </span>
                  <span
                    className="block truncate text-[11px] text-[var(--text-muted)]"
                    dir="ltr"
                  >
                    <bdi>{person.email}</bdi>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

function RecipientSummaryRows({
  to,
  cc,
  bcc,
  emphasizeEmptyTo,
  addingField,
  recipientQuery,
  knownContacts,
  onOpenBcc,
  toTrailing,
  onRecipientQueryChange,
  onStartAdd,
  onCancelAdd,
  onSubmitAdd,
  onPickContact,
  onRemoveTo,
  onRemoveCc,
  onRemoveBcc,
}: {
  to: Participant[];
  cc: Participant[];
  bcc: Participant[];
  emphasizeEmptyTo?: boolean;
  addingField: RecipientField | null;
  recipientQuery: string;
  knownContacts: Participant[];
  onOpenBcc: () => void;
  toTrailing?: React.ReactNode;
  onRecipientQueryChange: (value: string) => void;
  onStartAdd: (field: RecipientField) => void;
  onCancelAdd: () => void;
  onSubmitAdd: () => void;
  onPickContact: (person: Participant) => void;
  onRemoveTo: (id: string) => void;
  onRemoveCc: (id: string) => void;
  onRemoveBcc: (id: string) => void;
}) {
  const showBccRow = bcc.length > 0 || addingField === "bcc";

  const renderPeople = (
    field: RecipientField,
    label: string,
    people: Participant[],
    onRemove: (id: string) => void,
  ) => {
    const isAdding = addingField === field;
    const visible = people.slice(0, VISIBLE_RECIPIENTS);
    const hidden = people.slice(VISIBLE_RECIPIENTS);
    const excludeIds = new Set(people.map((p) => p.id));
    const suggestions = isAdding
      ? matchContacts(knownContacts, recipientQuery, excludeIds)
      : [];

    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {people.length === 0 && !isAdding && field === "to" ? (
          <span
            className={cn(
              "text-[11px] text-[var(--text-muted)]",
              emphasizeEmptyTo && "font-medium text-[var(--text-primary)]",
            )}
          >
            אין נמענים
          </span>
        ) : null}
        {visible.map((person) => (
          <RecipientChip
            key={person.id}
            person={person}
            onRemove={() => onRemove(person.id)}
          />
        ))}
        <MoreRecipientsPopover people={hidden} onRemove={onRemove} />
        {isAdding ? (
          <RecipientAddInput
            query={recipientQuery}
            suggestions={suggestions}
            onQueryChange={onRecipientQueryChange}
            onSubmit={onSubmitAdd}
            onCancel={onCancelAdd}
            onPick={onPickContact}
          />
        ) : (
          <button
            type="button"
            aria-label={`הוסף ל${label}`}
            onClick={() => onStartAdd(field)}
            className="inline-flex size-5 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Plus className="size-3" strokeWidth={1.75} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-w-0 flex-1 space-y-1.5 text-start">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold text-[var(--text-secondary)]">
          אל
        </span>
        {renderPeople("to", "אל", to, onRemoveTo)}
        <div className="min-w-0 flex-1" aria-hidden />
        {toTrailing}
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
          לידיעה
        </span>
        {renderPeople("cc", "לידיעה", cc, onRemoveCc)}
        <div className="min-w-0 flex-1" aria-hidden />
        {!showBccRow ? (
          <button
            type="button"
            onClick={onOpenBcc}
            className="shrink-0 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
          >
            הוספת עותק נסתר
          </button>
        ) : null}
      </div>

      {showBccRow ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
            עותק נסתר
          </span>
          {renderPeople("bcc", "עותק נסתר", bcc, onRemoveBcc)}
        </div>
      ) : null}
    </div>
  );
}

function recipientSummary(to: Participant[], cc: Participant[]) {
  const format = (people: Participant[]) =>
    people.map((p) => p.email).join(", ");
  const toPart = to.length ? `אל ${format(to)}` : "אל —";
  const ccPart = cc.length ? `לידיעה ${format(cc)}` : "";
  return ccPart ? `${toPart}  |  ${ccPart}` : toPart;
}

function resolveRecipientsForMode(
  mode: ComposerMode,
  threadParticipantIds: string[],
  lastFromId?: string | null,
): { to: Participant[]; cc: Participant[]; bcc: Participant[] } {
  const me = getParticipant(CURRENT_USER_ID);
  const others = threadParticipantIds
    .filter((id) => id !== CURRENT_USER_ID)
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));

  if (mode === "forward") {
    return { to: [], cc: [], bcc: [] };
  }

  if (mode === "reply") {
    const targetId = lastFromId && lastFromId !== CURRENT_USER_ID
      ? lastFromId
      : others[0]?.id;
    const target = targetId ? getParticipant(targetId) : null;
    return {
      to: target ? [target] : [],
      cc: [],
      bcc: [],
    };
  }

  // replyAll
  const lastFrom =
    lastFromId && lastFromId !== CURRENT_USER_ID
      ? getParticipant(lastFromId)
      : null;
  const to = lastFrom
    ? [
        lastFrom,
        ...others.filter((p) => p.id !== lastFrom.id),
      ]
    : others;
  return {
    to,
    cc: me ? [me] : [],
    bcc: [],
  };
}

export function Composer({
  threadId,
  onSend,
}: {
  threadId: string;
  onSend: (payload: {
    body: string;
    mode: ComposerMode;
    toIds: string[];
    ccIds: string[];
  }) => void;
}) {
  const { state, dispatch } = useWorkspace();
  const snapshot = getThreadSnapshot(threadId);
  const messages = getMessagesForThread(threadId);
  const lastMessage = [...messages].reverse().find(Boolean);
  const lastInbound =
    [...messages].reverse().find((m) => !m.isOutbound) ?? lastMessage;

  const rootRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const saveTimerRef = React.useRef<number | null>(null);

  const [focused, setFocused] = React.useState(false);
  const [formatOpen, setFormatOpen] = React.useState(false);
  const [forwardSourceOpen, setForwardSourceOpen] = React.useState(false);
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([]);
  const [to, setTo] = React.useState<Participant[]>([]);
  const [cc, setCc] = React.useState<Participant[]>([]);
  const [bcc, setBcc] = React.useState<Participant[]>([]);
  const [recipientQuery, setRecipientQuery] = React.useState("");
  const [addingField, setAddingField] = React.useState<RecipientField | null>(null);
  const [draftStatus, setDraftStatus] = React.useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [polishState, setPolishState] = React.useState<
    "idle" | "working" | "done"
  >("idle");
  const [polishOriginal, setPolishOriginal] = React.useState<string | null>(null);
  const [polishImproved, setPolishImproved] = React.useState<string | null>(null);
  const [showingOriginal, setShowingOriginal] = React.useState(false);
  const [draftChipDismissed, setDraftChipDismissed] = React.useState(false);
  const [preferManualWrite, setPreferManualWrite] = React.useState(false);

  const mode = state.composer.mode;
  const text = state.composer.text;
  const drafting = Boolean(state.composer.drafting);
  const draftActionCount = state.composer.draftActionCount ?? 0;
  const hasContent = Boolean(text.trim()) || attachments.some((a) => !a.cancelled);
  const expanded = focused || hasContent || drafting;

  const syncEditorFromText = React.useCallback((value: string) => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerText === value) return;
    el.innerText = value;
  }, []);

  React.useEffect(() => {
    const resolved = resolveRecipientsForMode(
      mode,
      lastInbound
        ? // prefer thread participants from last message thread
          Array.from(
            new Set([
              lastInbound.fromId,
              ...lastInbound.toIds,
              ...(lastInbound.ccIds ?? []),
            ]),
          )
        : messages[0]
          ? [messages[0].fromId, ...messages[0].toIds]
          : [],
      lastInbound?.fromId ?? lastMessage?.fromId,
    );

    // Prefer full thread participants for replyAll when available
    if (mode === "replyAll") {
      const thread = getMessagesForThread(threadId);
      const ids = new Set<string>();
      for (const m of thread) {
        ids.add(m.fromId);
        m.toIds.forEach((id) => ids.add(id));
        (m.ccIds ?? []).forEach((id) => ids.add(id));
      }
      const fromThread = resolveRecipientsForMode(
        "replyAll",
        Array.from(ids),
        lastInbound?.fromId,
      );
      setTo(fromThread.to);
      setCc(fromThread.cc);
      setBcc([]);
      return;
    }

    setTo(resolved.to);
    setCc(resolved.cc);
    setBcc(resolved.bcc);
  }, [mode, threadId, lastInbound?.id, lastMessage?.id]);

  React.useEffect(() => {
    if (!state.composer.focusToken) return;
    setFocused(true);
    setAddingField(null);
    setDraftChipDismissed(false);
    setPreferManualWrite(false);
    window.setTimeout(() => editorRef.current?.focus(), 40);
  }, [state.composer.focusToken]);

  React.useEffect(() => {
    if (!drafting) return;
    let cancelled = false;
    (async () => {
      await sleep(900);
      if (cancelled) return;
      dispatch({ type: "COMPOSER_DRAFT_READY" });
    })();
    return () => {
      cancelled = true;
    };
  }, [drafting, dispatch, state.composer.focusToken]);

  React.useEffect(() => {
    if (drafting) return;
    syncEditorFromText(text);
  }, [text, drafting, syncEditorFromText]);

  React.useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = event.target as Element | null;
      if (!target) return;
      if (root.contains(target)) return;
      // Radix popover/menu content is portaled outside the composer root
      if (
        target.closest(
          "[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-dropdown-menu-content]",
        )
      ) {
        return;
      }
      setFormatOpen(false);
      if (!hasContent && !drafting) {
        setFocused(false);
        setAddingField(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded, hasContent, drafting]);

  React.useEffect(() => {
    if (!text.trim()) {
      setDraftStatus("idle");
      return;
    }
    setDraftStatus("saving");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "SAVE_DRAFT" });
      setDraftStatus("saved");
    }, 700);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [text, dispatch]);

  const setEditorText = (next: string) => {
    dispatch({ type: "SET_COMPOSER_TEXT", text: next });
    syncEditorFromText(next);
  };

  const onEditorInput = () => {
    const next = editorRef.current?.innerText ?? "";
    dispatch({ type: "SET_COMPOSER_TEXT", text: next });
    if (polishState === "done") {
      setPolishState("idle");
      setPolishOriginal(null);
      setShowingOriginal(false);
    }
  };

  const onEditorPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      event.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.src = url;
      img.alt = file.name || "תמונה מודבקת";
      img.className = "my-2 max-h-40 max-w-full rounded-[8px]";
      const selection = window.getSelection();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editorRef.current?.appendChild(img);
      }
      dispatch({
        type: "SET_COMPOSER_TEXT",
        text: editorRef.current?.innerText ?? text,
      });
      return;
    }

    const pasted = event.clipboardData.getData("text/plain");
    if (pasted && /^https?:\/\//i.test(pasted.trim())) {
      event.preventDefault();
      document.execCommand("createLink", false, pasted.trim());
    }
  };

  const applyFormat = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    onEditorInput();
  };

  const addLink = () => {
    const url = window.prompt("הזן קישור");
    if (!url) return;
    editorRef.current?.focus();
    document.execCommand("createLink", false, url);
    onEditorInput();
  };

  const removeRecipient = (field: RecipientField, id: string) => {
    if (field === "to") setTo((prev) => prev.filter((p) => p.id !== id));
    if (field === "cc") setCc((prev) => prev.filter((p) => p.id !== id));
    if (field === "bcc") setBcc((prev) => prev.filter((p) => p.id !== id));
  };

  const knownContacts = React.useMemo(() => collectCorrespondenceContacts(), []);

  const addRecipientPerson = (person: Participant) => {
    if (!addingField) return;
    if (addingField === "to")
      setTo((prev) => [...prev.filter((p) => p.id !== person.id), person]);
    if (addingField === "cc")
      setCc((prev) => [...prev.filter((p) => p.id !== person.id), person]);
    if (addingField === "bcc")
      setBcc((prev) => [...prev.filter((p) => p.id !== person.id), person]);
    setRecipientQuery("");
    setAddingField(null);
  };

  const addRecipientFromQuery = () => {
    const q = recipientQuery.trim();
    if (!q || !addingField) return;

    const exclude = new Set(
      (addingField === "to" ? to : addingField === "cc" ? cc : bcc).map(
        (p) => p.id,
      ),
    );
    const match =
      matchContacts(knownContacts, q, exclude).find(
        (p) =>
          p.email.toLowerCase() === q.toLowerCase() ||
          p.name.toLowerCase() === q.toLowerCase(),
      ) ??
      knownContacts.find(
        (p) =>
          !exclude.has(p.id) &&
          (p.email.toLowerCase() === q.toLowerCase() ||
            p.name.toLowerCase() === q.toLowerCase()),
      ) ??
      null;

    const person: Participant = match ?? {
      id: `custom-${q}`,
      name: q.includes("@") ? q.split("@")[0] : q,
      email: q.includes("@") ? q : `${q}@example.com`,
      initials: q.slice(0, 2).toUpperCase(),
    };

    addRecipientPerson(person);
  };

  const startUpload = (file: File) => {
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const item: ComposerAttachment = {
      id,
      fileName: file.name,
      sizeLabel: formatSize(file.size),
      progress: 0,
    };
    setAttachments((prev) => [...prev, item]);
    let progress = 0;
    const timer = window.setInterval(() => {
      progress += 18 + Math.round(Math.random() * 12);
      if (progress >= 100) {
        progress = 100;
        window.clearInterval(timer);
      }
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id && !a.cancelled ? { ...a, progress } : a,
        ),
      );
    }, 160);
  };

  const cancelAttachment = (id: string) => {
    setAttachments((prev) =>
      prev
        .map((a) => (a.id === id ? { ...a, cancelled: true, progress: 0 } : a))
        .filter((a) => a.id !== id),
    );
  };

  const clearDraft = () => {
    const previous = text;
    const previousAttachments = attachments;
    setEditorText("");
    setAttachments([]);
    setPolishState("idle");
    setPolishOriginal(null);
    dispatch({ type: "CLEAR_COMPOSER_DRAFT_CONTEXT" });
    toast("הטיוטה נמחקה", {
      action: {
        label: "ביטול",
        onClick: () => {
          setEditorText(previous);
          setAttachments(previousAttachments);
        },
      },
    });
    setFocused(false);
    setPreferManualWrite(false);
  };

  const runPolish = async (style: PolishStyle) => {
    if (!text.trim()) {
      // empty → draft reply
      setFocused(true);
      dispatch({
        type: "SET_COMPOSER_FROM_ACTIONS",
        text:
          snapshot?.primary.draftReply ??
          "שלום,\n\nתודה על העדכון. אחזור אליך עם אישור עד סוף היום.\n\nבברכה",
        actionCount: draftActionCount || 1,
      });
      return;
    }
    setPolishState("working");
    setPolishOriginal(text);
    await sleep(700);
    const improved = buildImprovedText(text, style);
    setEditorText(improved);
    setPolishImproved(improved);
    setPolishState("done");
    setShowingOriginal(false);
  };

  const send = () => {
    if (!hasContent) return;
    onSend({
      body: text.trim(),
      mode,
      toIds: to.map((p) => p.id),
      ccIds: cc.map((p) => p.id),
    });
    setEditorText("");
    setAttachments([]);
    setPolishState("idle");
    setPolishOriginal(null);
    dispatch({ type: "CLEAR_COMPOSER_DRAFT_CONTEXT" });
    setFocused(false);
    setAddingField(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      send();
    }
  };

  const summary = recipientSummary(to, cc);
  const aiLabel =
    polishState === "working"
      ? "משפר ניסוח…"
      : text.trim()
        ? "שפר ניסוח"
        : "נסח תשובה";

  const forwardSourceBody = lastInbound?.body ?? lastMessage?.body ?? "";
  const showNeedsYouEmpty =
    draftActionCount > 0 &&
    !text.trim() &&
    !drafting &&
    !preferManualWrite &&
    attachments.length === 0;
  const showDraftChip =
    draftActionCount > 0 && !draftChipDismissed && !showNeedsYouEmpty;

  const openComposer = () => {
    setFocused(true);
    window.setTimeout(() => editorRef.current?.focus(), 30);
  };

  return (
    <div className="sticky bottom-0 z-20 shrink-0 border-t border-[var(--border)] bg-white px-8 py-3">
      <div
        ref={rootRef}
        className={cn(
          "overflow-hidden rounded-[16px] border bg-white transition-[min-height,box-shadow,border-color] duration-[160ms] ease-out",
          expanded
            ? "min-h-[154px] border-[var(--border-strong)] shadow-[0_1px_0_rgba(33,37,41,0.04)]"
            : "h-[58px] border-[var(--border)] hover:border-[var(--border-strong)]",
        )}
        onFocusCapture={() => setFocused(true)}
      >
        {!expanded ? (
          <button
            type="button"
            className="flex h-[58px] w-full items-center gap-3 px-3.5 text-start"
            onClick={openComposer}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px]">
                {(() => {
                  const ModeIcon = MODE_ICON[mode];
                  return (
                    <ModeIcon
                      className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                      strokeWidth={1.75}
                    />
                  );
                })()}
                <span className="font-medium text-[var(--text-secondary)]">
                  {MODE_LABEL[mode]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[13px] leading-snug text-[var(--text-muted)]">
                {summary}
              </p>
            </div>
            <span className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--text-muted)]">
              <Paperclip className="size-[17px]" strokeWidth={1.75} />
            </span>
            <span className="inline-flex size-8 items-center justify-center rounded-full text-[var(--text-muted)] opacity-45">
              <Send className="size-[17px]" strokeWidth={1.75} />
            </span>
          </button>
        ) : (
          <div className="flex min-h-[154px] flex-col">
            <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-2">
              <RecipientSummaryRows
                to={to}
                cc={cc}
                bcc={bcc}
                emphasizeEmptyTo={mode === "forward"}
                addingField={addingField}
                recipientQuery={recipientQuery}
                knownContacts={knownContacts}
                onOpenBcc={() => {
                  setAddingField("bcc");
                  setRecipientQuery("");
                }}
                onRecipientQueryChange={setRecipientQuery}
                onStartAdd={(field) => {
                  setAddingField(field);
                  setRecipientQuery("");
                }}
                onCancelAdd={() => {
                  setAddingField(null);
                  setRecipientQuery("");
                }}
                onSubmitAdd={addRecipientFromQuery}
                onPickContact={addRecipientPerson}
                onRemoveTo={(id) => removeRecipient("to", id)}
                onRemoveCc={(id) => removeRecipient("cc", id)}
                onRemoveBcc={(id) => removeRecipient("bcc", id)}
                toTrailing={
                  <div
                    className="ms-2 flex shrink-0 items-center gap-0.5 self-center"
                    role="group"
                    aria-label="מצב תשובה"
                  >
                    {(
                      [
                        ["reply", Reply],
                        ["replyAll", ReplyAll],
                        ["forward", Forward],
                      ] as const
                    ).map(([key, Icon]) => {
                      const selected = mode === key;
                      return (
                        <Tooltip key={key}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={MODE_LABEL[key]}
                              aria-pressed={selected}
                              onClick={() =>
                                dispatch({
                                  type: "SET_COMPOSER_MODE",
                                  mode: key,
                                })
                              }
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium transition-colors",
                                selected
                                  ? "text-[var(--text-primary)]"
                                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                              )}
                            >
                              <Icon className="size-3" strokeWidth={1.75} />
                              {MODE_LABEL[key]}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {MODE_LABEL[key]}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    <span
                      className="mx-0.5 h-3.5 w-px shrink-0 bg-[var(--border)]"
                      aria-hidden
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="סגירה"
                          onClick={() => {
                            setFocused(false);
                            setAddingField(null);
                            setFormatOpen(false);
                            if (!hasContent) {
                              setPreferManualWrite(false);
                            }
                          }}
                          className="inline-flex size-7 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                        >
                          <X className="size-3" strokeWidth={1.75} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">סגירה</TooltipContent>
                    </Tooltip>
                  </div>
                }
              />

              <div className="mt-1 flex flex-wrap items-center gap-2">
                {draftStatus === "saving" ? (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    שומר…
                  </span>
                ) : draftStatus === "saved" ? (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    נשמר
                  </span>
                ) : null}

                {showDraftChip ? (
                  <span className="inline-flex max-w-[200px] items-center gap-1 rounded-[999px] bg-white py-0.5 ps-2 pe-0.5 text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--border)]">
                    <span className="truncate">
                      {draftActionCount === 1
                        ? "מתייחס לפעולה שנדרשה"
                        : `מתייחס ל־${draftActionCount} פעולות`}
                    </span>
                    <button
                      type="button"
                      aria-label="הסתר תזכורת"
                      onClick={() => setDraftChipDismissed(true)}
                      className="inline-flex size-5 items-center justify-center rounded-full hover:bg-[var(--surface-hover)]"
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </button>
                  </span>
                ) : null}
              </div>
            </div>

            {mode === "forward" ? (
              <div className="px-3.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setForwardSourceOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      forwardSourceOpen && "rotate-180",
                    )}
                    strokeWidth={1.75}
                  />
                  ההודעה המקורית
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-[180ms] ease-out",
                    forwardSourceOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      className="mt-1.5 border-r-2 border-[var(--border)] pr-3 text-[12.5px] leading-5 text-[var(--text-secondary)] whitespace-pre-wrap"
                      dir="auto"
                    >
                      {forwardSourceBody}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="relative flex min-h-0 flex-1 flex-col px-3.5 pt-2">
              {drafting ? (
                <div className="flex min-h-[86px] flex-1 items-center text-[15px] text-[var(--text-muted)]">
                  מנסח תשובה…
                </div>
              ) : showNeedsYouEmpty ? (
                <div className="flex min-h-[86px] flex-1 flex-col items-start justify-center gap-3 py-1">
                  <p className="text-[14px] leading-snug text-[var(--text-secondary)]">
                    {draftActionCount === 1
                      ? "יש פעולה שדורשת ממך תשובה."
                      : `יש ${draftActionCount} פעולות שדורשות ממך תשובה.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void runPolish("professional");
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[999px] bg-[var(--action-primary)] px-3.5 text-[13px] font-medium text-white hover:bg-[var(--action-primary-hover)]"
                  >
                    <Sparkles className="size-3.5" strokeWidth={1.75} />
                    נסח תשובה
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreferManualWrite(true);
                      window.setTimeout(() => editorRef.current?.focus(), 30);
                    }}
                    className="text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >
                    או כתוב בעצמך…
                  </button>
                </div>
              ) : (
                <div
                  ref={editorRef}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="כתיבת תשובה"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={onEditorInput}
                  onPaste={onEditorPaste}
                  onKeyDown={onKeyDown}
                  data-placeholder="כתיבת תשובה…"
                  className={cn(
                    "composer-editor bidi-content max-h-[168px] min-h-[86px] flex-1 overflow-y-auto text-[15px] leading-[1.65] outline-none",
                  )}
                  style={{ unicodeBidi: "plaintext" }}
                  dir="auto"
                />
              )}
            </div>

            {attachments.length > 0 ? (
              <ul className="space-y-0.5 px-3.5 pt-1">
                {attachments.map((file) => (
                  <li
                    key={file.id}
                    className="flex h-8 items-center gap-2 text-[12px]"
                  >
                    <FileText
                      className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                      <bdi>{file.fileName}</bdi>
                      <span className="text-[var(--text-muted)]">
                        {" "}
                        · {file.sizeLabel}
                      </span>
                    </span>
                    {file.progress < 100 ? (
                      <span className="shrink-0 text-[var(--text-muted)]">
                        {file.progress}%
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label="הסר קובץ"
                      onClick={() => cancelAttachment(file.id)}
                      className="inline-flex size-7 items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                    >
                      <X className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {polishState === "done" ? (
              <div className="flex flex-wrap items-center gap-2 px-3.5 pt-1.5 text-[12px] text-[var(--text-secondary)]">
                <span>הניסוח שופר</span>
                <button
                  type="button"
                  className="font-medium hover:text-[var(--text-primary)]"
                  onClick={() => {
                    if (!polishOriginal || !polishImproved) return;
                    if (showingOriginal) {
                      setShowingOriginal(false);
                      setEditorText(polishImproved);
                    } else {
                      setShowingOriginal(true);
                      setEditorText(polishOriginal);
                    }
                  }}
                >
                  {showingOriginal ? "הצג משופר" : "הצג מקור"}
                </button>
                <button
                  type="button"
                  className="font-medium hover:text-[var(--text-primary)]"
                  onClick={() => {
                    if (polishOriginal) setEditorText(polishOriginal);
                    setPolishState("idle");
                    setPolishOriginal(null);
                    setPolishImproved(null);
                    setShowingOriginal(false);
                  }}
                >
                  ביטול
                </button>
              </div>
            ) : null}

            {formatOpen ? (
              <div className="mx-3.5 mt-1.5 flex items-center gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1">
                <ToolIconButton label="מודגש" onClick={() => applyFormat("bold")}>
                  <Bold className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>
                <ToolIconButton label="נטוי" onClick={() => applyFormat("italic")}>
                  <Italic className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>
                <ToolIconButton
                  label="קו תחתון"
                  onClick={() => applyFormat("underline")}
                >
                  <Underline className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>
                <ToolIconButton
                  label="רשימה"
                  onClick={() => applyFormat("insertUnorderedList")}
                >
                  <List className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>
                <ToolIconButton label="קישור" onClick={addLink}>
                  <Link2 className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>
              </div>
            ) : null}

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-transparent px-2.5 pt-1.5 pb-2">
              <div className="flex items-center gap-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    files.forEach(startUpload);
                    e.target.value = "";
                  }}
                />
                <ToolIconButton
                  label="צרף קובץ"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>
                <ToolIconButton
                  label="עיצוב טקסט"
                  onClick={() => setFormatOpen((v) => !v)}
                >
                  <TextCursorInput className="size-[17px]" strokeWidth={1.75} />
                </ToolIconButton>

                {!showNeedsYouEmpty ? (
                  text.trim() ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={polishState === "working" || drafting}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                        >
                          <Sparkles className="size-[17px]" strokeWidth={1.75} />
                          {aiLabel}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {(Object.keys(POLISH_LABEL) as PolishStyle[]).map(
                          (key) => (
                            <DropdownMenuItem
                              key={key}
                              onSelect={() => {
                                void runPolish(key);
                              }}
                            >
                              {POLISH_LABEL[key]}
                            </DropdownMenuItem>
                          ),
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      type="button"
                      disabled={polishState === "working" || drafting}
                      onClick={() => {
                        void runPolish("professional");
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                    >
                      <Sparkles className="size-[17px]" strokeWidth={1.75} />
                      {aiLabel}
                    </button>
                  )
                ) : null}

                {hasContent ? (
                  <ToolIconButton label="מחק טיוטה" onClick={clearDraft}>
                    <Trash2 className="size-[17px]" strokeWidth={1.75} />
                  </ToolIconButton>
                ) : null}
              </div>

              <button
                type="button"
                disabled={!hasContent || drafting}
                onClick={send}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-[999px] px-4 text-[13px] font-medium transition-colors",
                  hasContent && !drafting
                    ? "bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]"
                    : "bg-[var(--surface-selected)] text-[var(--text-muted)]",
                )}
              >
                <Send className="size-[17px]" strokeWidth={1.75} />
                שליחה
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
