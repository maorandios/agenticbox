"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  Forward,
  Paperclip,
  Reply,
  ReplyAll,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { getAttachmentTypeLabel } from "@/lib/attachment-kind";
import {
  formatCompactMessageStamp,
  formatMessageDateTimeLong,
  formatQuotedMessageStamp,
} from "@/lib/format";
import { getDisplayInitials } from "@/lib/initials";
import { sleep } from "@/lib/sleep";
import {
  CURRENT_USER_ID,
  getBubbleAttachments,
  getMessagesForThread,
  getParticipant,
  getThread,
  resolveRepliedToMessage,
} from "@/mocks";
import { AttachmentTypeIcon } from "@/components/conversation/AttachmentTypeIcon";
import { Composer } from "@/components/conversation/Composer";
import { MessageBody } from "@/components/conversation/MessageBody";
import {
  SignatureSnapshotAffordance,
  SignatureSnapshotCard,
} from "@/components/conversation/SignatureContactCard";
import { ThreadHeader } from "@/components/conversation/ThreadHeader";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/state/workspace";
import type {
  Attachment,
  Message,
  MessageParagraphBlock,
  Participant,
} from "@/types/domain";

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("לא ניתן להעתיק");
  }
}

function PersonAvatar({ person }: { person?: Participant | null }) {
  const initials = person
    ? getDisplayInitials(person.name) || person.initials
    : "?";

  if (person?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatarUrl}
        alt={person.name}
        className="size-9 shrink-0 self-start rounded-full object-cover ring-1 ring-[var(--border)]"
      />
    );
  }

  return (
    <div className="flex size-9 shrink-0 self-start items-center justify-center rounded-full bg-[var(--surface-selected)] text-[12px] font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border)]">
      {initials}
    </div>
  );
}

