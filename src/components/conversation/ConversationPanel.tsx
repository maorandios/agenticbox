"use client";

import * as React from "react";
import {
  Bold,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  Eye,
  FileText,
  ListPlus,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatMessageDateTime, formatThreadTime } from "@/lib/format";
import { getDisplayInitials } from "@/lib/initials";
import {
  CURRENT_USER_ID,
  getAttachmentsForMessage,
  getMessagesForThread,
  getParticipant,
  getThread,
  getThreadSnapshot,
} from "@/mocks";
import { ThreadHeader } from "@/components/conversation/ThreadHeader";
import { IconButton } from "@/components/shared/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/state/workspace";
import type { Attachment, Message, Participant } from "@/types/domain";

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("לא ניתן להעתיק");
  }
}

function PersonAvatar({
  person,
  dark = false,
}: {
  person?: Participant | null;
  dark?: boolean;
}) {
  const initials = person
    ? getDisplayInitials(person.name) || person.initials
    : "?";

  if (person?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt={person.name}
        className="size-9 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
        dark
          ? "bg-white/12 text-white"
          : "bg-[#ECECE8] text-[#363633] ring-1 ring-[#E7E7E1]",
      )}
    >
      {initials}
    </div>
  );
}

function QuotedBlock({
  text,
  dark,
}: {
  text: string;
  dark: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 text-[12px] transition-colors duration-[130ms]",
          dark
            ? "text-white/65 hover:text-white"
            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
        )}
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-[180ms] ease-out",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
        />
        {open ? "הסתר טקסט מצוטט" : "הצג טקסט מצוטט"}
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[180ms] ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "mt-2 border-r-2 pr-3 text-[13px] leading-6",
              dark
                ? "border-white/25 text-white/65"
                : "border-[#E7E7E1] text-[var(--text-secondary)]",
            )}
            dir="auto"
          >
            <span className="bidi-content whitespace-pre-wrap">{text}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentRow({
  file,
  dark,
}: {
  file: Attachment;
  dark: boolean;
}) {
  const canPreview =
    file.mimeType.startsWith("image/") || file.mimeType === "application/pdf";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[10px] px-2.5 py-2",
        dark ? "bg-white/8" : "bg-[#ECECE8]",
      )}
    >
      <FileText
        className={cn("size-4 shrink-0", dark ? "text-white/80" : "text-[#363633]")}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[12.5px] font-medium",
            dark ? "text-white" : "text-[#363633]",
          )}
        >
          <bdi>{file.fileName}</bdi>
        </div>
        <div className={cn("text-[11px]", dark ? "text-white/65" : "text-[var(--text-muted)]")}>
          {file.sizeLabel}
        </div>
      </div>
      {canPreview ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="תצוגה מקדימה"
              onClick={() => toast("תצוגה מקדימה מדומה")}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-[8px]",
                dark ? "text-white/75 hover:bg-white/10" : "text-[var(--text-secondary)] hover:bg-black/5",
              )}
            >
              <Eye className="size-3.5" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>תצוגה מקדימה</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="הורדה"
            onClick={() => toast(`הורדה מדומה — ${file.fileName}`)}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-[8px]",
              dark ? "text-white/75 hover:bg-white/10" : "text-[var(--text-secondary)] hover:bg-black/5",
            )}
          >
            <Download className="size-3.5" strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent>הורדה</TooltipContent>
      </Tooltip>
    </div>
  );
}

