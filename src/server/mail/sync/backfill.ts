import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMessagesForThread, listThreadsPage } from "./nylas-fetch";
import { upsertMessage, upsertThread } from "./persist";
import { syncLog } from "./log";
import { mapPool } from "./rate-limit";
import {
  defaultCheckpoint,
  getSyncConcurrency,
  getThreadsPageSize,
  type BackfillCheckpoint,
  type BackfillJobMessage,
} from "./types";

function lookbackUnix(days: number) {
  return Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
}

async function loadGrantId(mailAccountId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_mail_account_grant", {
    p_mail_account_id: mailAccountId,
  });
  if (error || typeof data !== "string" || !data) {
    throw new Error("grant_missing");
  }
  return data;
}

async function loadAccount(mailAccountId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mail_accounts")
    .select("id, user_id, email, aliases, sync_status")
    .eq("id", mailAccountId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error("account_missing");
  return data;
}

async function readCheckpoint(
  mailAccountId: string,
  userId: string,
): Promise<BackfillCheckpoint> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sync_state")
    .select("checkpoint")
    .eq("mail_account_id", mailAccountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.checkpoint || typeof data.checkpoint !== "object") {
    return defaultCheckpoint();
  }
  return defaultCheckpoint(data.checkpoint as Partial<BackfillCheckpoint>);
}

async function writeCheckpoint(params: {
  mailAccountId: string;
  userId: string;
  checkpoint: BackfillCheckpoint;
  status: string;
  phase: "backfill" | "idle";
  lastErrorSafe?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("sync_state").upsert(
    {
      user_id: params.userId,
      mail_account_id: params.mailAccountId,
      phase: params.phase,
      status: params.status,
      checkpoint: params.checkpoint,
      last_error_safe: params.lastErrorSafe ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "mail_account_id" },
  );
  if (error) throw new Error(`checkpoint_write_failed:${error.message}`);
}

export async function enqueueBackfillPage(job: BackfillJobMessage) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("mail_jobs_send", {
    p_message: job,
  });
  if (error) throw new Error(`enqueue_failed:${error.message}`);
}

