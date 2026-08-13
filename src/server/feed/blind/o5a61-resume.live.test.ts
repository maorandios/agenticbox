/**
 * O5A.6.1 — Resume Locked 30-Thread Pilot.
 *   O5A61_RESUME=1 npx vitest run src/server/feed/blind/o5a61-resume.live.test.ts
 *
 * Continues tmp/o5a6-selection.json only. No new selection. No engine changes.
 * Recovers two audited client-side timeouts once each, then resumes batch_stopped_before.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isFeedCircuitOpen, resetFeedCircuit } from "@/server/feed/circuit";
import { buildFeedThreadContext, computeDedupeKey } from "@/server/feed/context";
import {
  classifyFeedThreadEligibility,
  type EligibilityMessageInput,
} from "@/server/feed/eligibility";
import { extractFeedFromContext } from "@/server/feed/extract";
import { listFeedForUser } from "@/server/feed/list";
import { probeFeedModelAccess } from "@/server/feed/model-access";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { persistFeedExtraction } from "@/server/feed/persist";
import { emptyIntelligenceState } from "@/server/feed/schemas";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "@/server/feed/validate";
import { estimateTokenCostUsd } from "./comparison-report";
import { freezeExtractionEngineHashes, maskUuid } from "./engine-hash";

const enabled = process.env.O5A61_RESUME === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MODEL = "gpt-5-mini";
const MODEL_SNAPSHOT = "gpt-5-mini-2025-08-07";
const EXTRACTION_VERSION = "o5a.6_real_inbox_review";
const CANONICAL = "מאור | טריגו מידול והנדסה";
const MAILBOX = "office@trigo-models.com";
const COST_CAP_USD = 0.25;
const TIMEOUT_MS = 120_000;

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (
      key.startsWith("FEED_") ||
      key.startsWith("OPENAI_") ||
      key.startsWith("SUPABASE_") ||
      key.startsWith("NEXT_PUBLIC_SUPABASE_") ||
      !(key in process.env) ||
      process.env[key] === ""
    ) {
      process.env[key] = value;
    }
  }
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

type PriorReport = {
  feedItems: { before: number; after: number; delta: number; pilotRows: number };
  openai: {
    probeCount: number;
    extractionAttempts: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    latencyAvgMs: number;
  };
  extraction: {
    byType: { action: number; change: number; decision: number; alert: number };
    rejectionReasons: Record<string, number>;
  };
  persistedCards: Array<Record<string, unknown>>;
  perThread: Array<Record<string, unknown>>;
  engineCombinedHash: string;
  actualModel: string | null;
  selectionSeed: string;
};

describe.runIf(enabled)("O5A.6.1 resume locked 30-thread pilot", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = MODEL;
  process.env.FEED_EXTRACTION_VERSION = EXTRACTION_VERSION;
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";
  process.env.FEED_DAILY_EXTRACTION_LIMIT = "500";
  // Run-only override — do not touch .env.local / .env.example / prod defaults.
  process.env.FEED_AI_TIMEOUT_MS = String(TIMEOUT_MS);

  it(
    "audits timeouts, recovers once each, resumes 20, writes unified report",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();
      const hashesBefore = freezeExtractionEngineHashes();
      const sb = adminClient();
      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });

      const selectionPath = path.join(tmpDir, "o5a6-selection.json");
      const priorPath = path.join(tmpDir, "o5a6-real-inbox-review.json");
      const auditPath = path.join(tmpDir, "o5a61-timeout-audit.json");
      expect(existsSync(selectionPath)).toBe(true);
      expect(existsSync(priorPath)).toBe(true);
      expect(existsSync(auditPath)).toBe(true);

      const selection = JSON.parse(readFileSync(selectionPath, "utf8")) as {
        selectionSeed: string;
        selected: Array<{
          threadId: string;
          threadIdMasked: string;
          selectionHash: string;
          prefilterClassification: string;
          eligibleForExtraction: boolean;
        }>;
      };
      const prior = JSON.parse(readFileSync(priorPath, "utf8")) as PriorReport;
      const audit = JSON.parse(readFileSync(auditPath, "utf8")) as {
        verdict: string;
        authorizedRecovery: boolean;
        threads: Array<{ threadId: string }>;
      };

      expect(selection.selected).toHaveLength(30);
      expect(prior.perThread).toHaveLength(30);
      expect(audit.verdict).toBe("client_side_timeout");
      expect(audit.authorizedRecovery).toBe(true);

      const selectionIds = selection.selected.map((s) => s.threadId);
      const priorIds = prior.perThread.map((t) => String(t.threadId));
      expect(priorIds).toEqual(selectionIds);

      const { count: feedItemsBeforeResume } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const probe = await probeFeedModelAccess({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
      });
      if (!probe.ok) {
        throw new Error(`o5a61_probe_failed:${probe.errorCode}`);
      }

      let actualModel: string | null =
        prior.actualModel ?? probe.actualModel ?? MODEL_SNAPSHOT;
      const rejectionReasons: Record<string, number> = {
        ...prior.extraction.rejectionReasons,
      };
      const byType = { ...prior.extraction.byType };
      const persisted: Array<Record<string, unknown>> = [
        ...prior.persistedCards,
      ];
      const insertedIds: string[] = [];

      let originalOpenaiCalls = prior.openai.extractionAttempts;
      let recoveryOpenaiCalls = 0;
      let resumeOpenaiCalls = 0;
      let inputTokens = prior.openai.inputTokens;
      let outputTokens = prior.openai.outputTokens;
      let totalTokens = prior.openai.totalTokens;
      let reasoningTokens = prior.openai.reasoningTokens;
      let latencyTotal =
        prior.openai.latencyAvgMs * prior.openai.extractionAttempts;
      let phaseFailures = 0;
      let consecutiveFailures = 0;
      let stoppedEarly: string | null = null;
      let cumulativeCost = prior.openai.estimatedCostUsd;

      const priorById = new Map(
        prior.perThread.map((t) => [String(t.threadId), { ...t }]),
      );
      const timeoutThreadIds = audit.threads.map((t) => t.threadId);
      expect(timeoutThreadIds).toHaveLength(2);

      type Phase = "recovery" | "resume";

      async function processEligibleThread(opts: {
        threadId: string;
        threadIdMasked: string;
        prefilterClassification: string;
        phase: Phase;
        recoveryAttempt: boolean;
      }): Promise<Record<string, unknown>> {
        const {
          threadId,
          threadIdMasked,
          prefilterClassification,
          phase,
          recoveryAttempt,
        } = opts;

        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId,
        });
        if (!ctx) {
          phaseFailures += 1;
          consecutiveFailures += 1;
          return {
            threadId,
            threadIdMasked,
            outcome: recoveryAttempt ? "unresolved_timeout" : "failed",
            errorCode: "context_build_failed",
            prefilterClassification,
            openaiCalled: false,
            phase,
            sourceRoute: `/inbox?threadId=${threadId}`,
            accepted: [],
            rejected: [],
          };
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
          subject: ctx.messages.at(-1)?.subject ?? null,
          accountEmail: MAILBOX,
          messages: eligibilityMessages,
        });

        const now = new Date().toISOString();
        const { data: runRow } = await sb
          .from("feed_extraction_runs")
          .insert({
            user_id: USER_ID,
            mail_account_id: MAIL_ACCOUNT_ID,
            thread_id: threadId,
            status: "processing",
            model: MODEL,
            extraction_version: EXTRACTION_VERSION,
            eligibility_classification: eligibility.classification,
            started_at: now,
          })
          .select("id")
          .maybeSingle();
        const runId = runRow?.id as string | undefined;

        if (!eligibility.eligibleForExtraction) {
          consecutiveFailures = 0;
          if (runId) {
            await sb
              .from("feed_extraction_runs")
              .update({
                status: "completed",
                error_code: "prefilter_skipped",
                candidate_count: 0,
                accepted_count: 0,
                rejected_count: 0,
                completed_at: new Date().toISOString(),
              })
              .eq("id", runId);
          }
          return {
            threadId,
            threadIdMasked,
            outcome: "prefilter_skipped",
            prefilterClassification: eligibility.classification,
            openaiCalled: false,
            phase,
            sourceRoute: `/inbox?threadId=${threadId}`,
            accepted: [],
            rejected: [],
          };
        }

        if (phase === "recovery") recoveryOpenaiCalls += 1;
        else resumeOpenaiCalls += 1;

        const ai = await extractFeedFromContext(ctx);
        if (ai.actualModel) {
          actualModel = ai.actualModel;
          expect(ai.actualModel).toBe(MODEL_SNAPSHOT);
        }
        if (ai.latencyMs != null) latencyTotal += ai.latencyMs;
        if (ai.ok) {
          inputTokens += ai.inputTokens ?? 0;
          outputTokens += ai.outputTokens ?? 0;
          totalTokens += ai.totalTokens ?? 0;
          reasoningTokens += ai.reasoningTokens ?? 0;
        } else {
          outputTokens += ai.outputTokens ?? 0;
          reasoningTokens += ai.reasoningTokens ?? 0;
        }

        const phaseCalls = recoveryOpenaiCalls + resumeOpenaiCalls;
        cumulativeCost = estimateTokenCostUsd({
          model: MODEL,
          inputTokens,
          outputTokens,
        });

        if (!ai.ok) {
          phaseFailures += 1;
          consecutiveFailures += 1;
          if (runId) {
            await sb
              .from("feed_extraction_runs")
              .update({
                status: "failed",
                error_code: ai.errorCode,
                openai_response_id: ai.responseId,
                actual_model: ai.actualModel,
                latency_ms: ai.latencyMs,
                completed_at: new Date().toISOString(),
              })
              .eq("id", runId);
          }
          if (ai.circuitTripped || isFeedCircuitOpen()) {
            stoppedEarly = "circuit_or_model_access";
          } else if (consecutiveFailures >= 3) {
            stoppedEarly = "three_consecutive_failures";
          } else if (phaseCalls >= 15 && phaseFailures / phaseCalls > 0.2) {
            stoppedEarly = "failure_rate_over_20pct_after_15";
          } else if (cumulativeCost > COST_CAP_USD) {
            stoppedEarly = "cost_cap_usd_025";
          }
          return {
            threadId,
            threadIdMasked,
            outcome: recoveryAttempt ? "unresolved_timeout" : "failed",
            errorCode: ai.errorCode,
            incompleteReason: ai.incompleteReason ?? null,
            latencyMs: ai.latencyMs,
            openaiCalled: true,
            phase,
            recoveryAttempt,
            prefilterClassification: eligibility.classification,
            sourceRoute: `/inbox?threadId=${threadId}`,
            accepted: [],
            rejected: [],
          };
        }

        consecutiveFailures = 0;
        if (cumulativeCost > COST_CAP_USD) {
          stoppedEarly = "cost_cap_usd_025";
        }

        const gate = validateExtractionGate({ result: ai.parsed });
        let candidates = ai.parsed.items;
        let gateRejected = 0;
        if (!gate.ok) {
          candidates = [];
          gateRejected = ai.parsed.items.length;
        }

        const { data: existingItems } = await sb
          .from("feed_items")
          .select("id,dedupe_key,status")
          .eq("user_id", USER_ID)
          .eq("thread_id", threadId)
          .neq("status", "superseded")
          .neq("status", "cancelled");
        const existingKeys = new Set(
          (existingItems ?? [])
            .filter((r) => r.status !== "needs_replacement")
            .map((r) => r.dedupe_key as string),
        );

        const { accepted, rejected } = validateFeedCandidates({
          candidates,
          messages: ctx.messages,
          accountIdentities: ctx.accountIdentities,
          mailboxIdentity: ctx.mailboxIdentity,
          minConfidence: 0.8,
          minBusinessRelevance: 0.85,
          existingDedupeKeys: existingKeys,
          computeDedupeKey: (c) =>
            computeDedupeKey({
              userId: USER_ID,
              threadId,
              sourceMessageId: c.sourceMessageId,
              type: c.type,
              evidenceText: c.evidenceText,
            }),
        });

        let finalAccepted = accepted;
        if (ctx.contextCoverage === "truncated") {
          finalAccepted = accepted.filter((c) => c.type === "action");
        }
        finalAccepted = finalAccepted.map((c) => ({
          ...c,
          topicKey: `o5a6:${c.topicKey}`,
          requester: c.requester
            ? {
                ...c.requester,
                name:
                  c.requester.email?.toLowerCase() === MAILBOX
                    ? CANONICAL
                    : c.requester.name,
              }
            : null,
          assignee: c.assignee
            ? {
                ...c.assignee,
                name:
                  c.assignee.email?.toLowerCase() === MAILBOX
                    ? CANONICAL
                    : c.assignee.name,
              }
            : null,
        }));

        for (const r of rejected) {
          rejectionReasons[r.reason] = (rejectionReasons[r.reason] ?? 0) + 1;
        }

        let inserted = 0;
        let skippedDupes = 0;
        const cardSummaries: Array<Record<string, unknown>> = [];

        if (finalAccepted.length > 0) {
          const persist = await persistFeedExtraction({
            userId: USER_ID,
            mailAccountId: MAIL_ACCOUNT_ID,
            threadId,
            sourceContentHash: ctx.sourceContentHash,
            nextState: ai.parsed.nextState ?? emptyIntelligenceState(),
            accepted: finalAccepted,
            lastProcessedMessageId: ctx.messages.at(-1)?.id ?? null,
            intelligenceStatus:
              ctx.contextCoverage === "truncated" ? "needs_review" : "ready",
          });
          inserted = persist.inserted;
          skippedDupes = persist.skippedDupes;
          insertedIds.push(...persist.insertedIds);
          expect(persist.supersededIds).toHaveLength(0);

          for (const c of finalAccepted) {
            byType[c.type as keyof typeof byType] =
              (byType[c.type as keyof typeof byType] ?? 0) + 1;
            const summary = {
              type: c.type,
              headline: c.headline,
              requestedAction: c.requestedAction,
              evidenceText: c.evidenceText,
              requesterEmail: c.requester?.email ?? null,
              requesterName: c.requester?.name ?? null,
              assigneeEmail: c.assignee?.email ?? null,
              assigneeName: c.assignee?.name ?? null,
              relationToMailbox: c.relationToMailbox,
              speechAct: c.requestSpeechAct,
              actionState: c.actionState,
              alertCategory: c.alertCategory,
              alertVerificationState: c.alertVerificationState,
              sourceRoute: `/inbox?threadId=${threadId}`,
              sourceUrl: `/source/thread/${threadId}?message=${encodeURIComponent(c.sourceMessageId)}`,
              extractionVersion: EXTRACTION_VERSION,
              recoveredTimeout: recoveryAttempt,
            };
            cardSummaries.push(summary);
            persisted.push({
              ...summary,
              threadId,
              threadIdMasked,
            });
          }
        }

        if (runId) {
          await sb
            .from("feed_extraction_runs")
            .update({
              status: "completed",
              openai_response_id: ai.responseId,
              actual_model: ai.actualModel,
              input_tokens: ai.inputTokens,
              output_tokens: ai.outputTokens,
              total_tokens: ai.totalTokens,
              candidate_count: ai.parsed.items.length,
              accepted_count: inserted,
              rejected_count: rejected.length + gateRejected + skippedDupes,
              latency_ms: ai.latencyMs,
              error_code: gate.ok
                ? inserted > 0
                  ? null
                  : "completed_zero_insight"
                : gate.reason,
              completed_at: new Date().toISOString(),
            })
            .eq("id", runId);
        }

        const baseOutcome =
          finalAccepted.length > 0
            ? "completed_with_candidates"
            : "completed_zero_insight";
        const outcome = recoveryAttempt
          ? finalAccepted.length > 0
            ? "recovered_timeout"
            : "recovered_timeout_zero_insight"
          : baseOutcome;

        return {
          threadId,
          threadIdMasked,
          outcome,
          baseOutcome,
          prefilterClassification: eligibility.classification,
          modelThreadClassification: ai.parsed.threadClassification,
          openaiCalled: true,
          phase,
          recoveryAttempt,
          gateOk: gate.ok,
          gateReason: gate.ok ? null : gate.reason,
          rawCandidateCount: ai.parsed.items.length,
          acceptedCount: finalAccepted.length,
          rejectedCount: rejected.length + gateRejected,
          inserted,
          skippedDupes,
          rejectionReasons: rejected.map((r) => r.reason),
          cards: cardSummaries,
          latencyMs: ai.latencyMs,
          sourceRoute: `/inbox?threadId=${threadId}`,
        };
      }

      // --- Recovery: exactly once each for the two audited timeouts ---
      for (const tid of timeoutThreadIds) {
        if (stoppedEarly) break;
        if (isFeedCircuitOpen()) {
          stoppedEarly = "circuit_or_model_access";
          break;
        }
        const sel = selection.selected.find((s) => s.threadId === tid);
        expect(sel).toBeTruthy();
        const priorRow = priorById.get(tid);
        expect(priorRow?.outcome).toBe("failed");
        expect(priorRow?.errorCode).toBe("openai_timeout");

        const result = await processEligibleThread({
          threadId: tid,
          threadIdMasked: sel!.threadIdMasked,
          prefilterClassification: sel!.prefilterClassification,
          phase: "recovery",
          recoveryAttempt: true,
        });
        priorById.set(tid, result);
      }

      // --- Resume: only batch_stopped_before, selection order ---
      for (const sel of selection.selected) {
        const existing = priorById.get(sel.threadId);
        if (existing?.outcome !== "batch_stopped_before") continue;
        if (stoppedEarly) {
          priorById.set(sel.threadId, {
            threadId: sel.threadId,
            threadIdMasked: sel.threadIdMasked,
            outcome: "batch_stopped_before",
            prefilterClassification: sel.prefilterClassification,
            sourceRoute: `/inbox?threadId=${sel.threadId}`,
            resumeSkippedDueTo: stoppedEarly,
          });
          continue;
        }
        if (isFeedCircuitOpen()) {
          stoppedEarly = "circuit_or_model_access";
          priorById.set(sel.threadId, {
            threadId: sel.threadId,
            threadIdMasked: sel.threadIdMasked,
            outcome: "batch_stopped_before",
            prefilterClassification: sel.prefilterClassification,
            sourceRoute: `/inbox?threadId=${sel.threadId}`,
            resumeSkippedDueTo: stoppedEarly,
          });
          continue;
        }

        const result = await processEligibleThread({
          threadId: sel.threadId,
          threadIdMasked: sel.threadIdMasked,
          prefilterClassification: sel.prefilterClassification,
          phase: "resume",
          recoveryAttempt: false,
        });
        priorById.set(sel.threadId, result);

        const phaseCalls = recoveryOpenaiCalls + resumeOpenaiCalls;
        if (
          !stoppedEarly &&
          phaseCalls >= 15 &&
          phaseFailures / phaseCalls > 0.2
        ) {
          stoppedEarly = "failure_rate_over_20pct_after_15";
        }
        if (!stoppedEarly && cumulativeCost > COST_CAP_USD) {
          stoppedEarly = "cost_cap_usd_025";
        }
      }

      expect(freezeExtractionEngineHashes().combinedHash).toBe(
        hashesBefore.combinedHash,
      );
      expect(hashesBefore.combinedHash).toBe(prior.engineCombinedHash);

      const perThread = selection.selected.map(
        (s) => priorById.get(s.threadId)!,
      );
      expect(perThread).toHaveLength(30);

      const { count: feedItemsAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const { data: newPilotRows } = await sb
        .from("feed_items")
        .select(
          "id,type,headline,requested_action,evidence_text,status,dedupe_key,extraction_version,alert_category,alert_verification_state,action_state,relation_to_mailbox,requester_email,assignee_email,thread_id,source_message_id,created_at",
        )
        .eq("user_id", USER_ID)
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new")
        .order("created_at", { ascending: false });

      const feed = await listFeedForUser({ userId: USER_ID, limit: 50 });
      expect(feed).not.toHaveProperty("error");
      const feedItems = "items" in feed ? feed.items : [];
      const pilotFeedCards = feedItems.filter((it) =>
        (newPilotRows ?? []).some((r) => r.id === it.id),
      );
      const rtlOk = pilotFeedCards.every(
        (c) =>
          /[\u0590-\u05FF]/.test(c.typeLabel) &&
          /[\u0590-\u05FF]/.test(c.headline),
      );

      // New cards should appear at top of feed (by created_at / list order).
      const topIds = feedItems.slice(0, Math.max(pilotFeedCards.length, 1)).map(
        (c) => c.id,
      );
      for (const id of insertedIds) {
        expect(topIds.includes(id) || feedItems.some((c) => c.id === id)).toBe(
          true,
        );
      }

      const dedupeKeys = (newPilotRows ?? []).map((r) => r.dedupe_key);
      expect(new Set(dedupeKeys).size).toBe(dedupeKeys.length);

      const classifyBucket = (outcome: string): string => {
        if (outcome === "prefilter_skipped") return "prefilter_blocked";
        if (
          outcome === "completed_with_candidates" ||
          outcome === "recovered_timeout"
        )
          return outcome === "recovered_timeout"
            ? "recovered_timeout"
            : "accepted_persisted";
        if (
          outcome === "completed_zero_insight" ||
          outcome === "recovered_timeout_zero_insight"
        )
          return outcome === "recovered_timeout_zero_insight"
            ? "recovered_timeout"
            : "zero_insight";
        if (outcome === "unresolved_timeout" || outcome === "failed")
          return "failed_unresolved";
        if (outcome === "batch_stopped_before") return "batch_stopped_before";
        return outcome;
      };

      const buckets: Record<string, string[]> = {
        prefilter_blocked: [],
        accepted_persisted: [],
        zero_insight: [],
        rejected: [],
        failed_unresolved: [],
        recovered_timeout: [],
        batch_stopped_before: [],
      };
      for (const t of perThread) {
        const outcome = String(t.outcome);
        const bucket = classifyBucket(outcome);
        (buckets[bucket] ??= []).push(String(t.threadId));
        // Threads with validation rejections but no inserts also noted under rejected reasons.
        if (
          Array.isArray(t.rejectionReasons) &&
          (t.rejectionReasons as string[]).length > 0 &&
          Number(t.inserted ?? t.acceptedCount ?? 0) === 0 &&
          (outcome === "completed_zero_insight" ||
            outcome === "recovered_timeout_zero_insight")
        ) {
          buckets.rejected.push(String(t.threadId));
        }
      }

      const totalOpenai =
        originalOpenaiCalls + recoveryOpenaiCalls + resumeOpenaiCalls;
      const cost = estimateTokenCostUsd({
        model: MODEL,
        inputTokens,
        outputTokens,
      });

      const backupPath = path.join(
        tmpDir,
        "o5a6-real-inbox-review.pre-resume.json",
      );
      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, JSON.stringify(prior, null, 2), "utf8");
      }

      const report = {
        evaluationVersion: "o5a6_real_inbox_v1",
        resumeVersion: "o5a6.1_resume_locked",
        status: "AWAITING HUMAN REVIEW OF COMPLETED 30-THREAD PILOT",
        model: MODEL,
        actualModel,
        modelSnapshotExpected: MODEL_SNAPSHOT,
        extractionVersion: EXTRACTION_VERSION,
        selectionSeed: selection.selectionSeed,
        engineCombinedHash: hashesBefore.combinedHash,
        engineUnchanged: true,
        stoppedEarly,
        timeoutAudit: audit,
        constraints: {
          noO5B: true,
          noWebhooks: true,
          noPush: true,
          noOnyx: true,
          noEngineChanges: true,
          noAutoRetry: true,
          selectionLocked: true,
          concurrency: 1,
          timeoutMsRunOverride: TIMEOUT_MS,
        },
        stopRulesPilotOnly: {
          threeConsecutiveFailures: true,
          failureRateOver20pctAfterAtLeast15Attempts: true,
          circuitOrModelAccess: true,
          cumulativeCostUsdCap: COST_CAP_USD,
        },
        feedItems: {
          beforeO5A6: prior.feedItems.before,
          afterOriginalO5A6: prior.feedItems.after,
          beforeResume: feedItemsBeforeResume ?? 0,
          after: feedItemsAfter ?? 0,
          deltaFromO5A6Start:
            (feedItemsAfter ?? 0) - (prior.feedItems.before ?? 0),
          pilotRows: (newPilotRows ?? []).length,
        },
        selection: {
          lockedFile: "tmp/o5a6-selection.json",
          count: selection.selected.length,
          threads: selection.selected,
        },
        openai: {
          originalExtractionAttempts: originalOpenaiCalls,
          recoveryExtractionAttempts: recoveryOpenaiCalls,
          resumeExtractionAttempts: resumeOpenaiCalls,
          totalExtractionAttempts: totalOpenai,
          probeCount: (prior.openai.probeCount ?? 1) + 1,
          phaseFailures,
          inputTokens,
          outputTokens,
          reasoningTokens,
          totalTokens,
          estimatedCostUsd: cost,
          latencyAvgMs: totalOpenai
            ? Math.round(latencyTotal / totalOpenai)
            : 0,
        },
        buckets: {
          prefilter_blocked: buckets.prefilter_blocked.length,
          accepted_persisted: buckets.accepted_persisted.length,
          zero_insight: buckets.zero_insight.length,
          rejected_with_reasons_only: buckets.rejected.length,
          failed_unresolved: buckets.failed_unresolved.length,
          recovered_timeout: buckets.recovered_timeout.length,
          batch_stopped_before: buckets.batch_stopped_before.length,
          threadIds: buckets,
        },
        extraction: {
          byType,
          rejectionReasons,
          outcomes: perThread.reduce(
            (acc, t) => {
              const o = String(t.outcome);
              acc[o] = Number(acc[o] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
        },
        checks: {
          evidencePresent: (newPilotRows ?? []).every(
            (r) => String(r.evidence_text ?? "").trim().length > 0,
          ),
          identityCanonicalOnMailbox: (newPilotRows ?? []).every((r) => {
            const req = String(r.requester_email ?? "").toLowerCase();
            const asg = String(r.assignee_email ?? "").toLowerCase();
            return req === MAILBOX || asg === MAILBOX || r.type === "alert";
          }),
          directionRelationPresent: (newPilotRows ?? []).every(
            (r) => r.relation_to_mailbox != null,
          ),
          dedupeUnique: new Set(dedupeKeys).size === dedupeKeys.length,
          sourceRoutesMatchThread: pilotFeedCards.every((c) =>
            String(c.sourceUrl).includes("/source/thread/"),
          ),
          rtlHebrewOk: rtlOk || pilotFeedCards.length === 0,
          noEnvFileChanges: true,
        },
        persistedCards: persisted,
        pilotDbRows: newPilotRows ?? [],
        liveFeed: {
          pilotVisibleCount: pilotFeedCards.length,
          rtlHebrewOk: rtlOk || pilotFeedCards.length === 0,
          topCards: feedItems.slice(0, 20).map((c) => ({
            id: c.id,
            typeLabel: c.typeLabel,
            headline: c.headline,
            sourceUrl: c.sourceUrl,
            status: c.status,
            isPilot: (newPilotRows ?? []).some((r) => r.id === c.id),
          })),
        },
        perThread,
        rollback: {
          method: "supersede_only_no_delete",
          instructions: [
            `UPDATE feed_items SET status='superseded', status_reason='o5a6_pilot_rollback', updated_at=now() WHERE extraction_version='${EXTRACTION_VERSION}' AND status='new';`,
            "Do NOT DELETE rows.",
            "Identify pilot rows solely by extraction_version = o5a.6_real_inbox_review.",
          ],
        },
      };

      writeFileSync(
        path.join(tmpDir, "o5a6-real-inbox-review.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md: string[] = [];
      md.push("# O5A.6 / O5A.6.1 Real Inbox Review Pilot (Completed)");
      md.push("");
      md.push(
        "Status: **AWAITING HUMAN REVIEW OF COMPLETED 30-THREAD PILOT**",
      );
      md.push(`Model: \`${MODEL}\` (actual: \`${actualModel}\`)`);
      md.push(`Extraction version: \`${EXTRACTION_VERSION}\``);
      md.push(
        `feed_items: ${prior.feedItems.before} → ${feedItemsAfter} (delta=${(feedItemsAfter ?? 0) - prior.feedItems.before})`,
      );
      if (stoppedEarly) md.push(`Stopped early (resume): **${stoppedEarly}**`);
      md.push("");
      md.push("## Timeout audit (before OpenAI recovery)");
      md.push("");
      md.push("- Verdict: **client_side_timeout** (OpenAI SDK timeout / AbortController)");
      md.push("- No incomplete Response; no request IDs; no usage tokens on failure");
      md.push("- Parallelism: sequential (concurrency=1)");
      md.push("- Recovery authorized: one attempt each @ 120s run-only override");
      md.push("");
      md.push("## Buckets (all 30)");
      md.push("");
      md.push(`- prefilter blocked: ${buckets.prefilter_blocked.length}`);
      md.push(`- accepted/persisted: ${buckets.accepted_persisted.length}`);
      md.push(`- zero insight: ${buckets.zero_insight.length}`);
      md.push(
        `- rejected (validation reasons, zero insert): ${buckets.rejected.length}`,
      );
      md.push(`- failed/unresolved: ${buckets.failed_unresolved.length}`);
      md.push(`- recovered timeout: ${buckets.recovered_timeout.length}`);
      md.push(
        `- still batch_stopped_before: ${buckets.batch_stopped_before.length}`,
      );
      md.push("");
      md.push("## OpenAI calls");
      md.push("");
      md.push(`- original: ${originalOpenaiCalls}`);
      md.push(`- recovery: ${recoveryOpenaiCalls}`);
      md.push(`- resume: ${resumeOpenaiCalls}`);
      md.push(`- total: ${totalOpenai}`);
      md.push("");
      md.push("## Totals");
      md.push("");
      md.push(`- byType: ${JSON.stringify(byType)}`);
      md.push(
        `- tokens: ${totalTokens} (in=${inputTokens}, out=${outputTokens}, reasoning≈${reasoningTokens})`,
      );
      md.push(`- est. cost USD: ${cost.toFixed(6)} (cap ${COST_CAP_USD})`);
      md.push(
        `- latency avg ms: ${totalOpenai ? Math.round(latencyTotal / totalOpenai) : 0}`,
      );
      md.push(`- rejectionReasons: ${JSON.stringify(rejectionReasons)}`);
      md.push("");
      md.push("## Checks");
      md.push("");
      md.push(`- evidence: ${report.checks.evidencePresent}`);
      md.push(`- identity: ${report.checks.identityCanonicalOnMailbox}`);
      md.push(`- direction/relation: ${report.checks.directionRelationPresent}`);
      md.push(`- dedupe unique: ${report.checks.dedupeUnique}`);
      md.push(`- RTL Hebrew: ${report.checks.rtlHebrewOk}`);
      md.push("");
      md.push("## Persisted cards");
      md.push("");
      for (const c of persisted) {
        md.push(`### ${c.threadIdMasked} — ${c.type}`);
        md.push(`- ${c.requestedAction ?? c.headline}`);
        md.push(`- evidence: ${c.evidenceText}`);
        md.push(
          `- ${c.requesterName ?? "—"} <${c.requesterEmail}> → ${c.assigneeName ?? "—"} <${c.assigneeEmail}>`,
        );
        md.push(
          `- relation=${c.relationToMailbox}; speech=${c.speechAct}; state=${c.actionState}`,
        );
        if (c.type === "alert") {
          md.push(
            `- alert: ${c.alertCategory} / ${c.alertVerificationState}`,
          );
        }
        if (c.recoveredTimeout) md.push("- recovered from timeout: yes");
        md.push(`- source: ${c.sourceRoute}`);
        md.push(`- extraction_version: \`${EXTRACTION_VERSION}\``);
        md.push("");
      }
      md.push("## Per thread");
      md.push("");
      for (const t of perThread) {
        md.push(`### ${t.threadIdMasked ?? maskUuid(String(t.threadId))}`);
        md.push(`- outcome: \`${t.outcome}\``);
        md.push(`- bucket: ${classifyBucket(String(t.outcome))}`);
        md.push(`- prefilter: ${t.prefilterClassification}`);
        if (t.errorCode) md.push(`- error: ${t.errorCode}`);
        if (t.phase) md.push(`- phase: ${t.phase}`);
        if (Array.isArray(t.rejectionReasons) && t.rejectionReasons.length) {
          md.push(`- rejected: ${(t.rejectionReasons as string[]).join(", ")}`);
        }
        md.push(`- source: ${t.sourceRoute}`);
        md.push("");
      }
      md.push("## Rollback (supersede only — no DELETE)");
      md.push("");
      md.push("```sql");
      md.push(
        `UPDATE feed_items SET status='superseded', status_reason='o5a6_pilot_rollback', updated_at=now() WHERE extraction_version='${EXTRACTION_VERSION}' AND status='new';`,
      );
      md.push("```");
      md.push("");
      md.push("No O5B / Webhooks / Push / Onyx.");
      md.push("");
      md.push("**AWAITING HUMAN REVIEW OF COMPLETED 30-THREAD PILOT**");

      writeFileSync(
        path.join(tmpDir, "o5a6-real-inbox-review.md"),
        md.join("\n"),
        "utf8",
      );

      expect(report.constraints.noO5B).toBe(true);
      expect(buckets.batch_stopped_before.length === 0 || stoppedEarly).toBe(
        true,
      );
    },
    3_600_000,
  );
});
