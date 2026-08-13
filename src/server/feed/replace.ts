/**
 * Atomic / ordered feed item replacement — never supersede before a valid insert.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReplaceFeedItemOpts = {
  userId: string;
  oldFeedItemId: string;
  newFeedItemId: string;
  statusReason: string;
};

/**
 * After a successful insert of `newFeedItemId`, mark the prior item superseded
 * and set superseded_by_feed_item_id when the column exists.
 */
export async function finalizeFeedItemReplacement(
  opts: ReplaceFeedItemOpts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const withReverse = {
    status: "superseded",
    status_reason: opts.statusReason,
    superseded_by_feed_item_id: opts.newFeedItemId,
    updated_at: now,
  };
  let { error } = await admin
    .from("feed_items")
    .update(withReverse)
    .eq("id", opts.oldFeedItemId)
    .eq("user_id", opts.userId)
    .in("status", ["new", "open", "scheduled", "needs_replacement"]);

  if (error && /superseded_by_feed_item_id/i.test(error.message)) {
    ({ error } = await admin
      .from("feed_items")
      .update({
        status: "superseded",
        status_reason: opts.statusReason,
        updated_at: now,
      })
      .eq("id", opts.oldFeedItemId)
      .eq("user_id", opts.userId)
      .in("status", ["new", "open", "scheduled", "needs_replacement"]));
  }

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Hide a known-wrong card without claiming a replacement exists.
 * Prefer needs_replacement; fall back to status_reason on superseded only if enum missing.
 */
export async function markFeedItemNeedsReplacement(opts: {
  userId: string;
  feedItemId: string;
  statusReason: string;
}): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("feed_items")
    .update({
      status: "needs_replacement",
      status_reason: opts.statusReason,
      updated_at: now,
    })
    .eq("id", opts.feedItemId)
    .eq("user_id", opts.userId)
    .in("status", ["new", "open", "scheduled"]);

  if (!error) return { ok: true, status: "needs_replacement" };

  if (/needs_replacement|invalid input value for enum/i.test(error.message)) {
    return {
      ok: false,
      error: `needs_replacement_unavailable:${error.message}`,
    };
  }
  return { ok: false, error: error.message };
}

/**
 * Pure helper for unit tests: describes the safe order of operations.
 */
export function planSafeReplacement(opts: {
  validationOk: boolean;
  persistOk: boolean;
  oldStatus: string;
}): {
  shouldSupersedeOld: boolean;
  nextOldStatus: string | null;
  reportMissingReplacement: boolean;
} {
  if (!opts.validationOk || !opts.persistOk) {
    return {
      shouldSupersedeOld: false,
      nextOldStatus:
        opts.oldStatus === "needs_replacement"
          ? "needs_replacement"
          : opts.oldStatus,
      reportMissingReplacement: opts.oldStatus === "needs_replacement",
    };
  }
  return {
    shouldSupersedeOld: true,
    nextOldStatus: "superseded",
    reportMissingReplacement: false,
  };
}
