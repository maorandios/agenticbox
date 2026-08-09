"use client";

import * as React from "react";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  CircleX,
  Clock3,
  Copy,
  Download,
  FileText,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  formatLastActivityLabel,
  formatMessageDateTime,
  formatThreadOpenedLabel,
} from "@/lib/format";
import {
  CURRENT_USER_ID,
  getMessagesForThread,
  getParticipant,
  getThreadFileItems,
} from "@/mocks";
import { IconButton } from "@/components/shared/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { useWorkspace } from "@/state/workspace";
import type { Participant, Thread } from "@/types/domain";

const COLLAPSED_RECIPIENT_LIMIT = 2;

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("לא ניתן להעתיק");
  }
}

function RecipientChip({ person }: { person: Participant }) {
  return (
    <span className="group/addr inline-flex max-w-full items-center gap-1 rounded-[6px] py-0.5 pe-1 text-[var(--text-secondary)]">
      <span className="truncate text-[12.5px]">
        <bdi>{person.name}</bdi>{" "}
        <span className="text-[11.5px]" dir="ltr">
          &lt;{person.email}&gt;
        </span>
      </span>
      <button
        type="button"
        aria-label={`העתק ${person.email}`}
        onClick={() => copyText(person.email, "כתובת המייל הועתקה")}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-muted)] opacity-0 transition-opacity duration-[130ms] group-hover/addr:opacity-100 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      >
        <Copy className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

