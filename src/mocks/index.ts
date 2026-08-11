import {
  agentSnapshots,
  attachments,
  CURRENT_USER_ID,
  draftThreadIds,
  insights,
  mailboxDisplayCounts,
  messages,
  participants,
  queueDisplayCounts,
  queueLabels,
  recentSearches,
  searchResults,
  sentThreadIds,
  suggestedActions,
  tasks,
  threadSnapshots,
  threads,
} from "@/mocks/data";
import type {
  Attachment,
  GroupedSearchResults,
  Message,
  MessageContentBlock,
  MessageInlineImageBlock,
  QueueId,
  SearchHit,
  Thread,
} from "@/types/domain";

export {
  agentSnapshots,
  attachments,
  CURRENT_USER_ID,
  draftThreadIds,
  insights,
  mailboxDisplayCounts,
  messages,
  participants,
  queueDisplayCounts,
  queueLabels,
  recentSearches,
  searchResults,
  sentThreadIds,
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

export type MailboxView =
  | "inbox"
  | "unread"
  | "starred"
  | "sent"
  | "drafts"
  | "archive"
  | "trash";

export type SmartFilter = "all" | "needs_reply" | "open_tasks";

/** @deprecated Prefer MailboxView + SmartFilter */
export type InboxListFilter = MailboxView | SmartFilter;

export function getParticipant(id: string) {
  return participants.find((p) => p.id === id);
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
  return tasks.filter((t) => t.sourceThreadId === threadId);
}

export function getAllTasks() {
  return tasks;
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
    case "open_tasks":
      return (
        thread.status === "open_tasks" ||
        getTasksForThread(thread.id).some((t) => t.status === "open")
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

function includesQuery(haystack: string | undefined | null, query: string) {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(query);
}

function messagePlainText(message: Message) {
  if (!message.content?.length) return message.body;
  return message.content
    .map((block) => {
      if (block.type === "paragraph" || block.type === "quoted-text") return block.text;
      if (block.type === "list") return block.items.join(" ");
      if (block.type === "inline-image") return block.fileName;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function signatureSearchText(message: Message) {
  const snap = message.signatureSnapshot;
  if (!snap) return message.signature ?? "";
  return [
    snap.name,
    snap.title,
    snap.company,
    ...(snap.descriptionBlocks ?? []),
    ...(snap.phoneNumbers ?? []),
    ...(snap.emailAddresses ?? []),
    ...(snap.links ?? []).flatMap((l) => [l.url, l.anchorText]),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Keyword search across mailbox content — grouped, each hit links to a source message. */
export function searchMailbox(query: string): GroupedSearchResults {
  const q = query.trim().toLowerCase();
  const empty: GroupedSearchResults = {
    query: query.trim(),
    threads: [],
    messages: [],
    tasks: [],
    decisions: [],
    files: [],
    signatures: [],
  };
  if (!q) return empty;

  const threadHits: SearchHit[] = [];
  const messageHits: SearchHit[] = [];
  const taskHits: SearchHit[] = [];
  const decisionHits: SearchHit[] = [];
  const fileHits: SearchHit[] = [];
  const signatureHits: SearchHit[] = [];

  for (const thread of threads) {
    if (draftThreadIds.includes(thread.id)) continue;

    const subjectHit = includesQuery(thread.subject, q) || includesQuery(thread.snippet, q);
    const participantHit = thread.participantIds.some((id) => {
      const p = getParticipant(id);
      return (
        includesQuery(p?.name, q) ||
        includesQuery(p?.email, q) ||
        includesQuery(p?.company, q)
      );
    });

    const threadMessages = getMessagesForThread(thread.id);
    const firstMsg = threadMessages[0];
    const latestMsg = threadMessages[threadMessages.length - 1];
    const dateHit = threadMessages.some(
      (m) => includesQuery(m.sentAt, q) || includesQuery(thread.updatedAt, q),
    );

    if (subjectHit || participantHit || dateHit) {
      threadHits.push({
        id: `hit-thread-${thread.id}`,
        kind: "thread",
        title: thread.subject,
        snippet: thread.snippet,
        threadId: thread.id,
        sourceMessageId: latestMsg?.id ?? firstMsg?.id ?? "",
        meta: getThreadPrimaryParticipant(thread)?.name,
      });
    }

    for (const message of threadMessages) {
      const from = getParticipant(message.fromId);
      const recipients = [...message.toIds, ...(message.ccIds ?? [])]
        .map((id) => getParticipant(id))
        .filter(Boolean);
      const body = messagePlainText(message);
      const hitBody =
        includesQuery(body, q) ||
        includesQuery(message.subject, q) ||
        includesQuery(from?.name, q) ||
        includesQuery(from?.email, q) ||
        includesQuery(from?.company, q) ||
        recipients.some(
          (p) =>
            includesQuery(p?.name, q) ||
            includesQuery(p?.email, q) ||
            includesQuery(p?.company, q),
        ) ||
        includesQuery(message.sentAt, q);

      if (hitBody) {
        messageHits.push({
          id: `hit-msg-${message.id}`,
          kind: "message",
          title: from?.name ?? "הודעה",
          snippet: body.slice(0, 140),
          threadId: thread.id,
          sourceMessageId: message.id,
          meta: thread.subject,
        });
      }

      const sigText = signatureSearchText(message);
      if (includesQuery(sigText, q)) {
        signatureHits.push({
          id: `hit-sig-${message.id}`,
          kind: "signature",
          title: message.signatureSnapshot?.name ?? from?.name ?? "חתימה",
          snippet: sigText.slice(0, 140),
          threadId: thread.id,
          sourceMessageId: message.id,
          meta: [
            message.signatureSnapshot?.title,
            message.signatureSnapshot?.company,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    }

    for (const file of getThreadFileItems(thread.id)) {
      if (
        includesQuery(file.fileName, q) ||
        includesQuery(file.mimeType, q) ||
        includesQuery(file.sizeLabel, q)
      ) {
        fileHits.push({
          id: `hit-file-${file.id}`,
          kind: "file",
          title: file.fileName,
          snippet: `${file.sizeLabel} · ${file.mimeType}`,
          threadId: thread.id,
          sourceMessageId: file.messageId,
          meta: thread.subject,
        });
      }
    }
  }

  for (const task of tasks) {
    if (
      includesQuery(task.title, q) ||
      includesQuery(task.sourceSenderName, q) ||
      includesQuery(task.sourceSenderEmail, q) ||
      includesQuery(task.dueDate, q)
    ) {
      taskHits.push({
        id: `hit-task-${task.id}`,
        kind: "task",
        title: task.title,
        snippet: `${task.sourceSenderName} · ${task.sourceSenderEmail}`,
        threadId: task.sourceThreadId,
        sourceMessageId: task.sourceMessageId,
        meta: task.status === "open" ? "פתוחה" : task.status === "completed" ? "הושלמה" : "בוטלה",
      });
    }
  }

  for (const insight of insights) {
    if (insight.kind !== "decision") continue;
    if (
      includesQuery(insight.title, q) ||
      includesQuery(insight.detail, q)
    ) {
      decisionHits.push({
        id: `hit-dec-${insight.id}`,
        kind: "decision",
        title: insight.title,
        snippet: insight.detail,
        threadId: insight.threadId,
        sourceMessageId: insight.sourceMessageId ?? "",
        meta: getThread(insight.threadId)?.subject,
      });
    }
  }

  for (const snap of threadSnapshots) {
    for (const decision of snap.decisions) {
      if (
        decisionHits.some((h) => h.sourceMessageId === decision.sourceMessageId && h.title === decision.title)
      ) {
        continue;
      }
      if (
        includesQuery(decision.title, q) ||
        includesQuery(decision.body, q) ||
        includesQuery(decision.userName, q)
      ) {
        decisionHits.push({
          id: `hit-dec-snap-${decision.id}`,
          kind: "decision",
          title: decision.title,
          snippet: decision.body ?? decision.title,
          threadId: snap.threadId,
          sourceMessageId: decision.sourceMessageId,
          meta: decision.userName,
        });
      }
    }
  }

  return {
    query: query.trim(),
    threads: threadHits,
    messages: messageHits,
    tasks: taskHits,
    decisions: decisionHits,
    files: fileHits,
    signatures: signatureHits,
  };
}

export function getThreadsByInboxFilter(
  filter: InboxListFilter,
  options?: {
    starredThreadIds?: string[];
    archivedThreadIds?: string[];
    deletedThreadIds?: string[];
    smartFilter?: SmartFilter;
    query?: string;
    includeComposeDraft?: boolean;
  },
) {
  const starred = new Set(options?.starredThreadIds ?? []);
  const archived = new Set(options?.archivedThreadIds ?? []);
  const deleted = new Set(options?.deletedThreadIds ?? []);
  const sent = new Set(sentThreadIds);
  const drafts = new Set(draftThreadIds);

  const mailboxViews = new Set<MailboxView>([
    "inbox",
    "unread",
    "starred",
    "sent",
    "drafts",
    "archive",
    "trash",
  ]);
  const mailboxView: MailboxView = mailboxViews.has(filter as MailboxView)
    ? (filter as MailboxView)
    : "inbox";
  const smartFilter: SmartFilter =
    options?.smartFilter ??
    (filter === "needs_reply" || filter === "open_tasks" ? filter : "all");

  let list = [...threads];

  if (mailboxView === "trash") {
    list = list.filter((t) => deleted.has(t.id));
  } else if (mailboxView === "archive") {
    list = list.filter((t) => archived.has(t.id) && !deleted.has(t.id));
  } else if (mailboxView === "drafts") {
    list = list.filter((t) => drafts.has(t.id) && !deleted.has(t.id));
    if (!options?.includeComposeDraft) {
      list = list.filter((t) => t.id !== "thr-compose-new");
    }
  } else if (mailboxView === "sent") {
    list = list.filter(
      (t) => sent.has(t.id) && !deleted.has(t.id) && !archived.has(t.id),
    );
  } else if (mailboxView === "starred") {
    list = list.filter(
      (t) => starred.has(t.id) && !deleted.has(t.id) && !drafts.has(t.id),
    );
  } else if (mailboxView === "unread") {
    list = list.filter(
      (t) =>
        t.unread &&
        !deleted.has(t.id) &&
        !archived.has(t.id) &&
        !drafts.has(t.id) &&
        !sent.has(t.id),
    );
  } else {
    list = list.filter(
      (t) =>
        !deleted.has(t.id) &&
        !archived.has(t.id) &&
        !drafts.has(t.id) &&
        !sent.has(t.id),
    );
    list = list.filter((t) => t.status !== "done");
  }

  if (smartFilter === "needs_reply") {
    list = list.filter((t) => threadMatchesQueue(t, "needs_reply"));
  } else if (smartFilter === "open_tasks") {
    list = list.filter((t) => threadMatchesQueue(t, "open_tasks"));
  }

  const q = options?.query?.trim().toLowerCase();
  if (q) {
    list = list.filter((thread) => threadMatchesQuickSearch(thread, q));
  }

  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function threadMatchesQuickSearch(thread: Thread, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (thread.subject.toLowerCase().includes(q)) return true;
  if (thread.snippet.toLowerCase().includes(q)) return true;
  const participantHit = thread.participantIds.some((id) => {
    const p = getParticipant(id);
    return (
      Boolean(p?.name.toLowerCase().includes(q)) ||
      Boolean(p?.email.toLowerCase().includes(q))
    );
  });
  if (participantHit) return true;
  return getMessagesForThread(thread.id).some((message) =>
    messagePlainText(message).toLowerCase().includes(q),
  );
}

/** AI-derived action needed — kept in model; not shown in the thread list. */
export function getThreadRequiresAction(thread: Thread) {
  return thread.status === "needs_reply";
}

export function getThreadOpenTaskCount(threadId: string) {
  return getTasksForThread(threadId).filter((t) => t.status === "open").length;
}

export function getThreadAttachmentCount(threadId: string) {
  return getThreadFileItems(threadId).length;
}

export function isDraftThread(threadId: string) {
  return draftThreadIds.includes(threadId);
}

export function getThreadSnapshot(threadId: string) {
  return threadSnapshots.find((s) => s.threadId === threadId) ?? threadSnapshots[0];
}

export function getDefaultInboxThreadId() {
  return "thr-cityhub";
}
