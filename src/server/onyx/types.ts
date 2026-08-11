import "server-only";

export type OnyxAskStatus = "answered" | "insufficient_evidence" | "failed";

export type OnyxSourceRef = {
  documentId: string;
  citationNumber: number | null;
  semanticIdentifier: string | null;
  blurb: string | null;
  link: string | null;
  metadata: Record<string, string | string[]>;
};

export type OnyxAskResult = {
  status: OnyxAskStatus;
  answer: string;
  sources: OnyxSourceRef[];
  chatSessionId: string | null;
  requestId: string;
  latencyMs: number;
  errorCode?: string;
};

export type OnyxUpsertResult = {
  documentId: string;
  alreadyExisted: boolean;
  requestId: string;
  latencyMs: number;
};

export type OnyxDeleteResult = {
  documentId: string;
  deleted: boolean;
  alreadyAbsent: boolean;
  requestId: string;
  latencyMs: number;
};

export type OnyxHealthResult = {
  ok: boolean;
  message: string | null;
  requestId: string;
  latencyMs: number;
};
