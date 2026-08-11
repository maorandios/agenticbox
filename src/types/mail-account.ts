/** Public mail account DTO — never includes grant ids or Nylas tokens. */
export type MailAccountDto = {
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
  threadCountSynced: number;
  messageCountSynced: number;
  syncStartedAt: string | null;
  syncFinishedAt: string | null;
  syncRateLimitHits: number;
  syncRetryCount: number;
  backfillCompletedAt: string | null;
};
