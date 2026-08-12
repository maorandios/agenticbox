import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OnyxIndexProgress, OnyxIndexStatus } from "./types";

export async function getIndexProgress(opts: {
  userId: string;
  mailAccountId?: string;
}): Promise<OnyxIndexProgress> {
  const admin = createAdminClient();
  let query = admin
    .from("onyx_index_state")
    .select("status")
    .eq("user_id", opts.userId);

  if (opts.mailAccountId) {
    query = query.eq("mail_account_id", opts.mailAccountId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`index_progress_failed:${error.message}`);

  const progress: OnyxIndexProgress = {
    total: 0,
    pending: 0,
    processing: 0,
    indexed: 0,
    failed: 0,
    stale: 0,
    deleting: 0,
    deleted: 0,
  };

  for (const row of data ?? []) {
    const status = row.status as OnyxIndexStatus;
    progress.total += 1;
    if (status in progress) {
      progress[status] += 1;
    }
  }

  return progress;
}
