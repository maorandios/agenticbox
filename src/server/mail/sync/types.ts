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

export function defaultCheckpoint(partial?: Partial<BackfillCheckpoint>): BackfillCheckpoint {
  return {
    pageToken: null,
    threadsDone: 0,
    messagesDone: 0,
    attachmentsDone: 0,
    rateLimitHits: 0,
    retries: 0,
    lookbackDays: Number(process.env.EMAIL_SYNC_LOOKBACK_DAYS ?? 30),
    maxThreads: Number(process.env.EMAIL_SYNC_MAX_THREADS ?? 500),
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
