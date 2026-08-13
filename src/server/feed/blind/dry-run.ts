/**
 * Dry-run extraction — records feed_extraction_runs, never mutates feed_items.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFeedCircuitReason,
  isCircuitBreakerError,
  isFeedCircuitOpen,
  tripFeedCircuit,
} from "../circuit";
import { getFeedConfig, isFeedAiEnabled } from "../config";
import { buildFeedThreadContext, computeDedupeKey } from "../context";
import {
  classifyFeedThreadEligibility,
  type EligibilityMessageInput,
} from "../eligibility";
import { extractFeedFromContext } from "../extract";
import { feedLog } from "../log";
import type { AcceptedCandidate } from "../validate";
import {
  validateExtractionGate,
  validateFeedCandidates,
  type RejectedCandidate,
} from "../validate";
import { O5A4_PERSIST_MODE } from "./constants";

export type DryRunPersistMode = typeof O5A4_PERSIST_MODE;

export type FeedDryRunOutcome =
  | "completed_with_candidates"
  | "completed_zero_insight"
  | "failed_incomplete_response"
  | "failed_timeout"
  | "failed_schema"
  | "failed"
  | "disabled"
  | "circuit_open"
  | "prefilter_skipped"
  | "account_failed"
  | "daily_limit";

export type FeedDryRunResult = {
  persistMode: DryRunPersistMode;
  status:
    | "completed"
    | "failed"
    | "disabled"
    | "circuit_open"
    | "prefilter_skipped"
    | "account_failed"
    | "daily_limit";
  /** Fine-grained outcome — never conflate API failure with zero insight. */
  outcome: FeedDryRunOutcome;
  runId: string | null;
  threadId: string;
  prefilterClassification: string | null;
  modelThreadClassification: string | null;
  errorCode: string | null;
  actualModel: string | null;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number | null;
  incompleteReason: string | null;
  responseId: string | null;
  candidates: AcceptedCandidate[];
  rejected: RejectedCandidate[];
  gateRejected: number;
  rawCandidateCount: number;
  /** Always empty in dry_run — no feed_items writes. */
  feedItemMutations: {
    inserts: number;
    updates: number;
    deletes: number;
    supersedes: number;
  };
};

/**
 * Extract + validate one thread without writing feed_items / intelligence state.
 * Still inserts/updates feed_extraction_runs (counts toward daily limit).
 */
