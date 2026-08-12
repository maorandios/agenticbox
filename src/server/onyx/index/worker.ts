import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { onyxLog } from "@/server/onyx/log";
import { processDeleteJob, processIndexJob } from "./process";
import type { OnyxJobMessage } from "./types";

type QueueRow = {
  msg_id: number | string;
  message: OnyxJobMessage | string;
};

function parseJob(raw: unknown): OnyxJobMessage | null {
  const value =
    typeof raw === "string" ? (JSON.parse(raw) as OnyxJobMessage) : (raw as OnyxJobMessage);
  if (!value || typeof value !== "object") return null;
  if (value.type === "onyx_index_thread") {
    if (!value.userId || !value.mailAccountId || !value.threadId) return null;
    return value;
  }
  if (value.type === "onyx_delete_thread") {
    if (
      !value.userId ||
      !value.mailAccountId ||
      !value.threadId ||
      !value.onyxDocumentId
    ) {
      return null;
    }
    return value;
  }
  return null;
}

export type OnyxWorkerCounters = {
  read: number;
  indexed: number;
  skipped: number;
  failed: number;
  retried: number;
  deleted: number;
};

export async function processOnyxQueue(opts?: {
  maxJobs?: number;
  visibilityTimeoutSec?: number;
}): Promise<OnyxWorkerCounters> {
  const admin = createAdminClient();
  const maxJobs = opts?.maxJobs ?? 3;
  const vt = opts?.visibilityTimeoutSec ?? 120;
  const counters: OnyxWorkerCounters = {
    read: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
    deleted: 0,
  };

  for (let i = 0; i < maxJobs; i += 1) {
    const { data, error } = await admin.rpc("onyx_jobs_read", {
      p_vt: vt,
      p_qty: 1,
    });
    if (error) throw new Error(`onyx_jobs_read_failed:${error.message}`);

    const rows = (Array.isArray(data) ? data : data ? [data] : []) as QueueRow[];
    const row = rows[0];
    if (!row) break;

    counters.read += 1;
    const msgId = Number(row.msg_id);
    const job = parseJob(row.message);

    if (!job) {
      await admin.rpc("onyx_jobs_archive", { p_msg_id: msgId });
      counters.failed += 1;
      continue;
    }

    try {
      if (job.type === "onyx_index_thread") {
        const result = await processIndexJob(job);
        if (result === "indexed") counters.indexed += 1;
        else if (result === "skipped") counters.skipped += 1;
        else if (result === "failed") counters.failed += 1;
        else counters.retried += 1;

        if (result !== "retry") {
          await admin.rpc("onyx_jobs_archive", { p_msg_id: msgId });
        }
      } else {
        const result = await processDeleteJob(job);
        if (result === "deleted") counters.deleted += 1;
        else if (result === "failed") counters.failed += 1;
        else counters.retried += 1;

        if (result !== "retry") {
          await admin.rpc("onyx_jobs_archive", { p_msg_id: msgId });
        }
      }
    } catch {
      counters.failed += 1;
      // Leave message for VT retry.
      onyxLog("warn", "onyx_index_retry", {
        msgId,
        reason: "worker_exception",
      });
      break;
    }
  }

  onyxLog("info", "onyx_index_batch_completed", { ...counters });
  return counters;
}
