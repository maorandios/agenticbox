import { describe, expect, it } from "vitest";

/** Mirrors upsertMailAccountFromGrant branching for idempotency. */
function resolveUpsertAction(input: {
  grantOwnerUserId: string | null;
  currentUserId: string;
  existingEmailAccountId: string | null;
}) {
  if (input.grantOwnerUserId) {
    if (input.grantOwnerUserId !== input.currentUserId) {
      return { action: "reject_foreign_grant" as const };
    }
    return { action: "update_existing_by_grant" as const, created: false };
  }
  if (input.existingEmailAccountId) {
    return { action: "reconnect_by_email" as const, created: false };
  }
  return { action: "insert_new" as const, created: true };
}

describe("mail account upsert idempotency", () => {
  it("updates when grant already linked to same user", () => {
    expect(
      resolveUpsertAction({
        grantOwnerUserId: "user-a",
        currentUserId: "user-a",
        existingEmailAccountId: null,
      }),
    ).toEqual({ action: "update_existing_by_grant", created: false });
  });

  it("rejects grant owned by another user", () => {
    expect(
      resolveUpsertAction({
        grantOwnerUserId: "user-b",
        currentUserId: "user-a",
        existingEmailAccountId: null,
      }),
    ).toEqual({ action: "reject_foreign_grant" });
  });

  it("does not create a duplicate for same email reconnect", () => {
    expect(
      resolveUpsertAction({
        grantOwnerUserId: null,
        currentUserId: "user-a",
        existingEmailAccountId: "acc-1",
      }),
    ).toEqual({ action: "reconnect_by_email", created: false });
  });
});
