export type QueueId =
  | "needs_reply"
  | "waiting"
  | "open_tasks"
  | "unread"
  | "done";

export type MailboxStatus = "connected" | "disconnected";

export type Participant = {
  id: string;
  name: string;
  email: string;
  company?: string;
  initials: string;
  avatarUrl?: string;
};

export type Project = {
  id: string;
  name: string;
  participantIds: string[];
  threadIds: string[];
  openTaskCount: number;
  latestDecision?: string;
};

export type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeLabel: string;
  messageId: string;
};

export type Message = {
  id: string;
  threadId: string;
  fromId: string;
  toIds: string[];
  ccIds?: string[];
  replyToId?: string;
  sentAt: string;
  subject?: string;
  body: string;
  isOutbound: boolean;
  quotedText?: string;
  signature?: string;
  attachmentIds?: string[];
};

export type ThreadStatus =
  | "needs_reply"
  | "waiting"
  | "open_tasks"
  | "unread"
  | "done";

export type Thread = {
  id: string;
  subject: string;
  snippet: string;
  participantIds: string[];
  projectId?: string;
  status: ThreadStatus;
  unread: boolean;
  updatedAt: string;
  badge?: string;
  language: "he" | "en" | "mixed";
};

export type TaskStatus = "open" | "waiting" | "overdue" | "done";

export type Task = {
  id: string;
  title: string;
  threadId: string;
  assigneeId?: string | null;
  dueAt?: string;
  status: TaskStatus;
  sourceMessageId: string;
};

export type InsightKind =
  | "change"
  | "decision"
  | "question"
  | "waiting"
  | "commitment"
  | "task"
  | "project_suggestion";

export type Insight = {
  id: string;
  threadId: string;
  kind: InsightKind;
  title: string;
  detail: string;
  sourceMessageId?: string;
  actionable?: boolean;
};

export type SuggestedAction = {
  id: string;
  threadId: string;
  title: string;
  rationale: string;
  draftReply?: string;
};

export type AgentSnapshot = {
  threadId: string;
  statusLabel: string;
  summary: string;
  whatChanged: Insight[];
  suggestedAction?: SuggestedAction;
  tasks: string[];
  decisions: string[];
  questions: string[];
  waitingOn: string[];
  commitments: string[];
  projectSuggestion?: {
    projectId: string;
    reason: string;
  };
};

export type SearchMode = "keyword" | "nl";

export type SearchResult = {
  id: string;
  query: string;
  mode: SearchMode;
  answer?: string;
  insufficient?: boolean;
  sourceMessageIds: string[];
  threadIds: string[];
};

export type ThreadSnapshotPrimaryMode = "needs_you" | "waiting" | "none";

export type ThreadPrimaryAction = {
  id: string;
  title: string;
  metadata: string;
  sourceMessageId: string;
  /** Shown when the action likely needs work beyond an email reply */
  recommendAsTask?: boolean;
};

export type ThreadSnapshotItem = {
  id: string;
  title: string;
  sourceMessageId: string;
  assigneeId?: string | null;
  /** Bold leading name when present */
  actorName?: string;
  /** Rest of the line after actorName */
  body?: string;
  dueLabel?: string;
  userName: string;
  userEmail: string;
};

export type ThreadSnapshot = {
  threadId: string;
  updatedLabel: string;
  primary: {
    mode: ThreadSnapshotPrimaryMode;
    actions: ThreadPrimaryAction[];
    /** Fallback draft; live draft is composed from active actions */
    draftReply?: string;
  };
  recentChanges: ThreadSnapshotItem[];
  openTasks: ThreadSnapshotItem[];
  decisions: ThreadSnapshotItem[];
  waitingOn: ThreadSnapshotItem[];
};
