import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { processBackfillPageJob } from "./backfill";
import { syncLog } from "./log";
import type { BackfillJobMessage } from "./types";

type QueueRow = {
  msg_id: number | string;
  message: BackfillJobMessage | string;
  read_ct?: number;
};

function parseJob(raw: unknown): BackfillJobMessage | null {
  const value =
    typeof raw === "string"
      ? (JSON.parse(raw) as BackfillJobMessage)
      : (raw as BackfillJobMessage);
  if (!value || value.jobType !== "backfill_page") return null;
  if (!value.userId || !value.mailAccountId) return null;
  return value;
}

/**
 * Process up to `maxJobs` backfill_page messages from pgmq.
 * Jobs for other users are re-queued so a single-tenant process loop stays safe.
 */
export async function processBackfillQueue(opts?: {
  maxJobs?: number;
  onlyUserId?: string;
}) {
  const admin = createAdminClient();
  const maxJobs = opts?.maxJobs ?? 1;
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < maxJobs; i += 1) {
    const { data, error } = await admin.rpc("mail_jobs_read", {
      p_vt: 120,
      p_qty: 1,
    });
    if (error) throw new Error(`queue_read_failed:${error.message}`);

    const rows = (Array.isArray(data) ? data : data ? [data] : []) as QueueRow[];
    const row = rows[0];
    if (!row) break;

    const msgId = Number(row.msg_id);
    const job = parseJob(row.message);
    if (!job) {
      await admin.rpc("mail_jobs_archive", { p_msg_id: msgId });
      continue;
    }

    if (opts?.onlyUserId && job.userId !== opts.onlyUserId) {
      await admin.rpc("mail_jobs_send", { p_message: job });
      await admin.rpc("mail_jobs_archive", { p_msg_id: msgId });
      continue;
    }

    try {
      await processBackfillPageJob(job);
      await admin.rpc("mail_jobs_archive", { p_msg_id: msgId });
      processed += 1;
    } catch {
      failed += 1;
      // Leave message for VT retry; do not archive.
      syncLog("warn", "backfill_job_will_retry", {
        accountId: job.mailAccountId,
        msgId,
      });
      break;
    }
  }

  return { processed, failed };
}
