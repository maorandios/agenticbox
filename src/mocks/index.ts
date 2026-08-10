import {
  agentSnapshots,
  attachments,
  CURRENT_USER_ID,
  insights,
  messages,
  participants,
  projects,
  queueDisplayCounts,
  queueLabels,
  recentSearches,
  searchResults,
  suggestedActions,
  tasks,
  threadSnapshots,
  threads,
} from "@/mocks/data";
import type {
  Attachment,
  Message,
  MessageContentBlock,
  MessageInlineImageBlock,
  QueueId,
  Thread,
} from "@/types/domain";

export {
  agentSnapshots,
  attachments,
  CURRENT_USER_ID,
  insights,
  messages,
  participants,
  projects,
  queueDisplayCounts,
  queueLabels,
  recentSearches,
  searchResults,
  suggestedActions,
  tasks,
  threadSnapshots,
  threads,
};

export type ThreadFileItem = {
  id: string;
  fileName: string;
  sizeLabel: string;
  messageId: string;
  mimeType: string;
  appearsInBody?: boolean;
  src?: string;
  alt?: string;
};

export function getParticipant(id: string) {
  return participants.find((p) => p.id === id);
}

export function getProject(id: string) {
  return projects.find((p) => p.id === id);
}

export function getThread(id: string) {
  return threads.find((t) => t.id === id);
}

export function getThreadPrimaryParticipant(thread: Thread) {
  const other = thread.participantIds.find((id) => id !== CURRENT_USER_ID);
  return getParticipant(other ?? thread.participantIds[0]);
}

