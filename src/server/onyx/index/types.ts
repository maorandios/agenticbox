import "server-only";

export type OnyxIndexStatus =
  | "pending"
  | "processing"
  | "indexed"
  | "failed"
  | "stale"
  | "deleting"
  | "deleted";

export type OnyxIndexThreadJob = {
  type: "onyx_index_thread";
  userId: string;
  mailAccountId: string;
  threadId: string;
};

export type OnyxDeleteThreadJob = {
  type: "onyx_delete_thread";
  userId: string;
  mailAccountId: string;
  threadId: string;
  onyxDocumentId: string;
};

export type OnyxJobMessage = OnyxIndexThreadJob | OnyxDeleteThreadJob;

export type OnyxIndexProgress = {
  total: number;
  pending: number;
  processing: number;
  indexed: number;
  failed: number;
  stale: number;
  deleting: number;
  deleted: number;
};

export type OnyxIndexStateRow = {
  id: string;
  user_id: string;
  mail_account_id: string;
  thread_id: string;
  onyx_document_id: string;
  content_hash: string | null;
  status: OnyxIndexStatus;
  attempt_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  last_attempt_at: string | null;
  indexed_at: string | null;
};

export const PILOT_INDEX_LIMIT_MAX = 10;

export function getIndexMaxAttempts(): number {
  const n = Number(process.env.ONYX_INDEX_MAX_ATTEMPTS ?? 5);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(20, Math.floor(n));
}

export function clampPilotLimit(limit: number | undefined): number {
  const n = Number(limit ?? PILOT_INDEX_LIMIT_MAX);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(PILOT_INDEX_LIMIT_MAX, Math.floor(n));
}