function RecipientRow({
  label,
  people,
  expanded,
  onExpandHidden,
}: {
  label: string;
  people: Participant[];
  expanded: boolean;
  onExpandHidden: () => void;
}) {
  if (people.length === 0) return null;
  const visible = expanded ? people : people.slice(0, COLLAPSED_RECIPIENT_LIMIT);
  const hidden = Math.max(0, people.length - visible.length);

  return (
    <div className="flex min-w-0 items-start gap-2 text-[12.5px]">
      <span className="w-[52px] shrink-0 pt-0.5 font-medium text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        {visible.map((person, index) => (
          <React.Fragment key={person.id}>
            {index > 0 ? (
              <span className="text-[var(--text-muted)]" aria-hidden>
                ·
              </span>
            ) : null}
            <RecipientChip person={person} />
          </React.Fragment>
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={onExpandHidden}
            className="text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            +{hidden} נוספים
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadHeader({ thread }: { thread: Thread }) {
  const { state, dispatch } = useWorkspace();
  const messages = getMessagesForThread(thread.id);
  const threadAttachments = getThreadFileItems(thread.id);
  const [recipientsExpanded, setRecipientsExpanded] = React.useState(false);
  const [askOpen, setAskOpen] = React.useState(false);
  const [askQuery, setAskQuery] = React.useState("");
  const [answerOpen, setAnswerOpen] = React.useState(false);
  const [filesOpen, setFilesOpen] = React.useState(false);

  React.useEffect(() => {
    setRecipientsExpanded(false);
    setAskOpen(false);
    setAskQuery("");
    setAnswerOpen(false);
    setFilesOpen(false);
  }, [thread.id]);

  const actionPeople = thread.participantIds
    .filter((id) => id !== CURRENT_USER_ID)
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));

  const me = getParticipant(CURRENT_USER_ID);
  const infoPeople = me ? [me] : [];

  const allAddresses = [...actionPeople, ...infoPeople]
    .map((p) => `${p.name} <${p.email}>`)
    .join(", ");

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const messageCount = messages.length;
  const starred = state.starredThreadIds.includes(thread.id);
  const archived = state.archivedThreadIds.includes(thread.id);

  const sortedAttachments = [...threadAttachments].sort((a, b) => {
    const msgA = messages.find((m) => m.id === a.messageId);
    const msgB = messages.find((m) => m.id === b.messageId);
    return (msgB?.sentAt ?? "").localeCompare(msgA?.sentAt ?? "");
  });

  const highlightSource = (messageId: string) => {
    dispatch({ type: "HIGHLIGHT_MESSAGE", messageId });
    setFilesOpen(false);
    setAnswerOpen(false);
  };

  const toggleStar = () => {
    const wasStarred = starred;
    dispatch({ type: "TOGGLE_STAR_THREAD", threadId: thread.id });
    if (wasStarred) {
      toast("הוסר מהמועדפים");
    } else {
      toast("השיחה נוספה למועדפים", {
        action: {
          label: "ביטול",
          onClick: () =>
            dispatch({ type: "TOGGLE_STAR_THREAD", threadId: thread.id }),
        },
      });
    }
  };

  const archiveThread = () => {
    dispatch({ type: "ARCHIVE_THREAD", threadId: thread.id });
    toast("השיחה הועברה לארכיון", {
      action: {
        label: "ביטול",
        onClick: () =>
          dispatch({ type: "UNARCHIVE_THREAD", threadId: thread.id }),
      },
    });
  };

  const showAnswer = (query: string) => {
    setAskQuery(query);
    setAnswerOpen(true);
  };

  return (
    <header className="sticky top-0 z-20 shrink-0 bg-white/95 backdrop-blur-sm">
      <div className="border-b border-[var(--border)] px-8 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
            <span className="bidi-content" dir="auto">
              {thread.subject}
            </span>
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1">
              <MessagesSquare className="size-3.5 shrink-0" strokeWidth={1.75} />
              {messageCount} הודעות
            </span>
            <span className="text-[var(--text-muted)]" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5 shrink-0" strokeWidth={1.75} />
              {firstMessage
                ? formatThreadOpenedLabel(firstMessage.sentAt)
                : formatThreadOpenedLabel(thread.updatedAt)}
            </span>
            <span className="text-[var(--text-muted)]" aria-hidden>
              ·
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3.5 shrink-0" strokeWidth={1.75} />
              {lastMessage
                ? formatLastActivityLabel(lastMessage.sentAt)
                : formatLastActivityLabel(thread.updatedAt)}
            </span>
            {sortedAttachments.length > 0 ? (
              <>
                <span className="text-[var(--text-muted)]" aria-hidden>
                  ·
                </span>
                <Popover open={filesOpen} onOpenChange={setFilesOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    >
                      <Paperclip className="size-3.5 shrink-0" strokeWidth={1.75} />
                      {`קבצים מצורפים · ${sortedAttachments.length}`}
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 transition-transform duration-[180ms] ease-out",
                          filesOpen && "rotate-180",
                        )}
                        strokeWidth={1.75}
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    className="w-[min(100vw-2rem,360px)] p-0"
                  >
                    <div className="border-b border-[var(--border)] px-3 py-2.5 text-[13px] font-semibold text-[var(--text-primary)]">
                      קבצים בשיחה
                    </div>
                    <div className="thin-scroll max-h-[320px] overflow-y-auto">
                      <ul className="divide-y divide-[var(--border)]">
                        {sortedAttachments.map((file) => {
                          const msg = messages.find((m) => m.id === file.messageId);
                          const sender = msg ? getParticipant(msg.fromId) : null;
                          return (
                            <li
                              key={file.id}
                              className="px-3 py-2.5 hover:bg-[var(--surface-subtle)]"
                            >
                              <div className="flex items-start gap-2.5">
                                <FileText
                                  className="mt-0.5 size-4 shrink-0 text-[var(--text-secondary)]"
                                  strokeWidth={1.75}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                                    <bdi>{file.fileName}</bdi>
                                  </div>
                                  {file.appearsInBody ? (
                                    <div className="mt-1 inline-flex rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-secondary)]">
                                      מופיעה בגוף ההודעה
                                    </div>
                                  ) : null}
                                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                                    {file.sizeLabel}
                                    {sender ? (
                                      <>
                                        {" · "}
                                        <bdi>{sender.name}</bdi>
                                      </>
                                    ) : null}
                                    {msg ? (
                                      <>
                                        {" · "}
                                        {formatMessageDateTime(msg.sentAt)}
                                      </>
                                    ) : null}
                                  </div>
                                  <div className="mt-1.5 flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => highlightSource(file.messageId)}
                                      className="text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                    >
                                      הצג בהודעה
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toast(`הורדה מדומה — ${file.fileName}`)
                                      }
                                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                    >
                                      <Download className="size-3" strokeWidth={1.75} />
                                      הורדה
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="חיפוש"
                aria-expanded={askOpen}
                aria-pressed={askOpen}
                onClick={() => {
                  if (askOpen) {
                    setAskOpen(false);
                    setAnswerOpen(false);
                    setAskQuery("");
                  } else {
                    setAskOpen(true);
                  }
                }}
                className={cn(
                  "inline-flex size-10 items-center justify-center rounded-[var(--radius-icon)] transition-colors",
                  askOpen
                    ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <Search className="size-[18px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>חיפוש</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={starred ? "הסר ממועדפים" : "הוסף למועדפים"}
                aria-pressed={starred}
                onClick={toggleStar}
                className={cn(
                  "inline-flex size-10 items-center justify-center rounded-[var(--radius-icon)] transition-colors",
                  starred
                    ? "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <Star
                  className="size-[18px]"
                  strokeWidth={1.75}
                  fill={starred ? "currentColor" : "none"}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{starred ? "הסר ממועדפים" : "הוסף למועדפים"}</TooltipContent>
          </Tooltip>

          <IconButton
            label={archived ? "כבר בארכיון" : "העבר לארכיון"}
            onClick={archiveThread}
            disabled={archived}
          >
            <Archive className="size-[18px]" strokeWidth={1.75} />
          </IconButton>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="עוד פעולות"
                    className="inline-flex size-10 items-center justify-center rounded-[var(--radius-icon)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>עוד פעולות</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              <DropdownMenuItem
                onSelect={() => {
                  dispatch({ type: "MARK_THREAD_UNREAD", threadId: thread.id });
                  toast("סומן כלא נקרא");
                }}
              >
                סמן כלא נקרא
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  dispatch({
                    type: "SET_THREAD_STATUS",
                    threadId: thread.id,
                    status: "waiting",
                  });
                  toast("השיחה הועברה לממתינים");
                }}
              >
                העבר את השיחה לממתינים
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toast("תזכורת תוגדר מאוחר יותר (מדומה)")}>
                הזכר לי מאוחר יותר
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => toast("העברה לפרויקט (מדומה)")}>
                העבר לפרויקט
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:bg-red-50 focus:text-red-700"
                onSelect={() => {
                  dispatch({ type: "DELETE_THREAD", threadId: thread.id });
                  toast("השיחה הועברה לאשפה", {
                    action: {
                      label: "ביטול",
                      onClick: () =>
                        dispatch({
                          type: "RESTORE_DELETED_THREAD",
                          threadId: thread.id,
                        }),
                    },
                  });
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Trash2 className="size-4" strokeWidth={1.75} />
                  העבר את השיחה לאשפה
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2.5 space-y-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <RecipientRow
              label="לפעולה"
              people={actionPeople}
              expanded={recipientsExpanded}
              onExpandHidden={() => setRecipientsExpanded(true)}
            />
            <RecipientRow
              label="לידיעה"
              people={infoPeople}
              expanded={recipientsExpanded}
              onExpandHidden={() => setRecipientsExpanded(true)}
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="העתק את כל הכתובות"
                onClick={() => copyText(allAddresses, "כל הכתובות הועתקו")}
                className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <Copy className="size-3.5" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>העתק את כל הכתובות</TooltipContent>
          </Tooltip>
        </div>
      </div>
      </div>

      {askOpen ? (
        <div className="relative border-b border-[var(--border)] px-8 py-2.5">
          <div className="flex h-[34px] w-full max-w-[420px] items-center overflow-hidden rounded-full border border-[var(--border)] bg-white shadow-[0_0_0_1px_var(--border)]">
            {askQuery ? (
              <button
                type="button"
                aria-label="נקה טקסט"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setAskQuery("");
                  setAnswerOpen(false);
                }}
                className="ms-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              >
                <CircleX className="size-4" strokeWidth={1.75} />
              </button>
            ) : null}
            <input
              autoFocus
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && askQuery.trim()) {
                  showAnswer(askQuery.trim());
                }
                if (e.key === "Escape") {
                  setAskOpen(false);
                  setAnswerOpen(false);
                  setAskQuery("");
                }
              }}
              placeholder="מה תרצו לדעת?"
              className="h-full min-w-0 flex-1 bg-transparent pe-2 ps-2 text-right text-[13px] outline-none placeholder:text-right placeholder:text-[var(--text-muted)]"
              dir="rtl"
            />
            <button
              type="button"
              aria-label="חיפוש"
              disabled={!askQuery.trim()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (askQuery.trim()) showAnswer(askQuery.trim());
              }}
              className="me-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--action-primary)] text-white transition-colors hover:bg-[var(--action-primary-hover)] disabled:opacity-35"
            >
              <Search className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {answerOpen ? (
            <div className="absolute inset-x-8 top-[calc(100%+2px)] z-30 max-w-[420px] overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-overlay)]">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles
                    className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                    strokeWidth={1.75}
                  />
                  <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                    תשובה מהשרשור
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="סגור תשובה"
                  onClick={() => setAnswerOpen(false)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-white hover:text-[var(--text-primary)]"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>

              <div className="px-3.5 py-3">
                <p className="text-[13.5px] leading-[1.65] text-[var(--text-primary)]">
                  הכמות האחרונה שסוכמה בשרשור היא{" "}
                  <span className="font-semibold">65 יחידות</span>, לאחר עדכון מ־40.
                  מועד היעד שצוין הוא 18 באוגוסט.
                </p>
              </div>

              <div className="border-t border-[var(--border)] px-3.5 py-2.5">
                <p className="mb-2 text-[11px] font-semibold text-[var(--text-muted)]">
                  מקורות
                </p>
                <div className="space-y-2">
                  {(
                    [
                      {
                        id: "msg-city-1",
                        label: "עדכון הכמות",
                        quote:
                          "הכמות עודכנה מ־40 ל־65 יחידות, ולכן נדרש תיאום מחדש של לוח הזמנים.",
                      },
                      {
                        id: "msg-city-5",
                        label: "מועד היעד",
                        quote: "נוסף מועד יעד: 18 באוגוסט. ההתקנה תתבצע בשני שלבים.",
                      },
                    ] as const
                  ).map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => highlightSource(source.id)}
                      className="block w-full border-r-2 border-[var(--action-primary)] pr-3 text-start transition-colors hover:bg-[var(--surface-subtle)]"
                    >
                      <span className="block text-[11.5px] font-semibold text-[var(--text-secondary)]">
                        {source.label}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-5 text-[var(--text-muted)]">
                        “{source.quote}”
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