export async function startBackfillForAccount(params: {
  userId: string;
  mailAccountId: string;
  resume?: boolean;
}) {
  const admin = createAdminClient();
  const account = await loadAccount(params.mailAccountId, params.userId);

  let checkpoint = await readCheckpoint(params.mailAccountId, params.userId);
  if (!params.resume) {
    checkpoint = defaultCheckpoint({
      startedAt: new Date().toISOString(),
    });
  } else {
    checkpoint = {
      ...checkpoint,
      startedAt: checkpoint.startedAt ?? new Date().toISOString(),
      retries: checkpoint.retries + 1,
    };
  }

  await writeCheckpoint({
    userId: params.userId,
    mailAccountId: params.mailAccountId,
    checkpoint,
    status: "running",
    phase: "backfill",
  });

  await admin
    .from("mail_accounts")
    .update({
      sync_status: "syncing",
      sync_started_at: checkpoint.startedAt,
      sync_finished_at: null,
      error_code: null,
      error_message_safe: null,
      thread_count_synced: checkpoint.threadsDone,
      message_count_synced: checkpoint.messagesDone,
      sync_retry_count: checkpoint.retries,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("user_id", params.userId);

  await enqueueBackfillPage({
    jobType: "backfill_page",
    userId: params.userId,
    mailAccountId: params.mailAccountId,
    pageToken: checkpoint.pageToken,
  });

  syncLog("info", "backfill_enqueued", {
    accountId: params.mailAccountId,
    resume: Boolean(params.resume),
    threadsDone: checkpoint.threadsDone,
  });
}

export async function processBackfillPageJob(
  job: BackfillJobMessage,
): Promise<{ done: boolean; enqueuedNext: boolean }> {
  const admin = createAdminClient();
  const account = await loadAccount(job.mailAccountId, job.userId);
  const grantId = await loadGrantId(job.mailAccountId);
  const aliases = Array.isArray(account.aliases)
    ? (account.aliases as string[])
    : [];

  const checkpoint = await readCheckpoint(job.mailAccountId, job.userId);
  const pageToken = job.pageToken ?? checkpoint.pageToken;
  const concurrency = getSyncConcurrency();
  let rateLimitHits = checkpoint.rateLimitHits;

  const onRateLimitRetry = () => {
    rateLimitHits += 1;
  };

  try {
    const remaining = Math.max(0, checkpoint.maxThreads - checkpoint.threadsDone);
    if (remaining === 0) {
      await completeBackfill({
        userId: job.userId,
        mailAccountId: job.mailAccountId,
        checkpoint: { ...checkpoint, rateLimitHits },
      });
      return { done: true, enqueuedNext: false };
    }

    const page = await listThreadsPage({
      grantId,
      latestMessageAfter: lookbackUnix(checkpoint.lookbackDays),
      limit: Math.min(getThreadsPageSize(), remaining),
      pageToken,
      onRateLimitRetry,
    });

    const threads = page.threads.slice(0, remaining);
    let messagesDone = 0;
    let attachmentsDone = 0;

    await mapPool(threads, concurrency, async (thread) => {
      const threadId = await upsertThread({
        userId: job.userId,
        mailAccountId: job.mailAccountId,
        thread,
      });

      const messages = await listMessagesForThread({
        grantId,
        threadId: thread.id,
        onRateLimitRetry,
      });

      for (const message of messages) {
        const result = await upsertMessage({
          userId: job.userId,
          mailAccountId: job.mailAccountId,
          threadId,
          accountEmail: account.email,
          aliases,
          message,
        });
        messagesDone += 1;
        attachmentsDone += result.attachmentCount;
      }
    });

    const nextCheckpoint: BackfillCheckpoint = {
      ...checkpoint,
      pageToken: page.nextCursor,
      threadsDone: checkpoint.threadsDone + threads.length,
      messagesDone: checkpoint.messagesDone + messagesDone,
      attachmentsDone: checkpoint.attachmentsDone + attachmentsDone,
      rateLimitHits,
    };

    await writeCheckpoint({
      userId: job.userId,
      mailAccountId: job.mailAccountId,
      checkpoint: nextCheckpoint,
      status: "running",
      phase: "backfill",
    });

    await admin
      .from("mail_accounts")
      .update({
        sync_status: "syncing",
        thread_count_synced: nextCheckpoint.threadsDone,
        message_count_synced: nextCheckpoint.messagesDone,
        sync_rate_limit_hits: nextCheckpoint.rateLimitHits,
        backfill_cursor: nextCheckpoint.pageToken,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.mailAccountId)
      .eq("user_id", job.userId);

    syncLog("info", "backfill_page_done", {
      accountId: job.mailAccountId,
      threadsUpserted: threads.length,
      messagesUpserted: messagesDone,
      attachmentsUpserted: attachmentsDone,
      threadsDone: nextCheckpoint.threadsDone,
      rateLimitHits: nextCheckpoint.rateLimitHits,
      hasNext: Boolean(page.nextCursor),
    });

    const hitMax = nextCheckpoint.threadsDone >= nextCheckpoint.maxThreads;
    if (!page.nextCursor || hitMax || threads.length === 0) {
      await completeBackfill({
        userId: job.userId,
        mailAccountId: job.mailAccountId,
        checkpoint: nextCheckpoint,
      });
      return { done: true, enqueuedNext: false };
    }

    await enqueueBackfillPage({
      jobType: "backfill_page",
      userId: job.userId,
      mailAccountId: job.mailAccountId,
      pageToken: page.nextCursor,
    });
    return { done: false, enqueuedNext: true };
  } catch (error) {
    const safe =
      error instanceof Error ? error.message.slice(0, 120) : "backfill_failed";
    await writeCheckpoint({
      userId: job.userId,
      mailAccountId: job.mailAccountId,
      checkpoint: { ...checkpoint, rateLimitHits },
      status: "failed",
      phase: "backfill",
      lastErrorSafe: safe,
    });
    await admin
      .from("mail_accounts")
      .update({
        sync_status: "error",
        error_code: "backfill_failed",
        error_message_safe: safe,
        sync_rate_limit_hits: rateLimitHits,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.mailAccountId)
      .eq("user_id", job.userId);

    syncLog("error", "backfill_page_failed", {
      accountId: job.mailAccountId,
      errorCode: safe,
      rateLimitHits,
    });
    throw error;
  }
}

async function completeBackfill(params: {
  userId: string;
  mailAccountId: string;
  checkpoint: BackfillCheckpoint;
}) {
  const admin = createAdminClient();
  const finishedAt = new Date().toISOString();
  await writeCheckpoint({
    userId: params.userId,
    mailAccountId: params.mailAccountId,
    checkpoint: { ...params.checkpoint, pageToken: null },
    status: "completed",
    phase: "idle",
  });
  await admin
    .from("mail_accounts")
    .update({
      sync_status: "ready",
      backfill_completed_at: finishedAt,
      sync_finished_at: finishedAt,
      last_successful_sync_at: finishedAt,
      thread_count_synced: params.checkpoint.threadsDone,
      message_count_synced: params.checkpoint.messagesDone,
      sync_rate_limit_hits: params.checkpoint.rateLimitHits,
      error_code: null,
      error_message_safe: null,
      updated_at: finishedAt,
    })
    .eq("id", params.mailAccountId)
    .eq("user_id", params.userId);

  syncLog("info", "backfill_completed", {
    accountId: params.mailAccountId,
    threadsDone: params.checkpoint.threadsDone,
    messagesDone: params.checkpoint.messagesDone,
    attachmentsDone: params.checkpoint.attachmentsDone,
    rateLimitHits: params.checkpoint.rateLimitHits,
    retries: params.checkpoint.retries,
  });
}