function plainMessageBody(message: Message): string {
  if (!message.content?.length) return message.body;
  const paragraphs = message.content
    .filter((block): block is MessageParagraphBlock => block.type === "paragraph")
    .map((block) => block.text);
  return paragraphs.length > 0 ? paragraphs.join("\n\n") : message.body;
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
    <div className="mt-0" dir="rtl">
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex h-8 items-center gap-1 text-[12px] transition-colors duration-[130ms]",
            dark
              ? "text-white/65 hover:text-white"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
          )}
        >
          {open ? (
            <ChevronUp className="size-[14px]" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="size-[14px]" strokeWidth={1.75} />
          )}
          {open ? "הסתר חתימה" : "הצג חתימה"}
        </button>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[180ms] ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "mt-2 border-r-2 pr-3 text-start text-[13px] leading-6 whitespace-pre-wrap",
              dark
                ? "border-white/25 text-white/65"
                : "border-[var(--border)] text-[var(--text-secondary)]",
            )}
            dir="rtl"
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplyToBlock({
  source,
  dark,
}: {
  source: Message;
  dark: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const sourceSender = getParticipant(source.fromId);
  const sourceBody = plainMessageBody(source);
  const stamp = formatQuotedMessageStamp(source.sentAt);
  const summaryLabel = sourceSender
    ? `תגובה ל${sourceSender.name} · ${stamp}`
    : `תגובה להודעה · ${stamp}`;

  const controlClass = cn(
    "inline-flex h-8 max-w-full items-center gap-1.5 text-[12px] transition-colors duration-[130ms]",
    dark
      ? "text-white/65 hover:text-white"
      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
  );

  return (
    <div dir="rtl">
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[180ms] ease-out",
          open ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={false}
              tabIndex={open ? -1 : 0}
              className={controlClass}
            >
              <Reply className="size-[14px] shrink-0" strokeWidth={1.75} />
              <span className="truncate">{summaryLabel}</span>
              <ChevronDown className="size-[14px] shrink-0" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[180ms] ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2">
            <div
              className={cn(
                "border-r-2 pr-3 text-start",
                dark ? "border-white/20" : "border-[var(--border)]",
              )}
            >
              <div
                className={cn(
                  "bidi-content whitespace-pre-wrap text-[13px] leading-6",
                  dark ? "text-white/70" : "text-[var(--text-secondary)]",
                )}
                dir="auto"
              >
                {sourceBody}
              </div>
            </div>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-expanded={true}
                tabIndex={open ? 0 : -1}
                className={controlClass}
              >
                <ChevronUp className="size-[14px] shrink-0" strokeWidth={1.75} />
                <span>הסתר תגובה</span>
              </button>
            </div>
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
  const typeLabel = getAttachmentTypeLabel(file);
  const openPreview = () => toast("תצוגה מקדימה מדומה");
  const metaClass = dark ? "text-white/55" : "text-[var(--text-muted)]";
  const iconClass = dark ? "text-white/80" : "text-[var(--text-primary)]";

  return (
    <div
      className="flex h-[38px] items-center gap-2 px-0.5"
      dir="rtl"
    >
      <button
        type="button"
        onClick={openPreview}
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
      >
        <AttachmentTypeIcon file={file} className={iconClass} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "min-w-0 truncate text-[12px] font-medium",
                dark ? "text-white" : "text-[var(--text-primary)]",
              )}
            >
              <bdi>{file.fileName}</bdi>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <bdi>{file.fileName}</bdi>
          </TooltipContent>
        </Tooltip>
        <span className={cn("shrink-0 text-[12px]", metaClass)} aria-hidden>
          ·
        </span>
        <bdi className={cn("shrink-0 text-[12px]", metaClass)}>{typeLabel}</bdi>
        <span className={cn("shrink-0 text-[12px]", metaClass)} aria-hidden>
          ·
        </span>
        <bdi className={cn("shrink-0 text-[12px]", metaClass)}>{file.sizeLabel}</bdi>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="תצוגה מקדימה"
              onClick={(e) => {
                e.stopPropagation();
                openPreview();
              }}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-[8px]",
                dark
                  ? "text-white/75 hover:bg-white/10"
                  : "text-[var(--text-secondary)] hover:bg-black/5",
              )}
            >
              <Eye className="size-3.5" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>תצוגה מקדימה</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="הורדה"
              onClick={(e) => {
                e.stopPropagation();
                toast(`הורדה מדומה — ${file.fileName}`);
              }}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-[8px]",
                dark
                  ? "text-white/75 hover:bg-white/10"
                  : "text-[var(--text-secondary)] hover:bg-black/5",
              )}
            >
              <Download className="size-3.5" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>הורדה</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function attachmentTypesSummary(files: Attachment[]): string {
  const labels = files.map((file) => getAttachmentTypeLabel(file));
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} ועוד ${labels.length - 3}`;
}

function AttachmentStack({
  files,
  dark,
}: {
  files: Attachment[];
  dark: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);

  if (files.length === 0) return null;

  const useSummary = files.length >= 3;
  const muted = dark ? "text-white/65" : "text-[var(--text-muted)]";
  const primary = dark ? "text-white" : "text-[var(--text-primary)]";

  const fileList = (
    <ul
      className={cn(
        "flex flex-col divide-y",
        dark ? "divide-white/10" : "divide-[var(--border)]",
        useSummary && "thin-scroll max-h-[180px] overflow-y-auto",
      )}
    >
      {files.map((file) => (
        <li key={file.id}>
          <AttachmentRow file={file} dark={dark} />
        </li>
      ))}
    </ul>
  );

  if (!useSummary) {
    return <div dir="rtl">{fileList}</div>;
  }

  return (
    <div dir="rtl">
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[180ms] ease-out",
          expanded ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            tabIndex={expanded ? -1 : 0}
            className={cn(
              "flex h-10 w-full items-center gap-2 text-start transition-opacity hover:opacity-90",
              muted,
            )}
          >
            <Paperclip
              className={cn("size-3.5 shrink-0", primary)}
              strokeWidth={1.75}
            />
            <span className={cn("shrink-0 text-[12.5px] font-medium", primary)}>
              {`${files.length} קבצים מצורפים`}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px]">
              {attachmentTypesSummary(files)}
            </span>
            <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-[180ms] ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-1">
            {fileList}
            <div className="flex justify-start pt-0.5">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-expanded={true}
                tabIndex={expanded ? 0 : -1}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 text-[12px] transition-colors",
                  dark
                    ? "text-white/65 hover:text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                )}
              >
                <ChevronUp className="size-3.5" strokeWidth={1.75} />
                הסתר קבצים
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageToolbar({
  message,
  dark,
}: {
  message: Message;
  dark: boolean;
}) {
  const { dispatch } = useWorkspace();

  const actions = [
    {
      label: "השב",
      icon: Reply,
      onClick: () => {
        dispatch({ type: "FOCUS_COMPOSER", mode: "reply" });
      },
    },
    {
      label: "השב לכולם",
      icon: ReplyAll,
      onClick: () => {
        dispatch({ type: "FOCUS_COMPOSER", mode: "replyAll" });
      },
    },
    {
      label: "העבר",
      icon: Forward,
      onClick: () => {
        dispatch({ type: "FOCUS_COMPOSER", mode: "forward" });
      },
    },
    {
      label: "העתק תוכן",
      icon: Copy,
      onClick: () => copyText(message.body, "תוכן ההודעה הועתק"),
    },
    {
      label: "העבר הודעה לאשפה",
      icon: Trash2,
      destructive: true as const,
      onClick: () => {
        dispatch({ type: "DELETE_MESSAGE", messageId: message.id });
        toast("ההודעה הועברה לאשפה", {
          action: {
            label: "ביטול",
            onClick: () =>
              dispatch({
                type: "RESTORE_DELETED_MESSAGE",
                messageId: message.id,
              }),
          },
        });
      },
    },
  ];

  return (
    <div
      className={cn(
        "flex w-full items-center justify-end gap-0.5 border-t px-2.5 py-1",
        dark
          ? "border-white/25 bg-[#2f363f]"
          : "border-[var(--border)] bg-[#fafbfc]",
      )}
      dir="rtl"
    >
      {actions.map((item) => (
        <Tooltip key={item.label}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={item.label}
              onClick={item.onClick}
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-all duration-[120ms] ease-out",
                dark
                  ? "text-white hover:bg-white/15"
                  : "text-[var(--text-secondary)] opacity-80 hover:bg-white hover:opacity-100 hover:text-[var(--text-primary)]",
                item.destructive && !dark && "hover:text-red-600",
                item.destructive && dark && "hover:text-red-300",
              )}
            >
              <item.icon className="size-4" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{item.label}</TooltipContent>
        </Tooltip>
      ))}
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
  const [signatureOpen, setSignatureOpen] = React.useState(false);
  const sender = getParticipant(message.fromId);
  const signature = message.signatureSnapshot;
  const toPeople = message.toIds
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));
  const ccPeople = (message.ccIds ?? [])
    .map((id) => getParticipant(id))
    .filter((p): p is Participant => Boolean(p));
  const replyTo = message.replyToId ? getParticipant(message.replyToId) : null;
  const attachments = getBubbleAttachments(message);
  const repliedTo = resolveRepliedToMessage(message);
  const mine = message.isOutbound;
  const dark = !mine;
  const compactStamp = formatCompactMessageStamp(message.sentAt);
  const fullStamp = formatMessageDateTimeLong(message.sentAt);

  const avatarNode = <PersonAvatar person={sender} />;

  return (
    <article
      id={`message-${message.id}`}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
      dir="ltr"
    >
      <div
        className={cn(
          "flex max-w-[min(70%,660px)] gap-[10px]",
          mine ? "flex-row-reverse" : "flex-row",
        )}
      >
        {signature ? (
          <SignatureSnapshotCard
            snapshot={signature}
            open={signatureOpen}
            onOpenChange={setSignatureOpen}
            anchor={
              <button
                type="button"
                aria-label="הצג את חתימת השולח"
                className="shrink-0 self-start rounded-full transition-opacity hover:opacity-90"
              >
                {avatarNode}
              </button>
            }
          />
        ) : (
          avatarNode
        )}

        <div className="min-w-0">
          <div
            className={cn(
              "relative w-fit max-w-full overflow-hidden rounded-[16px] transition-[box-shadow] duration-[140ms]",
              mine
                ? "border border-[var(--border)] bg-[var(--surface-outgoing)] text-[var(--text-primary)]"
                : "bg-[var(--surface-incoming)] text-white",
              highlighted && "ring-2 ring-[var(--border-strong)] ring-offset-2",
            )}
          >
            <div className="px-[18px] py-4">
            <div
              className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1"
              dir="rtl"
            >
              {sender?.email ? (
                <span
                  className={cn(
                    "text-[11.5px]",
                    dark ? "text-white/65" : "text-[var(--text-muted)]",
                  )}
                  dir="ltr"
                >
                  <bdi>{sender.email}</bdi>
                </span>
              ) : null}

              {sender?.email && sender?.name ? (
                <span
                  className={cn(
                    "text-[11.5px]",
                    dark ? "text-white/65" : "text-[var(--text-muted)]",
                  )}
                  aria-hidden
                >
                  ·
                </span>
              ) : null}

              <span
                className={cn(
                  "text-[11.5px]",
                  dark ? "text-white/65" : "text-[var(--text-muted)]",
                )}
              >
                <bdi>{sender?.name ?? "לא ידוע"}</bdi>
              </span>

              <Tooltip>
                <TooltipTrigger asChild>
                  <time
                    dateTime={message.sentAt}
                    className={cn(
                      "text-[11.5px]",
                      dark ? "text-white/65" : "text-[var(--text-muted)]",
                    )}
                  >
                    {compactStamp}
                  </time>
                </TooltipTrigger>
                <TooltipContent>{fullStamp}</TooltipContent>
              </Tooltip>

              {signature ? (
                <SignatureSnapshotAffordance
                  dark={dark}
                  open={signatureOpen}
                  onOpenChange={setSignatureOpen}
                />
              ) : null}

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
                    "mb-3 space-y-1 text-[12px]",
                    dark ? "text-white/65" : "text-[var(--text-secondary)]",
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
                    {fullStamp}
                  </div>
                </div>
              </div>
            </div>

            <MessageBody
              message={message}
              dark={dark}
              renderQuoted={({ text, dark: isDark }) => (
                <QuotedBlock text={text} dark={isDark} />
              )}
            />

            {attachments.length > 0 ? (
              <div className="mt-[14px]">
                <AttachmentStack files={attachments} dark={dark} />
              </div>
            ) : null}

            {repliedTo ? (
              <div
                className={cn(
                  attachments.length > 0 ? "mt-[10px]" : "mt-[14px]",
                )}
              >
                <ReplyToBlock source={repliedTo} dark={dark} />
              </div>
            ) : null}
            </div>

            <MessageToolbar message={message} dark={dark} />
          </div>
        </div>
      </div>
    </article>
  );
}

type OutboundStatus = "sending" | "sent" | "failed";

type PendingOutbound = Message & {
  sendStatus: OutboundStatus;
};

export function ConversationPanel({ threadId }: { threadId: string }) {
  const thread = getThread(threadId);
  const { state, dispatch } = useWorkspace();
  const [pendingOutbound, setPendingOutbound] = React.useState<PendingOutbound[]>(
    [],
  );

  const baseMessages = getMessagesForThread(threadId).filter(
    (message) => !state.deletedMessageIds.includes(message.id),
  );
  const messages = [
    ...baseMessages,
    ...pendingOutbound.filter((m) => m.threadId === threadId),
  ].sort((a, b) => a.sentAt.localeCompare(b.sentAt));

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

  const handleSend = async ({
    body,
    toIds,
    ccIds,
  }: {
    body: string;
    mode: string;
    toIds: string[];
    ccIds: string[];
  }) => {
    const id = `pending-${Date.now()}`;
    const message: PendingOutbound = {
      id,
      threadId,
      fromId: CURRENT_USER_ID,
      toIds: toIds.length ? toIds : thread.participantIds.filter((pid) => pid !== CURRENT_USER_ID),
      ccIds,
      sentAt: new Date().toISOString(),
      body,
      isOutbound: true,
      sendStatus: "sending",
    };
    setPendingOutbound((prev) => [...prev, message]);
    await sleep(700);
    setPendingOutbound((prev) =>
      prev.map((m) => (m.id === id ? { ...m, sendStatus: "sent" } : m)),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <ThreadHeader thread={thread} />

      <div className="thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-8 py-5">
        {messages.map((message) => (
          <div key={message.id} className="space-y-1">
            <MessageBubble
              message={message}
              highlighted={state.highlightedMessageId === message.id}
            />
            {"sendStatus" in message && message.sendStatus === "sending" ? (
              <p className="px-2 text-end text-[11.5px] text-[var(--text-muted)]">
                שולח…
              </p>
            ) : null}
            {"sendStatus" in message && message.sendStatus === "failed" ? (
              <div className="flex items-center justify-end gap-2 px-2 text-[11.5px] text-[var(--text-secondary)]">
                <span>השליחה נכשלה</span>
                <button
                  type="button"
                  className="font-medium hover:text-[var(--text-primary)]"
                  onClick={() => {
                    setPendingOutbound((prev) =>
                      prev.map((m) =>
                        m.id === message.id ? { ...m, sendStatus: "sending" } : m,
                      ),
                    );
                    void sleep(700).then(() => {
                      setPendingOutbound((prev) =>
                        prev.map((m) =>
                          m.id === message.id ? { ...m, sendStatus: "sent" } : m,
                        ),
                      );
                    });
                  }}
                >
                  נסה שוב
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <Composer threadId={threadId} onSend={handleSend} />
    </div>
  );
}
