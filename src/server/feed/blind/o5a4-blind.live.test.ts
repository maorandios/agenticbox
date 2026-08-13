/**
 * O5A.4 Blind Generalization Evaluation — live dry_run only.
 *   O5A4_BLIND=1 npx vitest run src/server/feed/blind/o5a4-blind.live.test.ts
 *
 * No feed_items writes. No O5B. No prompt changes. AWAITING HUMAN REVIEW.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit, isFeedCircuitOpen } from "@/server/feed/circuit";
import { buildFeedThreadContext } from "@/server/feed/context";
import { probeFeedModelAccess } from "@/server/feed/model-access";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import {
  O5A4_EVALUATION_VERSION,
  O5A4_HARD_CAP,
  O5A4_MODEL,
  O5A4_SELECTION_SEED,
} from "./constants";
import {
  assertEngineHashesUnchanged,
  freezeExtractionEngineHashes,
  maskAccountId,
  maskUuid,
} from "./engine-hash";
import { extractFeedThreadDryRun } from "./dry-run";
import {
  aggregateBlindQuality,
  summarizeAcceptedCandidate,
} from "./quality";
import {
  buildReviewRecord,
  estimateGpt4oMiniCost,
  writeBlindManifest,
  writeBlindReports,
  type BlindEvaluationReport,
  type BlindReviewRecord,
} from "./report";
import { buildBlindSelection } from "./selection";

const enabled = process.env.O5A4_BLIND === "1";

const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";

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

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

describe.runIf(enabled)("O5A.4 blind generalization evaluation", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = O5A4_MODEL;
  process.env.FEED_EXTRACTION_VERSION = "o5a.3";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "selects ≤20 unseen threads, dry-runs extraction, writes local review report",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();

      const hashesBefore = freezeExtractionEngineHashes();
      const sb = adminClient();

      const { count: feedItemsBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      const { count: supersededBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "superseded");

      const selection = await buildBlindSelection({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        seed: O5A4_SELECTION_SEED,
        hardCap: O5A4_HARD_CAP,
      });

      // Lock sample — print censored summary only (no bodies).
      console.log(
        JSON.stringify(
          {
            scanned: selection.scanned,
            previouslySeenRemoved: selection.previouslySeenRemoved,
            goldenExcluded: selection.goldenExcluded,
            prefilterCounts: selection.prefilterCounts,
            eligibleUnseen: selection.eligibleUnseen,
            selected: selection.selected.length,
            sampleSmallerThanCap: selection.sampleSmallerThanCap,
            threadIdsMasked: selection.selected.map((t) => t.threadIdMasked),
            selectionHashesShort: selection.selected.map(
              (t) => t.selectionHashShort,
            ),
          },
          null,
          2,
        ),
      );

      writeBlindManifest({
        evaluationVersion: O5A4_EVALUATION_VERSION,
        selectionSeed: O5A4_SELECTION_SEED,
        selected: selection.selected.map((t) => ({
          threadId: t.threadId,
          selectionHash: t.selectionHash,
          prefilterClassification: t.prefilterClassification,
        })),
        engineHashes: hashesBefore,
        mailAccountIdMasked: maskAccountId(MAIL_ACCOUNT_ID),
        gitCommitSha: gitSha(),
        model: O5A4_MODEL,
      });

      const lockedIds = selection.selected.map((t) => t.threadId);
      expect(lockedIds.length).toBeLessThanOrEqual(O5A4_HARD_CAP);

      const probe = await probeFeedModelAccess({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
      });
      if (!probe.ok) {
        throw new Error(`o5a4_probe_failed:${probe.errorCode}`);
      }

      const reviews: BlindReviewRecord[] = [];
      const allSummaries = [];
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
      const byType = { action: 0, change: 0, decision: 0 };
      let zeroInsightThreads = 0;
      let candidatesTotal = 0;
      let acceptedTotal = 0;
      let rejectedTotal = 0;

      for (const selected of selection.selected) {
        if (isFeedCircuitOpen()) {
          failures += 1;
          reviews.push(
            buildReviewRecord({
              threadId: selected.threadId,
              threadIdMasked: selected.threadIdMasked,
              prefilterClassification: selected.prefilterClassification,
              modelThreadClassification: null,
              status: "circuit_open",
              errorCode: "circuit_open",
              rawCandidateCount: 0,
              acceptedSummaries: [],
              rejectionReasons: ["circuit_open"],
            }),
          );
          // Locked sample — do not replace with alternate.
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
          const summary = summarizeAcceptedCandidate({
            candidate: c,
            mailboxIdentity: ctx!.mailboxIdentity,
            accountIdentities: ctx!.accountIdentities,
            messageIds,
            sourceMessageSentAt: src?.sentAt ?? null,
            currentMessageBody: src?.body ?? "",
          });
          summaries.push(summary);
          allSummaries.push(summary);
        }

        if (
          result.status === "completed" &&
          result.candidates.length === 0
        ) {
          zeroInsightThreads += 1;
        }

        reviews.push(
          buildReviewRecord({
            threadId: selected.threadId,
            threadIdMasked: selected.threadIdMasked,
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
      const { count: supersededAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "superseded");

      const hashesAfter = freezeExtractionEngineHashes();
      const hashCheck = assertEngineHashesUnchanged(hashesBefore, hashesAfter);
      expect(hashCheck).toEqual({ ok: true });

      expect(feedItemsAfter).toBe(feedItemsBefore);
      expect(supersededAfter).toBe(supersededBefore);

      const status: BlindEvaluationReport["status"] =
        acceptedTotal < 5
          ? "INSUFFICIENT OUTPUT SAMPLE"
          : "AWAITING HUMAN REVIEW";

      const report: BlindEvaluationReport = {
        evaluationVersion: O5A4_EVALUATION_VERSION,
        selectionSeed: O5A4_SELECTION_SEED,
        status,
        gitCommitSha: gitSha(),
        model: O5A4_MODEL,
        actualModel,
        engineHashesBefore: hashesBefore,
        engineHashesAfter: hashesAfter,
        engineHashesUnchanged: hashCheck.ok,
        selection: {
          ...selection,
          mailAccountIdMasked: maskAccountId(MAIL_ACCOUNT_ID),
        },
        openai: {
          probeCount: 1,
          extractionAttempts,
          successes,
          failures,
          circuitBreaker: isFeedCircuitOpen(),
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCostUsd: estimateGpt4oMiniCost({
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
        automatedQuality: aggregateBlindQuality(allSummaries),
        safety: {
          feedItemsBefore: feedItemsBefore ?? 0,
          feedItemsAfter: feedItemsAfter ?? 0,
          feedItemsUnchanged: feedItemsAfter === feedItemsBefore,
          statusTransitions: 0,
          supersededBefore: supersededBefore ?? 0,
          supersededAfter: supersededAfter ?? 0,
          supersededUnchanged: supersededAfter === supersededBefore,
          replacement: false,
          o5b: false,
          onyxChat: false,
        },
        reviews,
        timestamp: new Date().toISOString(),
      };

      const paths = writeBlindReports(report);
      console.log(
        JSON.stringify(
          {
            status: report.status,
            selected: selection.selected.length,
            accepted: acceptedTotal,
            feedItemsUnchanged: report.safety.feedItemsUnchanged,
            reportMd: paths.mdPath,
            reportJson: paths.jsonPath,
            maskedFirst: maskUuid(lockedIds[0] ?? ""),
          },
          null,
          2,
        ),
      );

      expect(report.safety.feedItemsUnchanged).toBe(true);
      expect(report.safety.o5b).toBe(false);
      expect(extractionAttempts).toBeLessThanOrEqual(O5A4_HARD_CAP);
    },
    900_000,
  );
});
