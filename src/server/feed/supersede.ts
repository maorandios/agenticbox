import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { O5A_SUPERSEDE_REASON } from "./config";
import { feedLog } from "./log";

export const O5A_SUCCESS_PILOT_EXPECTED_ITEMS = 13;
export const O5A_SUCCESS_PILOT_EXPECTED_RUNS = 20;

export type O5aPilotSupersedeTarget = {
  id: string;
  type: string;
  threadId: string;
  createdAt: string;
  headlinePreview: string;
};

export type O5aPilotSupersedePlan = {
  ok: boolean;
  count: number;
  expected: number;
  runIds: string[];
  runCount: number;
  acceptedSum: number;
  windowStart: string | null;
  windowEnd: string | null;
  items: O5aPilotSupersedeTarget[];
  reason: string;
};

/**
 * Identify O5A successful pilot items via completed gpt-4o-mini runs
 * (not the failed snapshot model batch), then items created in that run window
 * on threads that accepted feed items. Does not use extraction_version-null alone.
 */
export async function selectO5aPilotItemsForSupersede(opts: {
  userId: string;
  mailAccountId: string;
}): Promise<O5aPilotSupersedePlan> {
  const admin = createAdminClient();

  const { data: runs, error: runsError } = await admin
    .from("feed_extraction_runs")
    .select(
      "id,status,model,started_at,completed_at,accepted_count,thread_id,extraction_version",
    )
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .eq("status", "completed")
    .eq("model", "gpt-4o-mini")
    .is("extraction_version", null)
    .order("started_at", { ascending: true });

  if (runsError) {
    throw new Error(`feed_supersede_runs_failed:${runsError.message}`);
  }

  const completed = runs ?? [];
  // Contiguous successful O5A batch: exactly 20 completed gpt-4o-mini runs
  // whose accepted_count sum is 13 (the known successful pilot).
  let batch = completed.slice(0, O5A_SUCCESS_PILOT_EXPECTED_RUNS);
  let acceptedSum = batch.reduce((s, r) => s + Number(r.accepted_count ?? 0), 0);

  if (
    batch.length !== O5A_SUCCESS_PILOT_EXPECTED_RUNS ||
    acceptedSum !== O5A_SUCCESS_PILOT_EXPECTED_ITEMS
  ) {
    // Search for a contiguous window of 20 runs with accepted_sum === 13
    batch = [];
    acceptedSum = 0;
    for (let i = 0; i + O5A_SUCCESS_PILOT_EXPECTED_RUNS <= completed.length; i += 1) {
      const slice = completed.slice(i, i + O5A_SUCCESS_PILOT_EXPECTED_RUNS);
      const sum = slice.reduce((s, r) => s + Number(r.accepted_count ?? 0), 0);
      if (sum === O5A_SUCCESS_PILOT_EXPECTED_ITEMS) {
        batch = slice;
        acceptedSum = sum;
        break;
      }
    }
  }

  if (batch.length !== O5A_SUCCESS_PILOT_EXPECTED_RUNS) {
    return {
      ok: false,
      count: 0,
      expected: O5A_SUCCESS_PILOT_EXPECTED_ITEMS,
      runIds: [],
      runCount: 0,
      acceptedSum: 0,
      windowStart: null,
      windowEnd: null,
      items: [],
      reason: "o5a_success_run_batch_not_found",
    };
  }

  const runIds = batch.map((r) => r.id as string);
  const threadIds = [
    ...new Set(
      batch
        .filter((r) => Number(r.accepted_count ?? 0) > 0)
        .map((r) => r.thread_id as string)
        .filter(Boolean),
    ),
  ];
  const windowStart = String(batch[0]!.started_at);
  const last = batch[batch.length - 1]!;
  const windowEnd = String(last.completed_at ?? last.started_at);
  const windowEndPlus = new Date(
    new Date(windowEnd).getTime() + 120_000,
  ).toISOString();

  const { data: rows, error } = await admin
    .from("feed_items")
    .select("id,type,headline,status,created_at,thread_id,extraction_version")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .in("thread_id", threadIds)
    .gte("created_at", windowStart)
    .lte("created_at", windowEndPlus)
    .in("status", ["new", "open", "scheduled"])
    .order("created_at", { ascending: true });

  if (error) throw new Error(`feed_supersede_select_failed:${error.message}`);

  const items: O5aPilotSupersedeTarget[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    type: String(r.type),
    threadId: r.thread_id as string,
    createdAt: String(r.created_at),
    headlinePreview: String(r.headline ?? "").slice(0, 60),
  }));

  const ok = items.length === O5A_SUCCESS_PILOT_EXPECTED_ITEMS;
  return {
    ok,
    count: items.length,
    expected: O5A_SUCCESS_PILOT_EXPECTED_ITEMS,
    runIds,
    runCount: batch.length,
    acceptedSum,
    windowStart,
    windowEnd,
    items,
    reason: ok
      ? "matched_o5a_success_runs"
      : `count_mismatch:${items.length}!=${O5A_SUCCESS_PILOT_EXPECTED_ITEMS}`,
  };
}

/**
 * Supersede only when SELECT identifies exactly 13 O5A pilot items.
 */
export async function supersedeLegacyO5aPilotItems(opts: {
  userId: string;
  mailAccountId: string;
}): Promise<{
  superseded: number;
  ids: string[];
  plan: O5aPilotSupersedePlan;
}> {
  const plan = await selectO5aPilotItemsForSupersede(opts);
  if (!plan.ok) {
    feedLog("warn", "feed_supersede_refused", {
      count: plan.count,
      expected: plan.expected,
      reason: plan.reason,
    });
    throw new Error(
      `feed_supersede_refused_count:${plan.count}:expected:${plan.expected}:${plan.reason}`,
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const ids = plan.items.map((i) => i.id);

  const { error: updateError } = await admin
    .from("feed_items")
    .update({
      status: "superseded",
      status_reason: O5A_SUPERSEDE_REASON,
      updated_at: now,
    })
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .in("id", ids)
    .in("status", ["new", "open", "scheduled"]);

  if (updateError) {
    throw new Error(`feed_supersede_update_failed:${updateError.message}`);
  }

  // Verify final count
  const { data: verify, error: verifyError } = await admin
    .from("feed_items")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .in("id", ids)
    .eq("status", "superseded")
    .eq("status_reason", O5A_SUPERSEDE_REASON);

  if (verifyError) {
    throw new Error(`feed_supersede_verify_failed:${verifyError.message}`);
  }
  if ((verify ?? []).length !== O5A_SUCCESS_PILOT_EXPECTED_ITEMS) {
    throw new Error(
      `feed_supersede_verify_count:${(verify ?? []).length}`,
    );
  }

  feedLog("info", "feed_supersede_o5a_pilot", {
    superseded: ids.length,
    reason: O5A_SUPERSEDE_REASON,
    runCount: plan.runCount,
  });

  return { superseded: ids.length, ids, plan };
}
