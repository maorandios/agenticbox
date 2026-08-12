import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { onyxLog } from "@/server/onyx/log";
import { buildOnyxDocumentId } from "@/server/onyx/normalize/thread-document";
import {
  clampPilotLimit,
  type OnyxIndexThreadJob,
  type OnyxJobMessage,
} from "./types";

async function sendJob(message: OnyxJobMessage): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("onyx_jobs_send", {
    p_message: message,
  });
  if (error) throw new Error(`onyx_jobs_send_failed:${error.message}`);
  return Number(data);
}

function isExcludedFolder(folders: string[] | null | undefined): boolean {
  if (!folders?.length) return false;
  const upper = folders.map((f) => f.toUpperCase());
  return upper.includes("TRASH") || upper.includes("SPAM");
}

export async function enqueueThreadIndex(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
}): Promise<{ enqueued: boolean; reason?: string }> {
  const admin = createAdminClient();
  const documentId = buildOnyxDocumentId(opts.userId, opts.threadId);

  const { data: existing } = await admin
    .from("onyx_index_state")
    .select("id,status")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .maybeSingle();

  if (existing && (existing.status === "pending" || existing.status === "processing")) {
    return { enqueued: false, reason: "already_queued" };
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from("onyx_index_state").upsert(
    {
      user_id: opts.userId,
      mail_account_id: opts.mailAccountId,
      thread_id: opts.threadId,
      onyx_document_id: documentId,
      status: "pending",
      updated_at: now,
      last_error_code: null,
      last_error_message: null,
    },
    { onConflict: "user_id,thread_id" },
  );
  if (upsertError) throw new Error(`index_state_upsert_failed:${upsertError.message}`);

  const job: OnyxIndexThreadJob = {
    type: "onyx_index_thread",
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
  };
  await sendJob(job);

  onyxLog("info", "onyx_index_enqueued", {
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
  });

  return { enqueued: true };
}

export async function enqueueAccountIndex(opts: {
  userId: string;
  mailAccountId: string;
  limit?: number;
  /** When true, include TRASH/SPAM threads (full-account index). */
  includeExcludedFolders?: boolean;
}): Promise<{
  selected: number;
  enqueued: number;
  skippedQueued: number;
  skippedExcluded: number;
}> {
  const limit = clampPilotLimit(opts.limit);
  const admin = createAdminClient();

  const { data: account, error: accountError } = await admin
    .from("mail_accounts")
    .select("id,user_id")
    .eq("id", opts.mailAccountId)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (accountError) throw new Error(`account_load_failed:${accountError.message}`);
  if (!account) throw new Error("account_not_found");

  // Fetch a buffer to allow folder exclusions while still filling the pilot limit.
  const { data: threads, error: threadsError } = await admin
    .from("threads")
    .select("id,folders,latest_message_at")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(limit * 3, limit));

  if (threadsError) throw new Error(`threads_load_failed:${threadsError.message}`);

  let selected = 0;
  let enqueued = 0;
  let skippedQueued = 0;
  let skippedExcluded = 0;

  for (const thread of threads ?? []) {
    if (selected >= limit) break;
    if (
      !opts.includeExcludedFolders &&
      isExcludedFolder(thread.folders as string[] | null)
    ) {
      skippedExcluded += 1;
      continue;
    }
    selected += 1;
    const result = await enqueueThreadIndex({
      userId: opts.userId,
      mailAccountId: opts.mailAccountId,
      threadId: thread.id as string,
    });
    if (result.enqueued) enqueued += 1;
    else skippedQueued += 1;
  }

  return { selected, enqueued, skippedQueued, skippedExcluded };
}

/** Full-account enqueue (up to 100), including TRASH/SPAM for complete mailbox search. */
export async function enqueueAllAccountThreads(opts: {
  userId: string;
  mailAccountId: string;
  includeExcludedFolders?: boolean;
}): Promise<{
  selected: number;
  enqueued: number;
  skippedQueued: number;
  skippedExcluded: number;
}> {
  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("mail_accounts")
    .select("id,user_id,sync_status")
    .eq("id", opts.mailAccountId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (accountError) throw new Error(`account_load_failed:${accountError.message}`);
  if (!account || account.sync_status === "disconnected") {
    throw new Error("account_not_found");
  }

  const { data: threads, error: threadsError } = await admin
    .from("threads")
    .select("id,folders")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (threadsError) throw new Error(`threads_load_failed:${threadsError.message}`);

  let selected = 0;
  let enqueued = 0;
  let skippedQueued = 0;
  let skippedExcluded = 0;
  const includeExcluded = opts.includeExcludedFolders !== false;

  for (const thread of threads ?? []) {
    if (
      !includeExcluded &&
      isExcludedFolder(thread.folders as string[] | null)
    ) {
      skippedExcluded += 1;
      continue;
    }
    selected += 1;
    const result = await enqueueThreadIndex({
      userId: opts.userId,
      mailAccountId: opts.mailAccountId,
      threadId: thread.id as string,
    });
    if (result.enqueued) enqueued += 1;
    else skippedQueued += 1;
  }

  return { selected, enqueued, skippedQueued, skippedExcluded };
}

export async function enqueueThreadDelete(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  onyxDocumentId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin
    .from("onyx_index_state")
    .update({
      status: "deleting",
      updated_at: now,
    })
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId);

  await sendJob({
    type: "onyx_delete_thread",
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
    onyxDocumentId: opts.onyxDocumentId,
  });
}