export function getMessagesForThread(threadId: string) {
  return messages
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function getMessageById(id: string) {
  return messages.find((m) => m.id === id);
}

/** Full source message the sender replied to, when known. */
export function resolveRepliedToMessage(message: Message): Message | null {
  if (message.repliedToMessageId) {
    return getMessageById(message.repliedToMessageId) ?? null;
  }

  const hasQuote =
    Boolean(message.quotedText) ||
    Boolean(message.content?.some((b) => b.type === "quoted-text"));
  if (!hasQuote) return null;

  const threadMessages = getMessagesForThread(message.threadId);
  const index = threadMessages.findIndex((m) => m.id === message.id);
  if (index <= 0) return null;
  return threadMessages[index - 1] ?? null;
}

function isExcludedInlineImage(block: MessageInlineImageBlock) {
  if (block.isTrackingPixel || block.isSpacer || block.isSignatureLogo) return true;
  if (block.width === 1 && block.height === 1) return true;
  return false;
}

export function getInlineImagesFromMessage(message: Message): MessageInlineImageBlock[] {
  if (!message.content) return [];
  return message.content.filter(
    (b): b is MessageInlineImageBlock =>
      b.type === "inline-image" && !isExcludedInlineImage(b),
  );
}

export function getRenderableContent(message: Message): MessageContentBlock[] {
  if (!message.content?.length) {
    return [{ type: "paragraph", id: `${message.id}-body`, text: message.body }];
  }
  return message.content.filter((block) => {
    if (block.type !== "inline-image") return true;
    return !isExcludedInlineImage(block);
  });
}

/** Legacy helper — non-inline attachments for a message id. */
export function getAttachmentsForMessage(messageId: string) {
  const message = messages.find((m) => m.id === messageId);
  if (!message) return [];
  return getBubbleAttachments(message);
}

/** Attachments shown under a bubble (excludes inline body images). */
export function getBubbleAttachments(message: Message): Attachment[] {
  if (message.content?.some((b) => b.type === "attachment")) {
    const ids = message.content
      .filter(
        (b): b is Extract<MessageContentBlock, { type: "attachment" }> =>
          b.type === "attachment",
      )
      .map((b) => b.attachmentId);
    return ids
      .map((id) => attachments.find((a) => a.id === id))
      .filter((a): a is Attachment => Boolean(a))
      .filter((a) => !a.inlineInBody);
  }

  return (message.attachmentIds ?? [])
    .map((id) => attachments.find((a) => a.id === id))
    .filter((a): a is Attachment => Boolean(a))
    .filter((a) => !a.inlineInBody);
}

export function getAttachmentsForThread(threadId: string) {
  const messageIds = new Set(getMessagesForThread(threadId).map((m) => m.id));
  return attachments.filter((a) => messageIds.has(a.messageId) && !a.inlineInBody);
}

export function getThreadFileItems(threadId: string): ThreadFileItem[] {
  const threadMessages = getMessagesForThread(threadId);
  const items: ThreadFileItem[] = [];

  for (const message of threadMessages) {
    for (const att of getBubbleAttachments(message)) {
      items.push({
        id: att.id,
        fileName: att.fileName,
        sizeLabel: att.sizeLabel,
        messageId: message.id,
        mimeType: att.mimeType,
        appearsInBody: false,
        src: att.src,
        alt: att.alt,
      });
    }
    for (const image of getInlineImagesFromMessage(message)) {
      items.push({
        id: image.id,
        fileName: image.fileName,
        sizeLabel: image.sizeLabel ?? "—",
        messageId: message.id,
        mimeType: image.mimeType ?? "image/jpeg",
        appearsInBody: true,
        src: image.src,
        alt: image.alt,
      });
    }
  }

  return items;
}

export function getTasksForThread(threadId: string) {
  return tasks.filter((t) => t.threadId === threadId);
}

export function getInsightsForThread(threadId: string) {
  return insights.filter((i) => i.threadId === threadId);
}

export function getAgentSnapshot(threadId: string) {
  return agentSnapshots.find((s) => s.threadId === threadId);
}

export function getSuggestedAction(threadId: string) {
  return suggestedActions.find((s) => s.threadId === threadId);
}

export function threadMatchesQueue(thread: Thread, queue: QueueId) {
  switch (queue) {
    case "needs_reply":
      return thread.status === "needs_reply";
    case "waiting":
      return thread.status === "waiting";
    case "open_tasks":
      return (
        thread.status === "open_tasks" ||
        getTasksForThread(thread.id).some((t) => t.status !== "done")
      );
    case "unread":
      return thread.unread || thread.status === "unread";
    case "done":
      return thread.status === "done";
    default:
      return true;
  }
}

export function getThreadsByQueue(queue: QueueId) {
  return threads
    .filter((t) => threadMatchesQueue(t, queue))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function searchMock(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const exact = searchResults.find((r) => r.query.toLowerCase() === normalized);
  if (exact) return exact;

  return (
    searchResults.find((r) => r.query.toLowerCase().includes(normalized)) ??
    searchResults.find((r) =>
      normalized.includes(r.query.toLowerCase().slice(0, 12)),
    ) ??
    null
  );
}

export function getThreadsByInboxFilter(
  filter: "all" | "needs_reply" | "waiting" | "starred" | "archived",
  options?: {
    starredThreadIds?: string[];
    archivedThreadIds?: string[];
    deletedThreadIds?: string[];
  },
) {
  const starred = new Set(options?.starredThreadIds ?? []);
  const archived = new Set(options?.archivedThreadIds ?? []);
  const deleted = new Set(options?.deletedThreadIds ?? []);

  let list = threads.filter((t) => !deleted.has(t.id));

  if (filter === "archived") {
    list = list.filter((t) => archived.has(t.id));
  } else if (filter === "starred") {
    list = list.filter((t) => starred.has(t.id));
  } else {
    list = list.filter((t) => !archived.has(t.id));
    if (filter === "all") {
      list = list.filter((t) => t.status !== "done");
    } else {
      list = list.filter((t) => threadMatchesQueue(t, filter));
    }
  }

  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getThreadSnapshot(threadId: string) {
  return threadSnapshots.find((s) => s.threadId === threadId) ?? threadSnapshots[0];
}

export function getDefaultInboxThreadId() {
  return "thr-cityhub";
}