function MessageBubble({
  message,
  highlighted,
}: {
  message: Message;
  highlighted: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const sender = getParticipant(message.fromId);
  const toPeople = message.toIds
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));
  const ccPeople = (message.ccIds ?? [])
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));
  const replyTo = message.replyToId ? getParticipant(message.replyToId) : null;
  const attachments = getAttachmentsForMessage(message.id);
  const mine = message.isOutbound;
  const dark = !mine;
  const fullDate = formatMessageDateTime(message.sentAt);

  return (
    <article
      id={`message-${message.id}`}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
      dir="ltr"
    >
      <div
        className={cn(
          "group relative flex max-w-[min(70%,660px)] gap-2.5",
          mine ? "flex-row-reverse" : "flex-row",
        )}
      >
        <PersonAvatar person={sender} dark={dark} />

        <div
          className={cn(
            "relative w-fit max-w-full rounded-[16px] px-[18px] py-4 transition-[box-shadow] duration-[140ms]",
            mine
              ? "border border-[#E7E7E1] bg-[#F6F6F3] text-[#363633]"
              : "bg-[#3F4548] text-[#FCFCF8]",
            highlighted && "ring-2 ring-[#A8A8A1] ring-offset-2",
          )}
        >
          {/* Hover toolbar — outer top corner */}
          <div
            className={cn(
              "pointer-events-none absolute -top-3 z-10 flex items-center gap-0.5 rounded-[10px] border border-[#E7E7E1] bg-white p-0.5 opacity-0 shadow-[0_4px_14px_rgba(33,37,41,0.08)] transition-opacity duration-[130ms]",
              "group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
              mine ? "end-0" : "start-0",
            )}
            dir="rtl"
          >
            {(
              [
                {
                  label: "השב",
                  icon: Reply,
                  onClick: () => toast("מצב השב (מדומה)"),
                },
                {
                  label: "השב לכולם",
                  icon: ReplyAll,
                  onClick: () => toast("מצב השב לכולם (מדומה)"),
                },
                {
                  label: "הוסף למשימות",
                  icon: ListPlus,
                  onClick: () => toast.success("נוסף למשימות (מדומה)"),
                },
                {
                  label: "העתק",
                  icon: Copy,
                  onClick: () => copyText(message.body, "תוכן ההודעה הועתק"),
                },
              ] as const
            ).map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={item.label}
                    onClick={item.onClick}
                    className="inline-flex size-7 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    <item.icon className="size-4" strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{item.label}</TooltipContent>
              </Tooltip>
            ))}

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="פעולות AI"
                      className="inline-flex size-7 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    >
                      <Sparkles className="size-4" strokeWidth={1.75} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>פעולות AI</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuItem onSelect={() => toast("נסח תשובה (מדומה)")}>
                  נסח תשובה
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast("סכם הודעה (מדומה)")}>
                  סכם הודעה
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast("חלץ פעולה (מדומה)")}>
                  חלץ פעולה
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast("הסבר בהקשר השרשור (מדומה)")}>
                  הסבר בהקשר השרשור
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="עוד"
                      className="inline-flex size-7 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                    >
                      <MoreHorizontal className="size-4" strokeWidth={1.75} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>עוד</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => toast("העבר (מדומה)")}>העבר</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => toast("מחק (מדומה)")}>מחק</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1" dir="rtl">
            <span
              className={cn(
                "text-[13.5px] font-semibold",
                dark ? "text-[#FCFCF8]" : "text-[#363633]",
              )}
            >
              <bdi>{sender?.name ?? "לא ידוע"}</bdi>
            </span>
            {sender?.email ? (
              <span
                className={cn(
                  "group/mail inline-flex items-center gap-1 text-[11.5px]",
                  dark ? "text-white/65" : "text-[var(--text-muted)]",
                )}
                dir="ltr"
              >
                <bdi>{sender.email}</bdi>
                <button
                  type="button"
                  aria-label="העתק כתובת מייל"
                  onClick={() => copyText(sender.email, "כתובת המייל הועתקה")}
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-[4px] opacity-70 transition-opacity hover:opacity-100",
                    dark ? "hover:bg-white/10" : "hover:bg-black/5",
                  )}
                >
                  <Copy className="size-3" strokeWidth={1.75} />
                </button>
              </span>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[11.5px]",
                    dark ? "text-white/65" : "text-[var(--text-muted)]",
                  )}
                >
                  <Clock3 className="size-3" strokeWidth={1.75} />
                  <time dateTime={message.sentAt}>{fullDate}</time>
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatThreadTime(message.sentAt)}</TooltipContent>
            </Tooltip>
            <button
              type="button"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((v) => !v)}
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-[4px]",
                dark
                  ? "text-white/65 hover:bg-white/10 hover:text-white"
                  : "text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-secondary)]",
              )}
              aria-label="פרטי הודעה"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-[180ms] ease-out",
                  detailsOpen && "rotate-180",
                )}
                strokeWidth={1.75}
              />
            </button>
          </div>

          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-[180ms] ease-out",
              detailsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                className={cn(
                  "mb-3 space-y-1 rounded-[10px] px-2.5 py-2 text-[12px]",
                  dark ? "bg-white/8 text-white/65" : "bg-[#ECECE8] text-[var(--text-secondary)]",
                )}
                dir="rtl"
              >
                <div>
                  <span className="font-medium">מאת: </span>
                  <bdi>{sender?.name}</bdi>{" "}
                  <span dir="ltr">&lt;{sender?.email}&gt;</span>
                </div>
                <div>
                  <span className="font-medium">אל: </span>
                  {toPeople.map((p) => p.name).join(" · ") || "—"}
                </div>
                {ccPeople.length > 0 ? (
                  <div>
                    <span className="font-medium">עותק: </span>
                    {ccPeople.map((p) => p.name).join(" · ")}
                  </div>
                ) : null}
                {replyTo ? (
                  <div>
                    <span className="font-medium">Reply-To: </span>
                    <bdi>{replyTo.name}</bdi>{" "}
                    <span dir="ltr">&lt;{replyTo.email}&gt;</span>
                  </div>
                ) : null}
                <div>
                  <span className="font-medium">תאריך: </span>
                  {fullDate}
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "whitespace-pre-wrap text-[15px] leading-[1.7]",
              dark && "[&_a]:text-white [&_a]:underline-offset-2 hover:[&_a]:underline",
            )}
            dir="auto"
          >
            <span className="bidi-content">{message.body}</span>
          </div>

          {message.signature ? (
            <QuotedBlock text={message.signature} dark={dark} />
          ) : null}
          {message.quotedText ? <QuotedBlock text={message.quotedText} dark={dark} /> : null}

          {attachments.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {attachments.map((file) => (
                <AttachmentRow key={file.id} file={file} dark={dark} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 180)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className="min-h-[72px] max-h-[180px] w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-6 outline-none transition-[height] duration-[160ms] ease-out placeholder:text-[var(--text-muted)]"
      dir="auto"
    />
  );
}

export function ConversationPanel({ threadId }: { threadId: string }) {
  const thread = getThread(threadId);
  const { state, dispatch } = useWorkspace();
  const messages = getMessagesForThread(threadId);
  const snapshot = getThreadSnapshot(threadId);

  React.useEffect(() => {
    if (!state.highlightedMessageId) return;
    const el = document.getElementById(`message-${state.highlightedMessageId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => {
      dispatch({ type: "HIGHLIGHT_MESSAGE", messageId: null });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [state.highlightedMessageId, dispatch]);

  if (!thread) return null;

  const toPeople = thread.participantIds
    .filter((id) => id !== CURRENT_USER_ID)
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));

  const me = getParticipant(CURRENT_USER_ID);
  const ccPeople = me ? [me] : [];

  const modeLabel =
    state.composer.mode === "forward"
      ? "מעביר"
      : state.composer.mode === "reply"
        ? "משיב"
        : "משיב לכולם";

  const toNames = toPeople.map((p) => p.name.split(" ")[0]).join(" ו");
  const composerRecipients = `אל ${toNames || "נמענים"}${
    ccPeople.length ? ` · עותק ${ccPeople[0].name.split(" ")[0]}` : ""
  }`;

  const draftActionCount = state.composer.draftActionCount ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <ThreadHeader thread={thread} />

      <div className="thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-8 py-5">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            highlighted={state.highlightedMessageId === message.id}
          />
        ))}
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-[#E7E7E1] bg-white px-8 py-3">
        <div className="rounded-[14px] border border-[#E7E7E1] bg-white px-3.5 pt-2.5 pb-2.5">
          {draftActionCount > 0 ? (
            <div className="mb-2 rounded-[8px] bg-[#F6F6F3] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
              {draftActionCount === 1
                ? "הטיוטה מתייחסת לפעולה שנדרשה ממך"
                : `הטיוטה מתייחסת ל־${draftActionCount} הפעולות שנדרשו ממך`}
            </div>
          ) : null}

          <div className="mb-1 flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-[8px] px-1.5 py-1 text-[12.5px] font-medium text-[#363633] hover:bg-[#F6F6F3]"
                >
                  {modeLabel}
                  <ChevronDown className="size-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() => dispatch({ type: "SET_COMPOSER_MODE", mode: "reply" })}
                >
                  משיב
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => dispatch({ type: "SET_COMPOSER_MODE", mode: "replyAll" })}
                >
                  משיב לכולם
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => dispatch({ type: "SET_COMPOSER_MODE", mode: "forward" })}
                >
                  מעביר
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => toast("עריכת To / Cc / Bcc (מדומה)")}>
                  ערוך אל, עותק ו־Bcc
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="truncate text-[12px] text-[var(--text-muted)]">
              {composerRecipients}
            </span>
          </div>

          <AutoGrowTextarea
            value={state.composer.text}
            onChange={(text) => dispatch({ type: "SET_COMPOSER_TEXT", text })}
            placeholder="כתיבת תשובה..."
          />

          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <IconButton
                label="צירוף קובץ"
                onClick={() => toast("צירוף קובץ מדומה — אין העלאה אמיתית")}
              >
                <Paperclip className="size-[18px]" strokeWidth={1.75} />
              </IconButton>
              <IconButton label="עיצוב טקסט" onClick={() => toast("עיצוב טקסט מדומה")}>
                <Bold className="size-[18px]" strokeWidth={1.75} />
              </IconButton>
              <button
                type="button"
                onClick={() => {
                  const improved =
                    state.composer.text.trim() ||
                    snapshot?.primary.draftReply ||
                    "עמית שלום,\n\nמאשרים את מועד ההתקנה.";
                  dispatch({ type: "SET_COMPOSER_TEXT", text: improved });
                  toast("הניסוח שופר (מדומה)");
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[#F6F6F3] hover:text-[#363633]"
              >
                <Sparkles className="size-4" strokeWidth={1.75} />
                שפר ניסוח
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!state.composer.text.trim()) {
                  toast.error("יש לכתוב תשובה לפני השליחה");
                  return;
                }
                toast.success("התשובה נשלחה");
                dispatch({ type: "SET_COMPOSER_TEXT", text: "" });
              }}
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-pill)] bg-[#343a40] px-4 text-[13px] font-medium text-white hover:bg-[#212529]"
            >
              <Send className="size-3.5" strokeWidth={1.75} />
              שליחה
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
