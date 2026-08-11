import type { MailAccountDto } from "@/types/mail-account";

export type { MailAccountDto };

const FORBIDDEN_KEYS = [
  "grant",
  "grantid",
  "grant_id",
  "nylas_grant_id",
  "nylasgrantid",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "clientsecret",
  "api_key",
  "apikey",
  "rawhtml",
  "raw_html",
  "providerattachmentid",
  "provider_attachment_id",
  "providermessageid",
  "provider_message_id",
  "providerthreadid",
  "provider_thread_id",
];

export function toMailAccountDto(row: {
  id: string;
  email: string;
  provider: string;
  sync_status: string;
  last_successful_sync_at: string | null;
  error_message_safe: string | null;
  thread_count_synced?: number | null;
  message_count_synced?: number | null;
  sync_started_at?: string | null;
  sync_finished_at?: string | null;
  sync_rate_limit_hits?: number | null;
  sync_retry_count?: number | null;
  backfill_completed_at?: string | null;
}): MailAccountDto {
  return {
    id: row.id,
    email: row.email,
    provider: row.provider === "microsoft" ? "microsoft" : "google",
    syncStatus: row.sync_status as MailAccountDto["syncStatus"],
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    errorMessageSafe: row.error_message_safe,
    threadCountSynced: row.thread_count_synced ?? 0,
    messageCountSynced: row.message_count_synced ?? 0,
    syncStartedAt: row.sync_started_at ?? null,
    syncFinishedAt: row.sync_finished_at ?? null,
    syncRateLimitHits: row.sync_rate_limit_hits ?? 0,
    syncRetryCount: row.sync_retry_count ?? 0,
    backfillCompletedAt: row.backfill_completed_at ?? null,
  };
}

/** Defense-in-depth: reject accidental grant/token leakage in API payloads. */
export function assertNoSecretLeak(payload: unknown, path = "root"): void {
  if (payload == null) return;

  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertNoSecretLeak(item, `${path}[${index}]`));
    return;
  }

  if (typeof payload !== "object") return;

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (FORBIDDEN_KEYS.some((forbidden) => normalized.includes(forbidden))) {
      throw new Error(`Refusing to expose sensitive field: ${path}.${key}`);
    }
    assertNoSecretLeak(value, `${path}.${key}`);
  }
}
