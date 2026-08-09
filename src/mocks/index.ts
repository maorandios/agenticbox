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
import type { QueueId, Thread } from "@/types/domain";

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

export function getAttachmentsForMessage(messageId: string) {
  return attachments.filter((a) => a.messageId === messageId);
}

export function getAttachmentsForThread(threadId: string) {
  const messageIds = new Set(getMessagesForThread(threadId).map((m) => m.id));
  return attachments.filter((a) => messageIds.has(a.messageId));
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
      return thread.status === "open_tasks" || getTasksForThread(thread.id).some((t) => t.status !== "done");
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
    searchResults.find((r) => normalized.includes(r.query.toLowerCase().slice(0, 12))) ??
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
