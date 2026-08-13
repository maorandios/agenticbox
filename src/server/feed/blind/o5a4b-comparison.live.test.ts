/**
 * O5A.4B — Model comparison: same locked 20 threads, gpt-5-mini dry_run only.
 *   O5A4B_COMPARE=1 npx vitest run src/server/feed/blind/o5a4b-comparison.live.test.ts
 *
 * Does NOT change prompt/schema/validator/selection. Does NOT promote to feed.
 * Does NOT permanently change default model.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isFeedCircuitOpen, resetFeedCircuit } from "@/server/feed/circuit";
import { buildFeedThreadContext } from "@/server/feed/context";
import { probeFeedModelAccess } from "@/server/feed/model-access";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import {
  assertEngineHashesUnchanged,
  freezeExtractionEngineHashes,
  maskUuid,
} from "./engine-hash";
import { extractFeedThreadDryRun } from "./dry-run";
import { summarizeAcceptedCandidate } from "./quality";
import { buildReviewRecord, type BlindEvaluationReport, type BlindReviewRecord } from "./report";
import {
  buildSideBySide,
  estimateTokenCostUsd,
  flagReviewCards,
  writeModelComparisonReports,
  type ModelComparisonReport,
  type ModelRunSnapshot,
} from "./comparison-report";

const enabled = process.env.O5A4B_COMPARE === "1";

const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const CHALLENGER_MODEL = "gpt-5-mini";
const BASELINE_MODEL = "gpt-4o-mini";
const O5A4_COMBINED_HASH =
  "5ff895816fe989fcfcf77ee51d4ca3e025879d1c164d2cb55c1b4b7a9725b4ba";

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

function loadLockedSelection(): Array<{
  threadId: string;
  selectionHash: string;
  prefilterClassification: string;
}> {
  const file = path.resolve(process.cwd(), "tmp/o5a4-blind-selection.json");
  if (!existsSync(file)) {
    throw new Error("o5a4b_missing_selection_manifest");
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    selectionSeed: string;
    selected: Array<{
      threadId: string;
      selectionHash: string;
      prefilterClassification: string;
    }>;
  };
  if (!Array.isArray(raw.selected) || raw.selected.length === 0) {
    throw new Error("o5a4b_empty_selection");
  }
  return raw.selected;
}

function loadBaselineReport(): BlindEvaluationReport {
  const file = path.resolve(
    process.cwd(),
    "tmp/o5a4-blind-evaluation-report.json",
  );
  if (!existsSync(file)) {
    throw new Error("o5a4b_missing_baseline_report");
  }
  return JSON.parse(readFileSync(file, "utf8")) as BlindEvaluationReport;
}

describe.runIf(enabled)("O5A.4B gpt-5-mini comparison", () => {
  loadEnvLocal();
  // Override model AFTER .env.local — temporary for this run only.
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = CHALLENGER_MODEL;
  process.env.FEED_EXTRACTION_VERSION = "o5a.3";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "dry-runs the locked O5A.4 sample on gpt-5-mini and writes comparison report",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();

      const selection = loadLockedSelection();
      expect(selection).toHaveLength(20);
      const baselineReport = loadBaselineReport();
      expect(baselineReport.model).toBe(BASELINE_MODEL);

      const hashesBefore = freezeExtractionEngineHashes();
      expect(hashesBefore.combinedHash).toBe(O5A4_COMBINED_HASH);
      expect(hashesBefore.combinedHash).toBe(
        baselineReport.engineHashesBefore.combinedHash,
      );

      const sb = adminClient();
      const { count: feedItemsBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const probe = await probeFeedModelAccess({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
      });
      if (!probe.ok) {
        throw new Error(`o5a4b_probe_failed:${probe.errorCode}`);
      }
      expect(probe.model).toBe(CHALLENGER_MODEL);

      const reviews: BlindReviewRecord[] = [];
      let extractionAttempts = 0;
      let successes = 0;
      let failures = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let latencyTotal = 0;
      let latencyMin: number | null = null;
      let latencyMax: number | null = null;
      let actualModel: string | null = probe.actualModel;
      const rejectionReasons: Record<string, number> = {};
      const byType = { action: 0, change: 0, decision: 0, alert: 0 };
      let zeroInsightThreads = 0;
      let candidatesTotal = 0;
      let acceptedTotal = 0;
      let rejectedTotal = 0;

      for (const selected of selection) {
        if (isFeedCircuitOpen()) {
          failures += 1;
          reviews.push(
            buildReviewRecord({
              threadId: selected.threadId,
              threadIdMasked: maskUuid(selected.threadId),
              prefilterClassification: selected.prefilterClassification,
              modelThreadClassification: null,
              status: "circuit_open",
              errorCode: "circuit_open",
              rawCandidateCount: 0,
              acceptedSummaries: [],
              rejectionReasons: ["circuit_open"],
            }),
          );
          continue;
        }

        extractionAttempts += 1;
        const result = await extractFeedThreadDryRun({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: selected.threadId,
          persistMode: "dry_run",
        });

        expect(result.feedItemMutations.inserts).toBe(0);
        expect(result.feedItemMutations.updates).toBe(0);
        expect(result.feedItemMutations.deletes).toBe(0);
        expect(result.feedItemMutations.supersedes).toBe(0);

        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        totalTokens += result.totalTokens;
        if (result.actualModel) actualModel = result.actualModel;
        if (result.latencyMs != null) {
          latencyTotal += result.latencyMs;
          latencyMin =
            latencyMin == null
              ? result.latencyMs
              : Math.min(latencyMin, result.latencyMs);
          latencyMax =
            latencyMax == null
              ? result.latencyMs
              : Math.max(latencyMax, result.latencyMs);
        }

        if (result.status === "completed") successes += 1;
        else failures += 1;

        candidatesTotal += result.rawCandidateCount;
        acceptedTotal += result.candidates.length;
        rejectedTotal += result.rejected.length + result.gateRejected;
        for (const r of result.rejected) {
          rejectionReasons[r.reason] = (rejectionReasons[r.reason] ?? 0) + 1;
        }

        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: selected.threadId,
        });
        const messageIds = new Set((ctx?.messages ?? []).map((m) => m.id));
        const summaries = [];
        for (const c of result.candidates) {
          byType[c.type as keyof typeof byType] =
            (byType[c.type as keyof typeof byType] ?? 0) + 1;
          const src = ctx?.messages.find((m) => m.id === c.sourceMessageId);
          summaries.push(
            summarizeAcceptedCandidate({
              candidate: c,
              mailboxIdentity: ctx!.mailboxIdentity,
              accountIdentities: ctx!.accountIdentities,
              messageIds,
              sourceMessageSentAt: src?.sentAt ?? null,
              currentMessageBody: src?.body ?? "",
            }),
          );
        }

        if (result.status === "completed" && result.candidates.length === 0) {
          zeroInsightThreads += 1;
        }

        reviews.push(
          buildReviewRecord({
            threadId: selected.threadId,
            threadIdMasked: maskUuid(selected.threadId),
            prefilterClassification:
              result.prefilterClassification ?? selected.prefilterClassification,
            modelThreadClassification: result.modelThreadClassification,
            status: result.status,
            errorCode: result.errorCode,
            rawCandidateCount: result.rawCandidateCount,
            acceptedSummaries: summaries,
            rejectionReasons: result.rejected.map((r) => r.reason),
          }),
        );
      }

      const { count: feedItemsAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      const hashesAfter = freezeExtractionEngineHashes();
      expect(assertEngineHashesUnchanged(hashesBefore, hashesAfter)).toEqual({
        ok: true,
      });
      expect(feedItemsAfter).toBe(feedItemsBefore);

      const challenger: ModelRunSnapshot = {
        model: CHALLENGER_MODEL,
        actualModel,
        openai: {
          probeCount: 1,
          extractionAttempts,
          successes,
          failures,
          circuitBreaker: isFeedCircuitOpen(),
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCostUsd: estimateTokenCostUsd({
            model: CHALLENGER_MODEL,
            inputTokens,
            outputTokens,
          }),
          latencyTotalMs: latencyTotal,
          latencyAvgMs: extractionAttempts
            ? Math.round(latencyTotal / extractionAttempts)
            : 0,
          latencyMinMs: latencyMin,
          latencyMaxMs: latencyMax,
        },
        extraction: {
          zeroInsightThreads,
          candidates: candidatesTotal,
          accepted: acceptedTotal,
          rejected: rejectedTotal,
          rejectionReasons,
          byType,
        },
        reviews,
      };

      const baseline: ModelRunSnapshot = {
        model: BASELINE_MODEL,
        actualModel: baselineReport.actualModel,
        openai: baselineReport.openai,
        extraction: {
          ...baselineReport.extraction,
          byType: {
            action: baselineReport.extraction.byType.action ?? 0,
            change: baselineReport.extraction.byType.change ?? 0,
            decision: baselineReport.extraction.byType.decision ?? 0,
            alert: 0,
          },
        },
        reviews: baselineReport.reviews,
      };

      const sideBySide = buildSideBySide({
        baselineModel: BASELINE_MODEL,
        challengerModel: CHALLENGER_MODEL,
        baselineReviews: baseline.reviews,
        challengerReviews: challenger.reviews,
      });

      const countFlag = (
        rows: BlindReviewRecord[],
        flag: string,
      ): number =>
        rows.filter((r) => flagReviewCards(r).includes(flag)).length;

      const report: ModelComparisonReport = {
        evaluationVersion: "o5a4b_gpt5mini_v1",
        status: "AWAITING HUMAN MODEL COMPARISON",
        selectionSource: "tmp/o5a4-blind-selection.json",
        selectionSeed: "o5a4-blind-2026-08-13-v1",
        threadCount: selection.length,
        engineHashesMatchO5A4: hashesBefore.combinedHash === O5A4_COMBINED_HASH,
        engineCombinedHash: hashesBefore.combinedHash,
        feedItemsUnchanged: feedItemsAfter === feedItemsBefore,
        feedItemsBefore: feedItemsBefore ?? 0,
        feedItemsAfter: feedItemsAfter ?? 0,
        baseline,
        challenger,
        sideBySide,
        deltas: {
          acceptedDelta:
            challenger.extraction.accepted - baseline.extraction.accepted,
          candidatesDelta:
            challenger.extraction.candidates - baseline.extraction.candidates,
          rejectedDelta:
            challenger.extraction.rejected - baseline.extraction.rejected,
          zeroInsightDelta:
            challenger.extraction.zeroInsightThreads -
            baseline.extraction.zeroInsightThreads,
          inventedDeadlineBaseline: baseline.reviews.reduce(
            (n, r) => n + r.candidateSummaries.filter((c) => c.dueAt).length,
            0,
          ),
          inventedDeadlineChallenger: challenger.reviews.reduce(
            (n, r) => n + r.candidateSummaries.filter((c) => c.dueAt).length,
            0,
          ),
          verificationSuspectBaseline: countFlag(
            baseline.reviews,
            "verification_or_system_suspect",
          ),
          verificationSuspectChallenger: countFlag(
            challenger.reviews,
            "verification_or_system_suspect",
          ),
          marketingZeroBaseline: countFlag(
            baseline.reviews,
            "model_classified_marketing",
          ),
          marketingZeroChallenger: countFlag(
            challenger.reviews,
            "model_classified_marketing",
          ),
        },
        timestamp: new Date().toISOString(),
        note: "No automatic winner. Default model unchanged. No feed promotion. No O5B.",
      };

      const paths = writeModelComparisonReports(report);
      console.log(
        JSON.stringify(
          {
            status: report.status,
            baselineAccepted: baseline.extraction.accepted,
            challengerAccepted: challenger.extraction.accepted,
            feedItemsUnchanged: report.feedItemsUnchanged,
            engineHashesMatchO5A4: report.engineHashesMatchO5A4,
            reportMd: paths.mdPath,
            actualModel,
          },
          null,
          2,
        ),
      );

      expect(extractionAttempts).toBeGreaterThanOrEqual(1);
      expect(extractionAttempts).toBeLessThanOrEqual(20);
      expect(report.status).toBe("AWAITING HUMAN MODEL COMPARISON");
      if (isFeedCircuitOpen()) {
        expect(challenger.openai.circuitBreaker).toBe(true);
      } else {
        expect(extractionAttempts).toBe(20);
      }
    },
    1_200_000,
  );
});
