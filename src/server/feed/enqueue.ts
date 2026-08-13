import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanFeedMessageBody } from "./clean-content";
import {
  clampPilotLimit,
  FEED_PILOT_HARD_CAP,
  FEED_PREFILTER_SCAN_CAP,
} from "./config";
import {
  classifyFeedThreadEligibility,
  scoreEligibleThreadPriority,
  type EligibilityMessageInput,
  type FeedThreadEligibility,
} from "./eligibility";
import type { FeedExtractThreadJob } from "./schemas";

export async function enqueueFeedExtractJob(
  job: FeedExtractThreadJob,
): Promise<bigint> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("feed_jobs_send", {
    p_message: {
      type: job.type,
      userId: job.userId,
      mailAccountId: job.mailAccountId,
      threadId: job.threadId,
      triggerMessageId: job.triggerMessageId,
    },
  });
  if (error) throw new Error(`feed_jobs_send_failed:${error.message}`);
  return BigInt(data as number | string);
}

export type PilotClassificationCounts = Record<FeedThreadEligibility, number>;

export type PilotSelectionReport = {
  scanned: number;
  selected: number;
  enqueued: number;
  skippedQueued: number;
  limit: number;
  limitMax: number;
  classificationCounts: PilotClassificationCounts;
  prefilterSkipped: number;
  eligibleFound: number;
};

function emptyCounts(): PilotClassificationCounts {
  return {
    business_conversation: 0,
    important_transactional: 0,
    bulk_marketing: 0,
    system_notification: 0,
    insufficient_content: 0,
    unknown: 0,
  };
}

async function loadThreadMessages(opts: {
  userId: string;
  threadId: string;
}): Promise<EligibilityMessageInput[]> {
  const admin = createAdminClient();
  const { data: messageRows, error } = await admin
    .from("messages")
    .select("id,subject,plain_text,clean_conversation,direction")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`feed_pilot_messages_failed:${error.message}`);

  const rows = messageRows ?? [];
  const messageIds = rows.map((r) => r.id as string);
  const participantsByMessage = new Map<
    string,
    Array<{ role: string; email: string; name: string | null }>
  >();

  if (messageIds.length > 0) {
    const { data: parts, error: partsError } = await admin
      .from("message_participants")
      .select("message_id,role,email,name")
      .eq("user_id", opts.userId)
      .in("message_id", messageIds);
    if (partsError) {
      throw new Error(`feed_pilot_parts_failed:${partsError.message}`);
    }
    for (const p of parts ?? []) {
      const mid = p.message_id as string;
      const list = participantsByMessage.get(mid) ?? [];
      list.push({
        role: String(p.role),
        email: String(p.email ?? ""),
        name: (p.name as string | null) ?? null,
      });
      participantsByMessage.set(mid, list);
    }
  }

  return rows.map((row) => {
    const parts = participantsByMessage.get(row.id as string) ?? [];
    const from = parts.find((p) => p.role === "from");
    const raw =
      String(row.clean_conversation ?? "").trim() ||
      String(row.plain_text ?? "").trim();
    return {
      subject: (row.subject as string | null) ?? null,
      fromEmail: from?.email || null,
      fromName: from?.name ?? null,
      toEmails: parts
        .filter((p) => p.role === "to" || p.role === "cc")
        .map((p) => p.email)
        .filter(Boolean),
      direction: (row.direction === "outbound" ? "outbound" : "inbound") as
        | "inbound"
        | "outbound",
      body: cleanFeedMessageBody(raw).cleanText,
    };
  });
}

/**
 * Scan up to 100 synced threads, classify deterministically, enqueue ≤20 eligible.
 */
export async function enqueueFeedPilot(opts: {
  userId: string;
  mailAccountId: string;
  limit?: number;
}): Promise<PilotSelectionReport> {
  const admin = createAdminClient();
  const limit = clampPilotLimit(opts.limit);
  const classificationCounts = emptyCounts();

  const { data: account } = await admin
    .from("mail_accounts")
    .select("id,sync_status,email")
    .eq("user_id", opts.userId)
    .eq("id", opts.mailAccountId)
    .maybeSingle();
  if (!account || account.sync_status === "disconnected") {
    throw new Error("account_not_found");
  }
  const accountEmail = String(account.email ?? "")
    .trim()
    .toLowerCase();

  const { data: threads, error } = await admin
    .from("threads")
    .select("id,subject,latest_message_at")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(FEED_PREFILTER_SCAN_CAP);
  if (error) throw new Error(`feed_pilot_threads_failed:${error.message}`);

  const scannedThreads = threads ?? [];
  const eligible: Array<{
    threadId: string;
    priority: number;
    classification: FeedThreadEligibility;
  }> = [];

  for (const thread of scannedThreads) {
    const messages = await loadThreadMessages({
      userId: opts.userId,
      threadId: thread.id as string,
    });
    const eligibility = classifyFeedThreadEligibility({
      subject: (thread.subject as string | null) ?? null,
      accountEmail,
      messages,
    });
    classificationCounts[eligibility.classification] += 1;
    if (!eligibility.eligibleForExtraction) continue;

    eligible.push({
      threadId: thread.id as string,
      priority: scoreEligibleThreadPriority({
        subject: (thread.subject as string | null) ?? null,
        accountEmail,
        messages,
      }),
      classification: eligibility.classification,
    });
  }

  eligible.sort((a, b) => b.priority - a.priority);
  const selected = eligible.slice(0, limit);

  let enqueued = 0;
  let skippedQueued = 0;

  for (const thread of selected) {
    const { data: active } = await admin
      .from("feed_extraction_runs")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("thread_id", thread.threadId)
      .eq("status", "processing")
      .maybeSingle();
    if (active) {
      skippedQueued += 1;
      continue;
    }

    await enqueueFeedExtractJob({
      type: "feed_extract_thread",
      userId: opts.userId,
      mailAccountId: opts.mailAccountId,
      threadId: thread.threadId,
      triggerMessageId: null,
    });
    enqueued += 1;
  }

  return {
    scanned: scannedThreads.length,
    selected: selected.length,
    enqueued,
    skippedQueued,
    limit,
    limitMax: FEED_PILOT_HARD_CAP,
    classificationCounts,
    prefilterSkipped: scannedThreads.length - eligible.length,
    eligibleFound: eligible.length,
  };
}
