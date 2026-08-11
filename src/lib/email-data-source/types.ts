import type {
  Attachment,
  Message,
  Participant,
  Thread,
  ThreadSnapshot,
} from "@/types/domain";
import type { MailboxView, SmartFilter, ThreadFileItem } from "@/mocks";

export type ThreadListOptions = {
  starredThreadIds?: string[];
  archivedThreadIds?: string[];
  deletedThreadIds?: string[];
  smartFilter?: SmartFilter;
  query?: string;
  includeComposeDraft?: boolean;
  /** Cursor from previous page (opaque). */
  cursor?: string | null;
  /** Page size; API mode defaults to EMAIL_THREADS_PAGE_SIZE (30–50). */
  limit?: number;
};

export type ThreadListPage = {
  threads: Thread[];
  nextCursor: string | null;
};

export type MailAccountSummary = {
  id: string;
  email: string;
  provider: "google" | "microsoft";
  syncStatus:
    | "pending"
    | "syncing"
    | "ready"
    | "error"
    | "needs_reconnect"
    | "disconnected";
  lastSuccessfulSyncAt: string | null;
  errorMessageSafe: string | null;
};

/**
 * UI-facing mail data port. Implementations must return domain models only —
 * never raw Nylas objects, grant ids, or raw HTML.
 */
export interface EmailDataSource {
  readonly mode: "mock" | "api";

  listThreads(
    mailboxView: MailboxView,
    options?: ThreadListOptions,
  ): Promise<ThreadListPage>;

  getThread(threadId: string): Promise<Thread | null>;

  getMessagesForThread(threadId: string): Promise<Message[]>;

  getParticipant(id: string): Promise<Participant | undefined>;

  getThreadPrimaryParticipant(
    thread: Thread,
  ): Promise<Participant | undefined>;

  getBubbleAttachments(message: Message): Promise<Attachment[]>;

  getThreadFileItems(threadId: string): Promise<ThreadFileItem[]>;

  getThreadAttachmentCount(threadId: string): Promise<number>;

  isDraftThread(threadId: string): Promise<boolean>;

  getDefaultInboxThreadId(): Promise<string | null>;

  /** Mock-only insights. API mode returns null (UI shows neutral placeholder). */
  getThreadSnapshot(threadId: string): Promise<ThreadSnapshot | null>;

  /** Whether mock AI / insights surfaces should render. */
  supportsMockAi(): boolean;

  getMailAccount(): Promise<MailAccountSummary | null>;
}
