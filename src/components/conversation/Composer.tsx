"use client";

import * as React from "react";
import {
  Bold,
  ChevronDown,
  Forward,
  Italic,
  Paperclip,
  Plus,
  Reply,
  ReplyAll,
  Send,
  TextCursorInput,
  Trash2,
  Underline,
  UnfoldVertical,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { getDisplayInitials } from "@/lib/initials";
import { sleep } from "@/lib/sleep";
import { useMailUi } from "@/lib/email-data-source/mail-ui-context";
import {
  CURRENT_USER_ID,
  getMessagesForThread,
  getParticipant,
  messages as allMessages,
} from "@/mocks";
import { ComposerAttachmentCard } from "@/components/conversation/ComposerAttachmentCard";
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

const READ_ONLY_HINT = "פעולה זו אינה זמינה במצב קריאה בלבד";

type RecipientField = "to" | "cc" | "bcc";

type ComposerAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeLabel: string;
  progress: number;
  cancelled?: boolean;
};

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

const TEXT_COLORS = [
  { id: "black", label: "שחור", value: "#212529" },
  { id: "blue", label: "כחול", value: "#2563eb" },
  { id: "red", label: "אדום", value: "#dc2626" },
  { id: "yellow", label: "צהוב", value: "#ca8a04" },
  { id: "green", label: "ירוק", value: "#16a34a" },
] as const;

