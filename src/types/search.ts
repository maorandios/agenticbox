export type SearchAnswerStatus =
  | "answered"
  | "insufficient_evidence"
  | "failed"
  | "no_indexed_data"
  | "no_account";

export type SearchSourceDto = {
  id: string;
  threadId: string;
  messageId: string | null;
  title: string;
  senderNames: string[];
  senderEmails: string[];
  lastMessageAt: string;
  messageCount: number;
  snippet: string;
  sourceUrl: string;
};

export type SearchAnswerDto = {
  status: SearchAnswerStatus;
  answer: string;
  chatSessionId: string | null;
  requestId: string;
  latencyMs: number;
  sources: SearchSourceDto[];
  errorCode?: string;
};

export type AskRequestBody = {
  question: string;
  chatSessionId?: string | null;
};
