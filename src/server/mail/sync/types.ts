export type BackfillCheckpoint = {
  pageToken: string | null;
  threadsDone: number;
  messagesDone: number;
  attachmentsDone: number;
  rateLimitHits: number;
  retries: number;
  lookbackDays: number;
  maxThreads: number;
  startedAt: string | null;
};

export type BackfillJobMessage = {
  jobType: "backfill_page";
  userId: string;
  mailAccountId: string;
  pageToken: string | null;
};

/** POC default: latest 100 threads. Hard ceiling prevents arbitrary large backfills. */
export const EMAIL_SYNC_MAX_THREADS_DEFAULT = 100;
export const EMAIL_SYNC_MAX_THREADS_HARD_CAP = 500;

/**
 * Server-only backfill thread cap from EMAIL_SYNC_MAX_THREADS.
 * Positive integer only; invalid/missing → default 100; never above hard cap.
 */
export function getEmailSyncMaxThreads(): number {
  const raw = process.env.EMAIL_SYNC_MAX_THREADS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return EMAIL_SYNC_MAX_THREADS_DEFAULT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return EMAIL_SYNC_MAX_THREADS_DEFAULT;
  }
  return Math.min(EMAIL_SYNC_MAX_THREADS_HARD_CAP, Math.floor(n));
}

export function getEmailSyncLookbackDays(): number {
  const n = Number(process.env.EMAIL_SYNC_LOOKBACK_DAYS ?? 30);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(365, Math.floor(n));
}

export function defaultCheckpoint(partial?: Partial<BackfillCheckpoint>): BackfillCheckpoint {
  return {
    pageToken: null,
    threadsDone: 0,
    messagesDone: 0,
    attachmentsDone: 0,
    rateLimitHits: 0,
    retries: 0,
    lookbackDays: getEmailSyncLookbackDays(),
    maxThreads: getEmailSyncMaxThreads(),
    startedAt: null,
    ...partial,
  };
}

export function getSyncConcurrency() {
  const value = Number(process.env.EMAIL_SYNC_CONCURRENCY ?? 3);
  return Math.min(3, Math.max(1, Number.isFinite(value) ? value : 3));
}

export function getThreadsPageSize() {
  return 20;
}
