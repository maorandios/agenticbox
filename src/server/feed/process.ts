import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFeedCircuitReason,
  isCircuitBreakerError,
  isFeedCircuitOpen,
  tripFeedCircuit,
} from "./circuit";
import { getFeedConfig, isFeedAiEnabled } from "./config";
import { buildFeedThreadContext, computeDedupeKey } from "./context";
import {
  classifyFeedThreadEligibility,
  type EligibilityMessageInput,
} from "./eligibility";
import { extractFeedFromContext } from "./extract";
import { feedLog } from "./log";
import { persistFeedExtraction } from "./persist";
import type { FeedExtractThreadJob } from "./schemas";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "./validate";

export type ProcessFeedResult =
  | "completed"
  | "skipped"
  | "failed"
  | "locked"
  | "disabled"
  | "circuit_open"
  | "prefilter_skipped";

/**
 * Count every OpenAI extraction attempt today (including failed).
 * Model probe rows are excluded — they are documented separately and are not extractions.
 */
export async function countTodayExtractions(userId: string): Promise<number> {
  const admin = createAdminClient();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await admin
    .from("feed_extraction_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["completed", "failed", "processing"])
    .not("model", "is", null)
    .neq("eligibility_classification", "model_probe")
    .gte("started_at", start.toISOString());
  if (error) throw new Error(`feed_daily_count_failed:${error.message}`);
  return count ?? 0;
}

export async function processFeedExtractJob(
  job: FeedExtractThreadJob,
): Promise<ProcessFeedResult> {
  const admin = createAdminClient();
  const config = getFeedConfig();
  const now = new Date().toISOString();

  if (isFeedCircuitOpen()) {
    feedLog("warn", "feed_circuit_open", {
      threadId: job.threadId,
      reason: getFeedCircuitReason(),
    });
    return "circuit_open";
  }

  if (!isFeedAiEnabled()) {
    feedLog("warn", "feed_extract_disabled", {
      threadId: job.threadId,
    });
    return "disabled";
  }

  if (!config.apiKey) {
    feedLog("error", "feed_extract_missing_key", { threadId: job.threadId });
    return "failed";
  }

  const { data: account } = await admin
    .from("mail_accounts")
    .select("id,sync_status,email")
    .eq("user_id", job.userId)
    .eq("id", job.mailAccountId)
    .maybeSingle();
  if (!account || account.sync_status === "disconnected") {
    return "failed";
  }

  const { data: thread } = await admin
    .from("threads")
    .select("id")
    .eq("user_id", job.userId)
    .eq("mail_account_id", job.mailAccountId)
    .eq("id", job.threadId)
    .maybeSingle();
  if (!thread) return "failed";

  const daily = await countTodayExtractions(job.userId);
  if (daily >= config.dailyExtractionLimit) {
    feedLog("warn", "feed_daily_limit", {
      userId: job.userId,
      daily,
      limit: config.dailyExtractionLimit,
    });
    return "failed";
  }

  const ctx = await buildFeedThreadContext({
    userId: job.userId,
    mailAccountId: job.mailAccountId,
    threadId: job.threadId,
    triggerMessageId: job.triggerMessageId,
  });
  if (!ctx) return "failed";

  const eligibilityMessages: EligibilityMessageInput[] = ctx.messages.map(
    (m) => ({
      subject: m.subject,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toEmails: m.toEmails,
      direction: m.direction,
      body: m.body,
    }),
  );
  const eligibility = classifyFeedThreadEligibility({
    subject: ctx.subject,
    accountEmail: ctx.accountEmail,
    messages: eligibilityMessages,
  });

  if (!eligibility.eligibleForExtraction) {
    const { error: skipErr } = await admin.from("feed_extraction_runs").insert({
      user_id: job.userId,
      mail_account_id: job.mailAccountId,
      thread_id: job.threadId,
      trigger_message_id: job.triggerMessageId,
      source_content_hash: ctx.sourceContentHash,
      status: "skipped",
      context_coverage: ctx.contextCoverage,
      candidate_count: 0,
      accepted_count: 0,
      rejected_count: 0,
      extraction_version: config.extractionVersion,
      eligibility_classification: eligibility.classification,
      prefilter_skipped: true,
      started_at: now,
      completed_at: now,
      error_code: "prefilter_skipped",
    });
    if (skipErr) throw new Error(`feed_run_prefilter_failed:${skipErr.message}`);
    feedLog("info", "feed_prefilter_skipped", {
      threadId: job.threadId,
      classification: eligibility.classification,
    });
    return "prefilter_skipped";
  }

  const { data: priorState } = await admin
    .from("thread_intelligence_state")
    .select("source_content_hash,status")
    .eq("user_id", job.userId)
    .eq("thread_id", job.threadId)
    .maybeSingle();

  if (
    priorState?.source_content_hash &&
    priorState.source_content_hash === ctx.sourceContentHash
  ) {
    // Allow re-extraction when calibration version changes (O5A → O5A.1).
    const { data: sameVersion } = await admin
      .from("feed_extraction_runs")
      .select("id")
      .eq("user_id", job.userId)
      .eq("thread_id", job.threadId)
      .eq("source_content_hash", ctx.sourceContentHash)
      .eq("extraction_version", config.extractionVersion)
      .eq("status", "completed")
      .limit(1)
      .maybeSingle();

    if (sameVersion?.id) {
      const { error: skipErr } = await admin.from("feed_extraction_runs").insert({
        user_id: job.userId,
        mail_account_id: job.mailAccountId,
        thread_id: job.threadId,
        trigger_message_id: job.triggerMessageId,
        source_content_hash: ctx.sourceContentHash,
        status: "skipped",
        context_coverage: ctx.contextCoverage,
        candidate_count: 0,
        accepted_count: 0,
        rejected_count: 0,
        extraction_version: config.extractionVersion,
        eligibility_classification: eligibility.classification,
        prefilter_skipped: false,
        started_at: now,
        completed_at: now,
      });
      if (skipErr) throw new Error(`feed_run_skip_failed:${skipErr.message}`);
      return "skipped";
    }
  }

  const { data: run, error: runErr } = await admin
    .from("feed_extraction_runs")
    .insert({
      user_id: job.userId,
      mail_account_id: job.mailAccountId,
      thread_id: job.threadId,
      trigger_message_id: job.triggerMessageId,
      source_content_hash: ctx.sourceContentHash,
      status: "processing",
      model: config.model,
      context_coverage: ctx.contextCoverage,
      extraction_version: config.extractionVersion,
      eligibility_classification: eligibility.classification,
      prefilter_skipped: false,
      started_at: now,
    })
    .select("id")
    .maybeSingle();

  if (runErr) {
    if (runErr.code === "23505") {
      feedLog("info", "feed_extract_locked", { threadId: job.threadId });
      return "locked";
    }
    throw new Error(`feed_run_insert_failed:${runErr.message}`);
  }

  const runId = run!.id as string;

  await admin.from("thread_intelligence_state").upsert(
    {
      user_id: job.userId,
      mail_account_id: job.mailAccountId,
      thread_id: job.threadId,
      status: "processing",
      updated_at: now,
    },
    { onConflict: "user_id,thread_id" },
  );

  feedLog("info", "feed_extract_started", {
    runId,
    threadId: job.threadId,
    coverage: ctx.contextCoverage,
  });

  if (isFeedCircuitOpen()) {
    await admin
      .from("feed_extraction_runs")
      .update({
        status: "failed",
        error_code: "circuit_open",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", job.userId);
    return "circuit_open";
  }

  const ai = await extractFeedFromContext(ctx);

  if (!ai.ok) {
    if (ai.circuitTripped || isCircuitBreakerError(ai.errorCode)) {
      tripFeedCircuit(ai.errorCode);
    }

    await admin
      .from("feed_extraction_runs")
      .update({
        status: "failed",
        openai_response_id: ai.responseId,
        actual_model: ai.actualModel,
        latency_ms: ai.latencyMs,
        error_code: ai.errorCode,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", job.userId);

    await admin
      .from("thread_intelligence_state")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", job.userId)
      .eq("thread_id", job.threadId);

    feedLog("error", "feed_extract_failed", {
      runId,
      threadId: job.threadId,
      errorCode: ai.errorCode,
      latencyMs: ai.latencyMs,
      circuit: isFeedCircuitOpen(),
    });
    return isFeedCircuitOpen() ? "circuit_open" : "failed";
  }

  const gate = validateExtractionGate({ result: ai.parsed });
  let candidates = ai.parsed.items;
  let gateRejected = 0;
  if (!gate.ok) {
    candidates = [];
    gateRejected = ai.parsed.items.length;
  }

  const { data: existingItems } = await admin
    .from("feed_items")
    .select("id,dedupe_key,status")
    .eq("user_id", job.userId)
    .eq("thread_id", job.threadId)
    .neq("status", "superseded")
    .neq("status", "cancelled");
  const existingKeys = new Set(
    (existingItems ?? [])
      .filter((r) => r.status !== "needs_replacement")
      .map((r) => r.dedupe_key as string),
  );
  const replaceFeedItemIds = (existingItems ?? [])
    .filter((r) => r.status === "needs_replacement")
    .map((r) => r.id as string);

  const { accepted, rejected } = validateFeedCandidates({
    candidates,
    messages: ctx.messages,
    accountIdentities: ctx.accountIdentities,
    mailboxIdentity: ctx.mailboxIdentity,
    minConfidence: config.minConfidence,
    minBusinessRelevance: config.minBusinessRelevance,
    existingDedupeKeys: existingKeys,
    computeDedupeKey: (c) =>
      computeDedupeKey({
        userId: job.userId,
        threadId: job.threadId,
        sourceMessageId: c.sourceMessageId,
        type: c.type,
        evidenceText: c.evidenceText,
      }),
  });

  let finalAccepted = accepted;
  if (ctx.contextCoverage === "truncated") {
    finalAccepted = accepted.filter((c) => c.type === "action");
  }

  const intelligenceStatus =
    ctx.contextCoverage === "truncated" ? "needs_review" : "ready";

  const persist = await persistFeedExtraction({
    userId: job.userId,
    mailAccountId: job.mailAccountId,
    threadId: job.threadId,
    sourceContentHash: ctx.sourceContentHash,
    nextState: ai.parsed.nextState,
    accepted: finalAccepted,
    lastProcessedMessageId:
      job.triggerMessageId ?? ctx.messages.at(-1)?.id ?? null,
    intelligenceStatus,
    replaceFeedItemIds:
      replaceFeedItemIds.length > 0 ? replaceFeedItemIds : undefined,
    replaceStatusReason: "replaced_by_newer_extraction",
  });

  const rejectedCount =
    rejected.length +
    gateRejected +
    (accepted.length - finalAccepted.length) +
    persist.skippedDupes;

  await admin
    .from("feed_extraction_runs")
    .update({
      status: "completed",
      openai_response_id: ai.responseId,
      actual_model: ai.actualModel,
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      total_tokens: ai.totalTokens,
      candidate_count: ai.parsed.items.length,
      accepted_count: persist.inserted,
      rejected_count: rejectedCount,
      latency_ms: ai.latencyMs,
      completed_at: new Date().toISOString(),
      error_code: gate.ok ? null : gate.reason,
    })
    .eq("id", runId)
    .eq("user_id", job.userId);

  feedLog("info", "feed_extract_completed", {
    runId,
    threadId: job.threadId,
    candidates: ai.parsed.items.length,
    accepted: persist.inserted,
    rejected: rejectedCount,
    latencyMs: ai.latencyMs,
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
    totalTokens: ai.totalTokens,
    actualModel: ai.actualModel,
  });

  return "completed";
}