const VISIBLE_ATTACHMENT_CARDS = 5;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} ב׳`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ק״ב`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} מ״ב`;
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
        placeholder="הוסף כתובת מייל"
        className="w-full min-w-[140px] bg-transparent px-0.5 py-0.5 text-start text-[11px] text-[var(--text-primary)] outline-none placeholder:text-start placeholder:text-[var(--text-muted)]"
        dir="rtl"
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

function formatRecipientEmails(people: Participant[]) {
  return people.map((p) => p.email).join(", ");
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

function ReadOnlyComposer() {
  return (
    <div className="sticky bottom-0 z-20 shrink-0 border-t border-[var(--border)] bg-white">
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            aria-disabled="true"
            className="flex h-[58px] w-full cursor-not-allowed items-center gap-3 px-8 opacity-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px]">
                <Reply
                  className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                  strokeWidth={1.75}
                />
                <span className="font-medium text-[var(--text-secondary)]">
                  השב
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                מצב קריאה בלבד — לא ניתן לשלוח הודעות
              </p>
            </div>
            <span className="inline-flex h-9 items-center gap-2 rounded-[999px] bg-white px-4 text-[13px] font-medium text-[var(--text-muted)] ring-1 ring-[var(--border)]">
              <Send className="size-[17px]" strokeWidth={1.75} />
              שליחה
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{READ_ONLY_HINT}</TooltipContent>
      </Tooltip>
    </div>
  );
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
  const { writeActionsDisabled } = useMailUi();
  if (writeActionsDisabled) {
    return <ReadOnlyComposer />;
  }
  return <ComposerInteractive threadId={threadId} onSend={onSend} />;
}

function ComposerInteractive({
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
  const [composerTall, setComposerTall] = React.useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = React.useState(false);
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
        setComposerTall(false);
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

  const applyTextColor = (color: string) => {
    editorRef.current?.focus();
    document.execCommand("foreColor", false, color);
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
      mimeType: file.type || "application/octet-stream",
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
    setAttachments((prev) => {
      const next = prev
        .map((a) => (a.id === id ? { ...a, cancelled: true, progress: 0 } : a))
        .filter((a) => a.id !== id);
      if (next.length <= VISIBLE_ATTACHMENT_CARDS) {
        setAttachmentsExpanded(false);
      }
      return next;
    });
  };

  const clearDraft = () => {
    const previous = text;
    const previousAttachments = attachments;
    setEditorText("");
    setAttachments([]);
    setAttachmentsExpanded(false);
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
    setComposerTall(false);
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
    setAttachmentsExpanded(false);
    dispatch({ type: "CLEAR_COMPOSER_DRAFT_CONTEXT" });
    setFocused(false);
    setAddingField(null);
    setComposerTall(false);
    setFormatOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      send();
    }
  };

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
    <div className="sticky bottom-0 z-20 shrink-0 border-t border-[var(--border)] bg-white">
      <div
        ref={rootRef}
        className={cn(
          "overflow-hidden bg-white transition-[min-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          expanded
            ? composerTall
              ? "min-h-[546px]"
              : "min-h-[251px]"
            : "min-h-[58px]",
        )}
        onFocusCapture={() => setFocused(true)}
      >
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            expanded ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
          )}
          aria-hidden={expanded}
        >
          <div className="min-h-0 overflow-hidden">
            <button
              type="button"
              tabIndex={expanded ? -1 : 0}
              className="flex h-[58px] w-full items-center gap-3 px-8 text-start"
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
                <div className="mt-0.5 flex min-w-0 items-baseline gap-x-3 overflow-hidden text-[12.5px] leading-snug text-[var(--text-muted)]">
                  <p className="min-w-0 truncate">
                    <span className="font-medium text-[var(--text-secondary)]">
                      אל
                    </span>
                    <span className="mx-1.5">
                      {to.length ? (
                        <bdi>{formatRecipientEmails(to)}</bdi>
                      ) : (
                        "—"
                      )}
                    </span>
                  </p>
                  {cc.length > 0 ? (
                    <p className="min-w-0 truncate">
                      <span className="font-medium text-[var(--text-secondary)]">
                        לידיעה
                      </span>
                      <span className="mx-1.5">
                        <bdi>{formatRecipientEmails(cc)}</bdi>
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
            </button>
          </div>
        </div>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
          aria-hidden={!expanded}
        >
          <div
            className="min-h-0 overflow-hidden"
            {...(!expanded ? { inert: true } : {})}
          >
          <div
            className={cn(
              "flex flex-col transition-[min-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              composerTall ? "min-h-[546px]" : "min-h-[251px]",
            )}
          >
            <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-8 py-2">
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
                  </div>
                }
              />

              {showDraftChip ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex max-w-[200px] items-center gap-1 rounded-[999px] bg-white py-0.5 ps-2 pe-0.5 text-[11px] text-[var(--text-secondary)] ring-1 ring-[var(--border)]">
                    <span className="truncate">
                      {draftActionCount === 1
                        ? "מתייחס לפעולה שנדרשה"
                        : `מתייחס ל־${draftActionCount} פעולות`}
                    </span>
                    <button
                      type="button"
                      aria-label="הסתר"
                      onClick={() => setDraftChipDismissed(true)}
                      className="inline-flex size-5 items-center justify-center rounded-full hover:bg-[var(--surface-hover)]"
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </button>
                  </span>
                </div>
              ) : null}
            </div>

            {mode === "forward" ? (
              <div className="px-8 pt-1.5">
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

            <div className="relative flex min-h-0 flex-1 flex-col px-8 pt-2.5 pb-2">
              {drafting ? (
                <div
                  className={cn(
                    "flex flex-1 items-center text-[15px] text-[var(--text-muted)] transition-[min-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    composerTall ? "min-h-[364px]" : "min-h-[140px]",
                  )}
                >
                  מנסח תשובה…
                </div>
              ) : showNeedsYouEmpty ? (
                <div
                  className={cn(
                    "flex flex-1 flex-col items-start justify-center gap-3 py-1 transition-[min-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    composerTall ? "min-h-[364px]" : "min-h-[140px]",
                  )}
                >
                  <p className="text-[14px] leading-snug text-[var(--text-secondary)]">
                    {draftActionCount === 1
                      ? "יש פעולה שדורשת ממך תשובה."
                      : `יש ${draftActionCount} פעולות שדורשות ממך תשובה.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPreferManualWrite(true);
                      window.setTimeout(() => editorRef.current?.focus(), 30);
                    }}
                    className="inline-flex h-9 items-center rounded-[999px] bg-[var(--action-primary)] px-3.5 text-[13px] font-medium text-white hover:bg-[var(--action-primary-hover)]"
                  >
                    כתוב תשובה
                  </button>
                </div>
              ) : (
                <div
                  ref={editorRef}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="כתבו את תוכן המייל כאן"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={onEditorInput}
                  onPaste={onEditorPaste}
                  onKeyDown={onKeyDown}
                  data-placeholder="כתבו את תוכן המייל כאן"
                  className={cn(
                    "composer-editor flex-1 overflow-y-auto text-start text-[15px] leading-[1.65] outline-none transition-[min-height,max-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    composerTall
                      ? "max-h-[624px] min-h-[364px]"
                      : "max-h-[273px] min-h-[140px]",
                  )}
                  dir="rtl"
                />
              )}

              {attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <ul
                    className={cn(
                      "flex gap-2.5",
                      attachmentsExpanded
                        ? "flex-wrap"
                        : "flex-nowrap",
                    )}
                  >
                    {(attachmentsExpanded
                      ? attachments
                      : attachments.slice(0, VISIBLE_ATTACHMENT_CARDS)
                    ).map((file) => (
                      <li key={file.id} className="shrink-0 pt-1.5 pe-1.5">
                        <ComposerAttachmentCard
                          fileName={file.fileName}
                          mimeType={file.mimeType}
                          sizeLabel={file.sizeLabel}
                          progress={file.progress}
                          onRemove={() => cancelAttachment(file.id)}
                        />
                      </li>
                    ))}
                  </ul>
                  {attachments.length > VISIBLE_ATTACHMENT_CARDS ? (
                    <button
                      type="button"
                      onClick={() => setAttachmentsExpanded((v) => !v)}
                      className="shrink-0 text-[11.5px] font-medium whitespace-nowrap text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
                    >
                      {attachmentsExpanded
                        ? "הסתר קבצים"
                        : `הצג את כל הקבצים (${attachments.length})`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-8 py-2">
              <div className="flex items-center gap-1">
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

                <div
                  className={cn(
                    "flex items-center overflow-hidden transition-[background-color,box-shadow] duration-150",
                    formatOpen
                      ? "rounded-full bg-white pe-1.5 ps-1 ring-1 ring-[var(--border)]"
                      : "rounded-[8px]",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="עיצוב טקסט"
                        aria-pressed={formatOpen}
                        onClick={() => setFormatOpen((v) => !v)}
                        className={cn(
                          "inline-flex size-8 shrink-0 items-center justify-center transition-colors",
                          formatOpen
                            ? "rounded-full bg-[var(--action-primary)] text-white"
                            : "rounded-[8px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                        )}
                      >
                        <TextCursorInput
                          className="size-[17px]"
                          strokeWidth={1.75}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">עיצוב טקסט</TooltipContent>
                  </Tooltip>

                  <div
                    className={cn(
                      "grid transition-[grid-template-columns] duration-200 ease-out",
                      formatOpen ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                      <button
                        type="button"
                        aria-label="מודגש"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFormat("bold")}
                        className="inline-flex size-7 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Bold className="size-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        aria-label="נטוי"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFormat("italic")}
                        className="inline-flex size-7 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Italic className="size-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        aria-label="קו תחתון"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFormat("underline")}
                        className="inline-flex size-7 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      >
                        <Underline className="size-3.5" strokeWidth={1.75} />
                      </button>
                      <span
                        className="mx-0.5 h-3.5 w-px shrink-0 bg-[var(--border)]"
                        aria-hidden
                      />
                      {TEXT_COLORS.map((color) => (
                        <button
                          key={color.id}
                          type="button"
                          aria-label={color.label}
                          title={color.label}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyTextColor(color.value)}
                          className="inline-flex size-7 items-center justify-center rounded-full hover:bg-[var(--surface-hover)]"
                        >
                          <span
                            className={cn(
                              "size-3.5 rounded-full ring-1",
                              color.id === "black"
                                ? "ring-[var(--border-strong)]"
                                : "ring-[var(--border)]",
                            )}
                            style={{ backgroundColor: color.value }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <ToolIconButton
                  label={composerTall ? "הקטן אזור כתיבה" : "הגדל אזור כתיבה"}
                  onClick={() => setComposerTall((v) => !v)}
                >
                  <UnfoldVertical
                    className={cn(
                      "size-[17px] transition-transform duration-200",
                      composerTall && "rotate-180",
                    )}
                    strokeWidth={1.75}
                  />
                </ToolIconButton>

                {hasContent ? (
                  <ToolIconButton label="מחק טיוטה" onClick={clearDraft}>
                    <Trash2 className="size-[17px]" strokeWidth={1.75} />
                  </ToolIconButton>
                ) : null}
              </div>

              <div className="flex items-center gap-2.5">
                {draftStatus === "saving" ? (
                  <span className="inline-flex items-center gap-1.5 text-[10.8px] text-[var(--text-secondary)]">
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-[#e67e22]"
                      aria-hidden
                    />
                    שומר שינויים
                  </span>
                ) : draftStatus === "saved" ? (
                  <span className="inline-flex items-center gap-1.5 text-[10.8px] text-[var(--text-secondary)]">
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-[#2f9e44]"
                      aria-hidden
                    />
                    נשמר כטיוטא
                  </span>
                ) : null}

                <button
                  type="button"
                  disabled={!hasContent || drafting}
                  onClick={send}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-[999px] px-4 text-[13px] font-medium transition-colors",
                    hasContent && !drafting
                      ? "bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]"
                      : "bg-white text-[var(--text-muted)] ring-1 ring-[var(--border)]",
                  )}
                >
                  <Send className="size-[17px]" strokeWidth={1.75} />
                  שליחה
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
