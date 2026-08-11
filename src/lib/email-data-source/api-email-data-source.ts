import type {
  Attachment,
  Message,
  Participant,
  Thread,
} from "@/types/domain";
import type { MailboxView, ThreadFileItem } from "@/mocks";
import type {
  EmailDataSource,
  MailAccountSummary,
  ThreadListOptions,
  ThreadListPage,
} from "./types";

type ThreadResponse = {
  thread: Thread;
  participants: Participant[];
  attachmentCount?: number;
};

type MessagesResponse = {
  messages: Message[];
  participants: Participant[];
  attachments: Attachment[];
};

type ThreadsResponse = {
  threads: Thread[];
  participants: Participant[];
  nextCursor: string | null;
};

/**
 * Client/server fetch-backed data source for Application APIs.
 * Never silently falls back to mocks. Never returns grant ids or raw HTML.
 */
export class ApiEmailDataSource implements EmailDataSource {
  readonly mode = "api" as const;

  private participants = new Map<string, Participant>();
  private attachmentsByMessage = new Map<string, Attachment[]>();
  private attachmentCountByThread = new Map<string, number>();
  private currentUserParticipantId: string | null = null;

  private rememberParticipants(list: Participant[] | undefined) {
    for (const p of list ?? []) this.participants.set(p.id, p);
  }

  private rememberAttachments(list: Attachment[] | undefined) {
    for (const a of list ?? []) {
      const existing = this.attachmentsByMessage.get(a.messageId) ?? [];
      if (!existing.some((x) => x.id === a.id)) {
        existing.push(a);
        this.attachmentsByMessage.set(a.messageId, existing);
      }
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.status === 401) {
      throw new Error("unauthorized");
    }
    if (res.status === 404) {
      throw new Error("not_found");
    }
    if (!res.ok) {
      throw new Error(`api_error:${res.status}`);
    }
    return (await res.json()) as T;
  }

  async listThreads(
    mailboxView: MailboxView,
    options?: ThreadListOptions,
  ): Promise<ThreadListPage> {
    const params = new URLSearchParams();
    params.set("mailbox", mailboxView);
    if (options?.cursor) params.set("cursor", options.cursor);
    if (options?.limit) params.set("limit", String(options.limit));
    const data = await this.fetchJson<ThreadsResponse>(
      `/api/mail/threads?${params.toString()}`,
    );
    this.rememberParticipants(data.participants);
    return { threads: data.threads, nextCursor: data.nextCursor };
  }

  async getThread(threadId: string): Promise<Thread | null> {
    try {
      const data = await this.fetchJson<ThreadResponse>(
        `/api/mail/threads/${encodeURIComponent(threadId)}`,
      );
      this.rememberParticipants(data.participants);
      if (typeof data.attachmentCount === "number") {
        this.attachmentCountByThread.set(threadId, data.attachmentCount);
      }
      return data.thread;
    } catch (error) {
      if (error instanceof Error && error.message === "not_found") return null;
      throw error;
    }
  }

  async getMessagesForThread(threadId: string): Promise<Message[]> {
    try {
      const data = await this.fetchJson<MessagesResponse>(
        `/api/mail/threads/${encodeURIComponent(threadId)}/messages`,
      );
      this.rememberParticipants(data.participants);
      this.rememberAttachments(data.attachments);
      const nonInline = (data.attachments ?? []).filter((a) => !a.inlineInBody);
      this.attachmentCountByThread.set(threadId, nonInline.length);
      return data.messages;
    } catch (error) {
      if (error instanceof Error && error.message === "not_found") return [];
      throw error;
    }
  }

  async getParticipant(id: string): Promise<Participant | undefined> {
    return this.participants.get(id);
  }

  async getThreadPrimaryParticipant(
    thread: Thread,
  ): Promise<Participant | undefined> {
    if (this.currentUserParticipantId) {
      const other = thread.participantIds.find(
        (id) => id !== this.currentUserParticipantId,
      );
      if (other) return this.participants.get(other);
    }
    const first = thread.participantIds[0];
    return first ? this.participants.get(first) : undefined;
  }

  async getBubbleAttachments(message: Message): Promise<Attachment[]> {
    const cached = this.attachmentsByMessage.get(message.id);
    if (cached) {
      return cached.filter((a) => !a.inlineInBody);
    }
    if (!message.attachmentIds?.length) return [];
    return message.attachmentIds.map((id) => ({
      id,
      fileName: "attachment",
      mimeType: "application/octet-stream",
      sizeLabel: "",
      messageId: message.id,
      src: `/api/mail/attachments/${id}`,
    }));
  }

  async getThreadFileItems(threadId: string): Promise<ThreadFileItem[]> {
    const messages = await this.getMessagesForThread(threadId);
    const items: ThreadFileItem[] = [];
    for (const message of messages) {
      const files = await this.getBubbleAttachments(message);
      for (const file of files) {
        items.push({
          id: file.id,
          fileName: file.fileName,
          sizeLabel: file.sizeLabel,
          messageId: file.messageId,
          mimeType: file.mimeType,
          appearsInBody: file.inlineInBody,
          src: file.src,
          alt: file.alt,
        });
      }
    }
    return items;
  }

  async getThreadAttachmentCount(threadId: string): Promise<number> {
    const cached = this.attachmentCountByThread.get(threadId);
    if (typeof cached === "number") return cached;
    const thread = await this.getThread(threadId);
    if (!thread) return 0;
    return this.attachmentCountByThread.get(threadId) ?? 0;
  }

  async isDraftThread(threadId: string): Promise<boolean> {
    void threadId;
    return false;
  }

  async getDefaultInboxThreadId(): Promise<string | null> {
    const page = await this.listThreads("inbox", { limit: 30 });
    return page.threads[0]?.id ?? null;
  }

  async getThreadSnapshot(threadId: string) {
    void threadId;
    return null;
  }

  supportsMockAi() {
    return false;
  }

  async getMailAccount(): Promise<MailAccountSummary | null> {
    const data = await this.fetchJson<{
      account: {
        id: string;
        email: string;
        provider: "google" | "microsoft";
        syncStatus: MailAccountSummary["syncStatus"];
        lastSuccessfulSyncAt: string | null;
        errorMessageSafe: string | null;
      } | null;
    }>("/api/mail/account");
    if (!data.account) return null;
    this.currentUserParticipantId = `p:${data.account.email.trim().toLowerCase()}`;
    return {
      id: data.account.id,
      email: data.account.email,
      provider: data.account.provider,
      syncStatus: data.account.syncStatus,
      lastSuccessfulSyncAt: data.account.lastSuccessfulSyncAt,
      errorMessageSafe: data.account.errorMessageSafe,
    };
  }
}
