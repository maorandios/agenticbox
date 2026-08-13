import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFeedCircuitReason, isFeedCircuitOpen } from "./circuit";
import { feedLog } from "./log";
import { processFeedExtractJob } from "./process";
import { FeedExtractThreadJobSchema } from "./schemas";

export async function processFeedQueue(opts?: {
  maxJobs?: number;
  visibilityTimeoutSec?: number;
}): Promise<{
  read: number;
  completed: number;
  skipped: number;
  failed: number;
  locked: number;
  disabled: number;
  prefilterSkipped: number;
  circuitOpen: number;
}> {
  const admin = createAdminClient();
  const maxJobs = opts?.maxJobs ?? 3;
  const vt = opts?.visibilityTimeoutSec ?? 180;

  const { data, error } = await admin.rpc("feed_jobs_read", {
    p_vt: vt,
    p_qty: maxJobs,
  });
  if (error) throw new Error(`feed_jobs_read_failed:${error.message}`);

  const rows = (data ?? []) as Array<{
    msg_id: number | string;
    message: unknown;
  }>;

  const totals = {
    read: rows.length,
    completed: 0,
    skipped: 0,
    failed: 0,
    locked: 0,
    disabled: 0,
    prefilterSkipped: 0,
    circuitOpen: 0,
  };

  for (const row of rows) {
    const msgId = Number(row.msg_id);
    const parsed = FeedExtractThreadJobSchema.safeParse(row.message);
    if (!parsed.success) {
      feedLog("warn", "feed_job_invalid", { msgId });
      await admin.rpc("feed_jobs_archive", { p_msg_id: msgId });
      totals.failed += 1;
      continue;
    }

    if (isFeedCircuitOpen()) {
      feedLog("warn", "feed_batch_stopped_circuit", {
        msgId,
        reason: getFeedCircuitReason(),
      });
      await admin.rpc("feed_jobs_archive", { p_msg_id: msgId });
      totals.circuitOpen += 1;
      continue;
    }

    try {
      const result = await processFeedExtractJob(parsed.data);
      if (result === "completed") totals.completed += 1;
      else if (result === "skipped") totals.skipped += 1;
      else if (result === "prefilter_skipped") totals.prefilterSkipped += 1;
      else if (result === "locked") totals.locked += 1;
      else if (result === "disabled") totals.disabled += 1;
      else if (result === "circuit_open") totals.circuitOpen += 1;
      else totals.failed += 1;

      if (result !== "locked") {
        await admin.rpc("feed_jobs_archive", { p_msg_id: msgId });
      }
    } catch (error) {
      feedLog("error", "feed_job_exception", {
        msgId,
        code: error instanceof Error ? error.name : "unknown",
      });
      totals.failed += 1;
      await admin.rpc("feed_jobs_archive", { p_msg_id: msgId });
    }
  }

  return totals;
}
