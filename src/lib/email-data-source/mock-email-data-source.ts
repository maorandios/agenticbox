import {
  CURRENT_USER_ID,
  getBubbleAttachments as mockBubbleAttachments,
  getDefaultInboxThreadId,
  getMessagesForThread as mockMessagesForThread,
  getParticipant as mockGetParticipant,
  getThread as mockGetThread,
  getThreadAttachmentCount as mockAttachmentCount,
  getThreadFileItems as mockThreadFileItems,
  getThreadPrimaryParticipant as mockPrimaryParticipant,
  getThreadSnapshot as mockThreadSnapshot,
  getThreadsByInboxFilter,
  isDraftThread as mockIsDraft,
  type MailboxView,
} from "@/mocks";
import type { Message, Thread } from "@/types/domain";
import type {
  EmailDataSource,
  MailAccountSummary,
  ThreadListOptions,
  ThreadListPage,
} from "./types";

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { o?: number };
    return typeof parsed.o === "number" && parsed.o >= 0 ? parsed.o : 0;
  } catch {
    return 0;
  }
}

export class MockEmailDataSource implements EmailDataSource {
  readonly mode = "mock" as const;

  async listThreads(
    mailboxView: MailboxView,
    options?: ThreadListOptions,
  ): Promise<ThreadListPage> {
    const all = getThreadsByInboxFilter(mailboxView, options);
    const limit = Math.min(Math.max(options?.limit ?? 40, 1), 50);
    const offset = decodeCursor(options?.cursor);
    const slice = all.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      threads: slice,
      nextCursor: nextOffset < all.length ? encodeCursor(nextOffset) : null,
    };
  }

  async getThread(threadId: string) {
    return mockGetThread(threadId) ?? null;
  }

  async getMessagesForThread(threadId: string) {
    return mockMessagesForThread(threadId);
  }

  async getParticipant(id: string) {
    return mockGetParticipant(id);
  }

  async getThreadPrimaryParticipant(thread: Thread) {
    return mockPrimaryParticipant(thread);
  }

  async getBubbleAttachments(message: Message) {
    return mockBubbleAttachments(message);
  }

  async getThreadFileItems(threadId: string) {
    return mockThreadFileItems(threadId);
  }

  async getThreadAttachmentCount(threadId: string) {
    return mockAttachmentCount(threadId);
  }

  async isDraftThread(threadId: string) {
    return mockIsDraft(threadId);
  }

  async getDefaultInboxThreadId() {
    return getDefaultInboxThreadId();
  }

  async getThreadSnapshot(threadId: string) {
    return mockThreadSnapshot(threadId);
  }

  supportsMockAi() {
    return true;
  }

  async getMailAccount(): Promise<MailAccountSummary | null> {
    return {
      id: "mock-account",
      email: mockGetParticipant(CURRENT_USER_ID)?.email ?? "me@example.com",
      provider: "google",
      syncStatus: "ready",
      lastSuccessfulSyncAt: null,
      errorMessageSafe: null,
    };
  }
}
