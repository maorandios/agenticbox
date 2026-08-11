import { describe, expect, it } from "vitest";
import {
  assertNoSecretLeak,
  toMailAccountDto,
} from "@/server/mail/account-dto";

describe("mail account DTO security", () => {
  it("maps public fields only", () => {
    const dto = toMailAccountDto({
      id: "acc-1",
      email: "user@example.com",
      provider: "google",
      sync_status: "ready",
      last_successful_sync_at: null,
      error_message_safe: null,
    });

    expect(dto).toEqual({
      id: "acc-1",
      email: "user@example.com",
      provider: "google",
      syncStatus: "ready",
      lastSuccessfulSyncAt: null,
      errorMessageSafe: null,
      threadCountSynced: 0,
      messageCountSynced: 0,
      syncStartedAt: null,
      syncFinishedAt: null,
      syncRateLimitHits: 0,
      syncRetryCount: 0,
      backfillCompletedAt: null,
    });
    expect(dto).not.toHaveProperty("grantId");
    expect(JSON.stringify(dto)).not.toMatch(/grant/i);
  });

  it("rejects payloads containing grant identifiers", () => {
    expect(() =>
      assertNoSecretLeak({ account: { id: "1", grantId: "g-1" } }),
    ).toThrow(/sensitive field/i);
    expect(() =>
      assertNoSecretLeak({ nylas_grant_id: "secret" }),
    ).toThrow(/sensitive field/i);
  });

  it("allows safe account payloads", () => {
    expect(() =>
      assertNoSecretLeak({
        account: {
          id: "acc-1",
          email: "a@b.com",
          provider: "google",
          syncStatus: "ready",
          lastSuccessfulSyncAt: null,
          errorMessageSafe: null,
          threadCountSynced: 0,
          messageCountSynced: 0,
          syncStartedAt: null,
          syncFinishedAt: null,
          syncRateLimitHits: 0,
          syncRetryCount: 0,
          backfillCompletedAt: null,
        },
      }),
    ).not.toThrow();
  });
});
