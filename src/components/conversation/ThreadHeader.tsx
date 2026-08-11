"use client";

import * as React from "react";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  Clock3,
  Download,
  MailOpen,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  formatLastActivityLabel,
  formatMessageDateTime,
  formatThreadOpenedLabel,
} from "@/lib/format";
import { getEmailDataSource } from "@/lib/email-data-source";
import { useMailUi } from "@/lib/email-data-source/mail-ui-context";
import type { ThreadFileItem } from "@/mocks";
import { AttachmentTypeIcon } from "@/components/conversation/AttachmentTypeIcon";
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
import type { Message, Participant, Thread } from "@/types/domain";

const COLLAPSED_RECIPIENT_LIMIT = 2;
const READ_ONLY_HINT = "פעולה זו אינה זמינה במצב קריאה בלבד";

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
    <button
      type="button"
      aria-label={`העתק ${person.email}`}
      onClick={() => copyText(person.email, "כתובת המייל הועתקה")}
      className="inline-flex max-w-full items-center rounded-[6px] py-0.5 text-start text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
    >
      <span className="truncate text-[12.5px]">
        <bdi>{person.name}</bdi>{" "}
        <span className="text-[11.5px]" dir="ltr">
          &lt;{person.email}&gt;
        </span>
      </span>
    </button>
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
  const mail = useMailUi();
  const ds = getEmailDataSource();
  const writeActionsDisabled = mail.writeActionsDisabled;

  const [messages, setMessages] = React.useState<Message[]>([]);
  const [threadAttachments, setThreadAttachments] = React.useState<
    ThreadFileItem[]
  >([]);
  const [recipientsExpanded, setRecipientsExpanded] = React.useState(false);
  const [filesOpen, setFilesOpen] = React.useState(false);
  const askOpen = state.leftPanelMode === "thread-ai";

  const [panelEpoch, setPanelEpoch] = React.useState(thread.id);
  if (panelEpoch !== thread.id) {
    setPanelEpoch(thread.id);
    setRecipientsExpanded(false);
    setFilesOpen(false);
  }

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextMessages, nextFiles] = await Promise.all([
          ds.getMessagesForThread(thread.id),
          ds.getThreadFileItems(thread.id),
        ]);
        if (cancelled) return;
        setMessages(nextMessages);
        setThreadAttachments(nextFiles);

        const participantIds = new Set<string>();
        for (const message of nextMessages) {
          participantIds.add(message.fromId);
          for (const id of message.toIds) participantIds.add(id);
          for (const id of message.ccIds ?? []) participantIds.add(id);
        }
        for (const id of thread.participantIds) participantIds.add(id);

        const resolved = (
          await Promise.all(
            [...participantIds].map((id) => ds.getParticipant(id)),
          )
        ).filter((p): p is Participant => Boolean(p));
        if (!cancelled && resolved.length) mail.setParticipants(resolved);
      } catch {
        if (!cancelled) {
          setMessages([]);
          setThreadAttachments([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, thread.id]);

  const currentUserId = mail.currentUserId;
  const actionPeople = thread.participantIds
    .filter((id) => id !== currentUserId)
    .map((id) => mail.getParticipant(id))
    .filter((p): p is Participant => Boolean(p));

  const me = currentUserId ? mail.getParticipant(currentUserId) : undefined;
  const infoPeople = me ? [me] : [];

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
  };

  const toggleStar = () => {
    if (writeActionsDisabled) return;
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
    if (writeActionsDisabled) return;
    dispatch({ type: "ARCHIVE_THREAD", threadId: thread.id });
    toast("השיחה הועברה לארכיון", {
      action: {
        label: "ביטול",
        onClick: () =>
          dispatch({ type: "UNARCHIVE_THREAD", threadId: thread.id }),
      },
    });
  };

  const downloadFile = (file: ThreadFileItem) => {
    if (file.src?.startsWith("/api/mail/attachments/")) {
      window.open(file.src, "_blank", "noopener,noreferrer");
      return;
    }
    toast(`הורדה מדומה — ${file.fileName}`);
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
                          const sender = msg
                            ? mail.getParticipant(msg.fromId)
                            : null;
                          return (
                            <li
                              key={file.id}
                              className="px-3 py-2.5 hover:bg-[var(--surface-subtle)]"
                            >
                              <div className="flex items-start gap-2.5">
                                <AttachmentTypeIcon
                                  file={file}
                                  className="mt-0.5 text-[var(--text-secondary)]"
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
                                      onClick={() => downloadFile(file)}
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
                aria-label={askOpen ? "פאנל השאלות פתוח" : "שאל על השרשור"}
                aria-expanded={askOpen}
                aria-pressed={askOpen}
                disabled={writeActionsDisabled}
                onClick={() => {
                  if (writeActionsDisabled) return;
                  if (askOpen) {
                    dispatch({ type: "CLOSE_THREAD_AI" });
                  } else {
                    dispatch({
                      type: "OPEN_THREAD_AI",
                      threadId: thread.id,
                    });
                  }
                }}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-[var(--radius-icon)] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  askOpen
                    ? "bg-[var(--action-primary)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <Sparkles className="size-[16px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {writeActionsDisabled
                ? READ_ONLY_HINT
                : askOpen
                  ? "פאנל השאלות פתוח"
                  : "שאל על השרשור"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={starred ? "הסר ממועדפים" : "הוסף למועדפים"}
                aria-pressed={starred}
                disabled={writeActionsDisabled}
                onClick={toggleStar}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-[var(--radius-icon)] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  starred
                    ? "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <Star
                  className="size-[16px]"
                  strokeWidth={1.75}
                  fill={starred ? "currentColor" : "none"}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {writeActionsDisabled
                ? READ_ONLY_HINT
                : starred
                  ? "הסר ממועדפים"
                  : "הוסף למועדפים"}
            </TooltipContent>
          </Tooltip>

          <IconButton
            label={
              writeActionsDisabled
                ? READ_ONLY_HINT
                : archived
                  ? "כבר בארכיון"
                  : "העבר לארכיון"
            }
            onClick={archiveThread}
            disabled={writeActionsDisabled || archived}
            className="size-9"
          >
            <Archive className="size-[16px]" strokeWidth={1.75} />
          </IconButton>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="עוד פעולות"
                    className="inline-flex size-9 items-center justify-center rounded-[var(--radius-icon)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    <MoreHorizontal className="size-[16px]" strokeWidth={1.75} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>עוד פעולות</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              <DropdownMenuItem
                disabled={writeActionsDisabled}
                onSelect={() => {
                  if (writeActionsDisabled) return;
                  dispatch({ type: "MARK_THREAD_UNREAD", threadId: thread.id });
                  toast("סומן כלא נקרא");
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <MailOpen className="size-4" strokeWidth={1.75} />
                  {writeActionsDisabled ? READ_ONLY_HINT : "סמן כלא נקרא"}
                </span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:bg-red-50 focus:text-red-700"
                disabled={writeActionsDisabled}
                onSelect={() => {
                  if (writeActionsDisabled) return;
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
                  {writeActionsDisabled
                    ? READ_ONLY_HINT
                    : "העבר את השיחה לאשפה"}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-2.5 space-y-1">
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
      </div>
    </header>
  );
}
