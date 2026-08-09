"use client";

import * as React from "react";
import {
  Archive,
  ChevronDown,
  FileText,
  MoreHorizontal,
  Paperclip,
  Send,
  Sparkles,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatThreadTime } from "@/lib/format";
import {
  getAgentSnapshot,
  getAttachmentsForMessage,
  getMessagesForThread,
  getParticipant,
  getThread,
  getThreadPrimaryParticipant,
  getThreadSnapshot,
} from "@/mocks";
import { IconButton } from "@/components/shared/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getPrimaryActionState,
  useWorkspace,
  type PrimaryActionState,
} from "@/state/workspace";

function CollapsedQuote({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)]",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
        />
        {open ? (
          "הסתר ציטוט"
        ) : (
          <span className="truncate">
            ציטוט: <span className="bidi-content" dir="auto">{text}</span>
          </span>
        )}
      </button>
      {open ? (
        <div
          className="mt-1 border-r-2 border-[var(--border-strong)] pr-3 text-[13px] text-[var(--text-secondary)]"
          dir="auto"
        >
          <span className="bidi-content whitespace-pre-wrap">{text}</span>
        </div>
      ) : null}
    </div>
  );
}

function buildConversationSummary(
  threadId: string,
  primaryActionStates: Record<string, PrimaryActionState>,
) {
  const agent = getAgentSnapshot(threadId);
  const snapshot = getThreadSnapshot(threadId);

  const activeActions =
    snapshot?.primary.actions.filter(
      (a) => getPrimaryActionState(primaryActionStates, a.id).status === "active",
    ).length ?? 0;

  const taskCount = agent?.tasks.length ?? 0;
  const waiting = agent?.waitingOn[0];
  const waitingLabel = waiting?.includes("עמית")
    ? "ממתינים לעמית"
    : waiting ?? null;

  return [
    activeActions > 0
      ? activeActions === 1
        ? "נדרשת פעולה אחת"
        : `נדרשות ${activeActions} פעולות`
      : null,
    taskCount > 0 ? `${taskCount} משימות פתוחות` : null,
    waitingLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ConversationPanel({ threadId }: { threadId: string }) {
  const thread = getThread(threadId);
  const { state, dispatch } = useWorkspace();
  const messages = getMessagesForThread(threadId);
  const snapshot = getThreadSnapshot(threadId);
  const draftReply = snapshot?.primary.draftReply;
  const summary = buildConversationSummary(threadId, state.primaryActionStates);

  React.useEffect(() => {
    if (!state.highlightedMessageId) return;
    const el = document.getElementById(`message-${state.highlightedMessageId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => {
      dispatch({ type: "HIGHLIGHT_MESSAGE", messageId: null });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [state.highlightedMessageId, dispatch]);

  if (!thread) return null;

  const person = getThreadPrimaryParticipant(thread);
  const participantNames = thread.participantIds
    .map((id) => getParticipant(id)?.name)
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      <header className="shrink-0 border-b border-[var(--border)] px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
              <span className="bidi-content" dir="auto">
                {thread.subject}
              </span>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-[var(--text-secondary)]">
              <span>
                <bdi>{participantNames}</bdi>
              </span>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{thread.badge ?? "דורש תשובה"}</span>
              <span className="text-[var(--text-muted)]">·</span>
              <time dateTime={thread.updatedAt}>
                פעילות {formatThreadTime(thread.updatedAt)}
              </time>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="סימון כוכב" onClick={() => toast("סומן בכוכב (מדומה)")}>
              <Star className="size-[18px]" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="ארכיון" onClick={() => toast("הועבר לארכיון (מדומה)")}>
              <Archive className="size-[18px]" strokeWidth={1.75} />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="עוד פעולות"
                  className="inline-flex size-10 items-center justify-center rounded-[var(--radius-icon)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => toast("סומן כלא נקרא (מדומה)")}>
                  סמן כלא נקרא
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast("הועבר לממתינים (מדומה)")}>
                  העבר לממתינים
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {summary ? (
          <div className="mt-2.5 flex items-center gap-2 rounded-[10px] bg-[var(--surface-subtle)] px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
              {summary}
            </p>
          </div>
        ) : null}
      </header>

      <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.map((message) => {
          const sender = getParticipant(message.fromId);
          const attachments = getAttachmentsForMessage(message.id);
          const highlighted = state.highlightedMessageId === message.id;

          return (
            <article
              key={message.id}
              id={`message-${message.id}`}
              className={cn(
                "flex gap-2.5",
                message.isOutbound ? "flex-row-reverse" : "flex-row",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-avatar-sm)] text-[11px] font-semibold",
                  message.isOutbound
                    ? "bg-[var(--action-primary)] text-[var(--action-on-primary)]"
                    : "bg-[var(--surface-subtle)] text-[var(--text-primary)] ring-1 ring-[var(--border)]",
                )}
              >
                {sender?.initials ?? "?"}
              </div>

              <div
                className={cn(
                  "max-w-[min(640px,78%)] rounded-[14px] px-3.5 py-2.5",
                  message.isOutbound
                    ? "bg-[var(--surface-outgoing)]"
                    : "bg-[var(--surface-subtle)]",
                  highlighted && "ring-2 ring-[var(--action-primary)] ring-offset-2",
                )}
              >
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <div className="truncate text-[12px] font-medium text-[var(--text-secondary)]">
                    <bdi>{sender?.name}</bdi>
                  </div>
                  <time
                    className="shrink-0 text-[11px] text-[var(--text-muted)]"
                    dateTime={message.sentAt}
                  >
                    {formatThreadTime(message.sentAt)}
                  </time>
                </div>
                <div
                  className="whitespace-pre-wrap text-[14.5px] leading-[1.55] text-[var(--text-primary)]"
                  dir="auto"
                >
                  <span className="bidi-content">{message.body}</span>
                </div>
                {message.signature ? (
                  <div
                    className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-muted)]"
                    dir="auto"
                  >
                    <span className="bidi-content">{message.signature}</span>
                  </div>
                ) : null}
                {message.quotedText ? <CollapsedQuote text={message.quotedText} /> : null}
                {attachments.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {attachments.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => toast(`הורדה מדומה — ${file.fileName}`)}
                        className="flex w-full items-center gap-2 rounded-[10px] px-1 py-1.5 text-start hover:bg-[var(--surface-hover)]"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface)] text-[var(--text-secondary)] ring-1 ring-[var(--border)]">
                          <FileText className="size-4" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium">
                            <bdi>{file.fileName}</bdi>
                          </span>
                          <span className="block text-[11px] text-[var(--text-muted)]">
                            {file.sizeLabel} · תוכן הקובץ לא נותח
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-2.5">
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 pt-2 pb-2">
          <div className="mb-0.5 flex items-center gap-2">
            <label className="sr-only" htmlFor="reply-mode">
              מצב תשובה
            </label>
            <select
              id="reply-mode"
              value={state.composer.mode}
              onChange={(e) =>
                dispatch({
                  type: "SET_COMPOSER_MODE",
                  mode: e.target.value as "reply" | "replyAll" | "forward",
                })
              }
              className="h-7 rounded-[var(--radius-field)] border-0 bg-transparent pe-6 text-[12px] font-medium text-[var(--text-secondary)] outline-none"
            >
              <option value="reply">השב</option>
              <option value="replyAll">השב לכולם</option>
              <option value="forward">העבר</option>
            </select>
            {person ? (
              <span className="truncate text-[12px] text-[var(--text-muted)]">
                אל <bdi>{person.name}</bdi>
              </span>
            ) : null}
          </div>

          <textarea
            value={state.composer.text}
            onChange={(e) => dispatch({ type: "SET_COMPOSER_TEXT", text: e.target.value })}
            placeholder="כתיבת תשובה…"
            rows={2}
            className="min-h-[56px] max-h-40 w-full resize-y bg-transparent text-[14.5px] leading-6 outline-none placeholder:text-[var(--text-muted)]"
            dir="auto"
          />

          <div className="mt-0.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <IconButton
                label="צירוף קובץ"
                onClick={() => toast("צירוף קובץ מדומה — אין העלאה אמיתית")}
              >
                <Paperclip className="size-[18px]" strokeWidth={1.75} />
              </IconButton>
              <button
                type="button"
                onClick={() => {
                  const improved =
                    state.composer.text.trim() ||
                    draftReply ||
                    "יוסי שלום,\n\nמאשרים עקרונית את הגדלת הכמות ל־65 יחידות.";
                  dispatch({ type: "SET_COMPOSER_TEXT", text: improved });
                  toast("הניסוח שופר (מדומה)");
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-icon)] px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
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
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--action-primary)] px-4 text-[13px] font-medium text-[var(--action-on-primary)] hover:bg-[var(--action-primary-hover)]"
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