export async function extractFeedThreadDryRun(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  triggerMessageId?: string | null;
  persistMode?: DryRunPersistMode;
}): Promise<FeedDryRunResult> {
  const persistMode = opts.persistMode ?? O5A4_PERSIST_MODE;
  if (persistMode !== "dry_run") {
    throw new Error("o5a4_persist_mode_must_be_dry_run");
  }

  const emptyMutations = {
    inserts: 0,
    updates: 0,
    deletes: 0,
    supersedes: 0,
  };

  const base = {
    persistMode,
    runId: null as string | null,
    threadId: opts.threadId,
    prefilterClassification: null as string | null,
    modelThreadClassification: null as string | null,
    errorCode: null as string | null,
    actualModel: null as string | null,
    latencyMs: null as number | null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: null as number | null,
    incompleteReason: null as string | null,
    responseId: null as string | null,
    candidates: [] as AcceptedCandidate[],
    rejected: [] as RejectedCandidate[],
    gateRejected: 0,
    rawCandidateCount: 0,
    feedItemMutations: emptyMutations,
    outcome: "failed" as FeedDryRunOutcome,
  };

  const admin = createAdminClient();
  const config = getFeedConfig();
  const now = new Date().toISOString();

  if (isFeedCircuitOpen()) {
    return {
      ...base,
      status: "circuit_open",
      outcome: "circuit_open",
      errorCode: getFeedCircuitReason() ?? "circuit_open",
    };
  }
  if (!isFeedAiEnabled() || !config.apiKey) {
    return { ...base, status: "disabled", errorCode: "feed_ai_disabled" };
  }

  const { data: account } = await admin
    .from("mail_accounts")
    .select("id,sync_status")
    .eq("user_id", opts.userId)
    .eq("id", opts.mailAccountId)
    .maybeSingle();
  if (!account || account.sync_status === "disconnected") {
    return { ...base, status: "account_failed", errorCode: "account_unavailable" };
  }

  const { data: thread } = await admin
    .from("threads")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .eq("id", opts.threadId)
    .maybeSingle();
  if (!thread) {
    return { ...base, status: "account_failed", errorCode: "thread_not_found" };
  }

  // Daily limit (same as process) — probe excluded there.
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count: daily } = await admin
    .from("feed_extraction_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .in("status", ["completed", "failed", "processing"])
    .not("model", "is", null)
    .neq("eligibility_classification", "model_probe")
    .gte("started_at", start.toISOString());
  if ((daily ?? 0) >= config.dailyExtractionLimit) {
    return { ...base, status: "daily_limit", errorCode: "daily_limit" };
  }

  const ctx = await buildFeedThreadContext({
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
    triggerMessageId: opts.triggerMessageId ?? null,
  });
  if (!ctx) {
    return { ...base, status: "failed", errorCode: "context_build_failed" };
  }

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
  base.prefilterClassification = eligibility.classification;

  if (!eligibility.eligibleForExtraction) {
    const { data: skipRun } = await admin
      .from("feed_extraction_runs")
      .insert({
        user_id: opts.userId,
        mail_account_id: opts.mailAccountId,
        thread_id: opts.threadId,
        trigger_message_id: opts.triggerMessageId ?? null,
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
      })
      .select("id")
      .maybeSingle();
    return {
      ...base,
      status: "prefilter_skipped",
      outcome: "prefilter_skipped",
      runId: (skipRun?.id as string) ?? null,
      errorCode: "prefilter_skipped",
    };
  }

  const { data: run, error: runErr } = await admin
    .from("feed_extraction_runs")
    .insert({
      user_id: opts.userId,
      mail_account_id: opts.mailAccountId,
      thread_id: opts.threadId,
      trigger_message_id: opts.triggerMessageId ?? null,
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
    throw new Error(`o5a4_dry_run_insert_failed:${runErr.message}`);
  }
  const runId = run!.id as string;
  base.runId = runId;

  // Intentionally NO thread_intelligence_state writes in dry_run.
  // Intentionally NO persistFeedExtraction / feed_items mutations.

  feedLog("info", "feed_dry_run_started", {
    runId,
    threadId: opts.threadId,
    persistMode,
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
      .eq("user_id", opts.userId);
    return {
      ...base,
      status: "circuit_open",
      errorCode: "circuit_open",
    };
  }

  const ai = await extractFeedFromContext(ctx);

  // Shared validation helper (also used for timeout/incomplete deterministic recovery).
  const runValidation = async (candidateList: Parameters<
    typeof validateFeedCandidates
  >[0]["candidates"]) => {
    const { data: existingItems } = await admin
      .from("feed_items")
      .select("id,dedupe_key,status")
      .eq("user_id", opts.userId)
      .eq("thread_id", opts.threadId)
      .neq("status", "superseded")
      .neq("status", "cancelled");
    const existingKeys = new Set(
      (existingItems ?? [])
        .filter((r) => r.status !== "needs_replacement")
        .map((r) => r.dedupe_key as string),
    );
    return validateFeedCandidates({
      candidates: candidateList,
      messages: ctx.messages,
      accountIdentities: ctx.accountIdentities,
      mailboxIdentity: ctx.mailboxIdentity,
      minConfidence: config.minConfidence,
      minBusinessRelevance: config.minBusinessRelevance,
      existingDedupeKeys: existingKeys,
      computeDedupeKey: (c) =>
        computeDedupeKey({
          userId: opts.userId,
          threadId: opts.threadId,
          sourceMessageId: c.sourceMessageId,
          type: c.type,
          evidenceText: c.evidenceText,
        }),
    });
  };

  if (!ai.ok) {
    if (ai.circuitTripped || isCircuitBreakerError(ai.errorCode)) {
      tripFeedCircuit(ai.errorCode);
    }

    const recoverableAiFailure =
      ai.errorCode === "openai_timeout" ||
      ai.errorCode === "openai_incomplete";
    if (recoverableAiFailure && !isFeedCircuitOpen()) {
      const { accepted, rejected } = await runValidation([]);
      let finalAccepted = accepted;
      if (ctx.contextCoverage === "truncated") {
        finalAccepted = accepted.filter((c) => c.type === "action");
      }
      if (finalAccepted.length > 0) {
        await admin
          .from("feed_extraction_runs")
          .update({
            status: "completed",
            openai_response_id: ai.responseId,
            actual_model: ai.actualModel,
            latency_ms: ai.latencyMs,
            error_code: `${ai.errorCode}_recovered`,
            candidate_count: 0,
            accepted_count: finalAccepted.length,
            rejected_count: rejected.length,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .eq("user_id", opts.userId);
        return {
          ...base,
          status: "completed",
          outcome: "completed_with_candidates",
          errorCode: `${ai.errorCode}_recovered`,
          actualModel: ai.actualModel,
          latencyMs: ai.latencyMs,
          responseId: ai.responseId,
          incompleteReason: ai.incompleteReason ?? null,
          outputTokens: ai.outputTokens ?? 0,
          reasoningTokens: ai.reasoningTokens ?? null,
          candidates: finalAccepted,
          rejected,
          rawCandidateCount: 0,
        };
      }
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
      .eq("user_id", opts.userId);
    return {
      ...base,
      status: isFeedCircuitOpen() ? "circuit_open" : "failed",
      outcome:
        ai.errorCode === "openai_timeout"
          ? "failed_timeout"
          : ai.errorCode === "openai_incomplete"
            ? "failed_incomplete_response"
            : ai.errorCode === "schema_invalid"
              ? "failed_schema"
              : "failed",
      errorCode: ai.errorCode,
      actualModel: ai.actualModel,
      latencyMs: ai.latencyMs,
      responseId: ai.responseId,
      incompleteReason: ai.incompleteReason ?? null,
      outputTokens: ai.outputTokens ?? 0,
      reasoningTokens: ai.reasoningTokens ?? null,
    };
  }

  base.modelThreadClassification = ai.parsed.threadClassification ?? null;
  base.actualModel = ai.actualModel;
  base.latencyMs = ai.latencyMs;
  base.inputTokens = ai.inputTokens ?? 0;
  base.outputTokens = ai.outputTokens ?? 0;
  base.totalTokens = ai.totalTokens ?? 0;
  base.reasoningTokens = ai.reasoningTokens ?? null;
  base.responseId = ai.responseId;
  base.rawCandidateCount = ai.parsed.items.length;

  const gate = validateExtractionGate({ result: ai.parsed });
  let candidates = ai.parsed.items;
  let gateRejected = 0;
  if (!gate.ok) {
    candidates = [];
    gateRejected = ai.parsed.items.length;
  }

  const { accepted, rejected } = await runValidation(candidates);

  let finalAccepted = accepted;
  if (ctx.contextCoverage === "truncated") {
    finalAccepted = accepted.filter((c) => c.type === "action");
  }

  const rejectedCount =
    rejected.length +
    gateRejected +
    (accepted.length - finalAccepted.length);

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
      accepted_count: finalAccepted.length,
      rejected_count: rejectedCount,
      latency_ms: ai.latencyMs,
      completed_at: new Date().toISOString(),
      error_code: gate.ok ? "dry_run" : gate.reason,
    })
    .eq("id", runId)
    .eq("user_id", opts.userId);

  feedLog("info", "feed_dry_run_completed", {
    runId,
    threadId: opts.threadId,
    accepted: finalAccepted.length,
    rejected: rejectedCount,
    persistMode,
  });

  return {
    ...base,
    status: "completed",
    outcome:
      finalAccepted.length > 0
        ? "completed_with_candidates"
        : "completed_zero_insight",
    candidates: finalAccepted,
    rejected,
    gateRejected,
    errorCode: gate.ok ? null : gate.reason,
    feedItemMutations: emptyMutations,
  };
}

/** Test helper: prove dry-run API never exposes a persist path. */
export function dryRunGuaranteesNoFeedItemWrites(
  result: FeedDryRunResult,
): boolean {
  return (
    result.persistMode === "dry_run" &&
    result.feedItemMutations.inserts === 0 &&
    result.feedItemMutations.updates === 0 &&
    result.feedItemMutations.deletes === 0 &&
    result.feedItemMutations.supersedes === 0
  );
}
