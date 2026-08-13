/**
 * O5A.5 — Feed safety dry-run on locked 20 threads (gpt-5-mini only).
 *   O5A5_SAFETY=1 npx vitest run src/server/feed/blind/o5a5-safety.live.test.ts
 *
 * Writes tmp/o5a5-feed-safety-evaluation.{json,md}
 * Never writes feed_items. No O5B / Onyx / webhooks.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isFeedCircuitOpen, resetFeedCircuit } from "@/server/feed/circuit";
import { buildFeedThreadContext } from "@/server/feed/context";
import { probeFeedModelAccess } from "@/server/feed/model-access";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import {
  freezeExtractionEngineHashes,
  maskUuid,
} from "./engine-hash";
import { extractFeedThreadDryRun } from "./dry-run";
import { summarizeAcceptedCandidate } from "./quality";
import {
  buildReviewRecord,
  type BlindEvaluationReport,
  type BlindReviewRecord,
} from "./report";
import {
  estimateTokenCostUsd,
  flagReviewCards,
  type ModelRunSnapshot,
} from "./comparison-report";

const enabled = process.env.O5A5_SAFETY === "1";

const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MODEL = "gpt-5-mini";

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
  if (!existsSync(file)) throw new Error("o5a5_missing_selection_manifest");
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    selected: Array<{
      threadId: string;
      selectionHash: string;
      prefilterClassification: string;
    }>;
  };
  if (!Array.isArray(raw.selected) || raw.selected.length !== 20) {
    throw new Error("o5a5_selection_must_be_20");
  }
  return raw.selected;
}

function loadJsonIfExists<T>(rel: string): T | null {
  const file = path.resolve(process.cwd(), rel);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function snapshotFromBlind(report: BlindEvaluationReport): ModelRunSnapshot {
  return {
    model: report.model,
    actualModel: report.actualModel,
    openai: report.openai,
    extraction: {
      ...report.extraction,
      byType: {
        action: report.extraction.byType?.action ?? 0,
        change: report.extraction.byType?.change ?? 0,
        decision: report.extraction.byType?.decision ?? 0,
        alert: (report.extraction.byType as { alert?: number })?.alert ?? 0,
      },
    },
    reviews: report.reviews,
  };
}

function snapshotFromComparisonChallenger(
  report: {
    challenger: ModelRunSnapshot;
  },
): ModelRunSnapshot {
  const c = report.challenger;
  return {
    ...c,
    extraction: {
      ...c.extraction,
      byType: {
        action: c.extraction.byType.action ?? 0,
        change: c.extraction.byType.change ?? 0,
        decision: c.extraction.byType.decision ?? 0,
        alert: (c.extraction.byType as { alert?: number }).alert ?? 0,
      },
    },
  };
}

function writeO5a5Reports(report: Record<string, unknown>) {
  const dir = path.resolve(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "o5a5-feed-safety-evaluation.json");
  const mdPath = path.join(dir, "o5a5-feed-safety-evaluation.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const o5a5 = report.o5a5 as ModelRunSnapshot;
  const o5a4 = report.o5a4 as ModelRunSnapshot | null;
  const o5a4b = report.o5a4b as ModelRunSnapshot | null;
  const lines: string[] = [
    "# O5A.5 Feed Safety Evaluation",
    "",
    `Status: **${report.status}**`,
    `Model: \`${o5a5.model}\` (actual: \`${o5a5.actualModel}\`)`,
    `Engine hash: \`${report.engineCombinedHash}\``,
    `feed_items: ${report.feedItemsBefore} → ${report.feedItemsAfter} (unchanged: ${report.feedItemsUnchanged})`,
    "",
    "## Side-by-side totals",
    "",
    "| Metric | O5A.4 gpt-4o-mini | O5A.4B gpt-5-mini | O5A.5 gpt-5-mini+safety |",
    "| --- | ---: | ---: | ---: |",
    `| accepted | ${o5a4?.extraction.accepted ?? "—"} | ${o5a4b?.extraction.accepted ?? "—"} | ${o5a5.extraction.accepted} |`,
    `| rejected | ${o5a4?.extraction.rejected ?? "—"} | ${o5a4b?.extraction.rejected ?? "—"} | ${o5a5.extraction.rejected} |`,
    `| zero insight | ${o5a4?.extraction.zeroInsightThreads ?? "—"} | ${o5a4b?.extraction.zeroInsightThreads ?? "—"} | ${o5a5.extraction.zeroInsightThreads} |`,
    `| actions | ${o5a4?.extraction.byType.action ?? "—"} | ${o5a4b?.extraction.byType.action ?? "—"} | ${o5a5.extraction.byType.action} |`,
    `| changes | ${o5a4?.extraction.byType.change ?? "—"} | ${o5a4b?.extraction.byType.change ?? "—"} | ${o5a5.extraction.byType.change} |`,
    `| decisions | ${o5a4?.extraction.byType.decision ?? "—"} | ${o5a4b?.extraction.byType.decision ?? "—"} | ${o5a5.extraction.byType.decision} |`,
    `| alerts | ${o5a4?.extraction.byType.alert ?? 0} | ${o5a4b?.extraction.byType.alert ?? 0} | ${o5a5.extraction.byType.alert} |`,
    `| tokens | ${o5a4?.openai.totalTokens ?? "—"} | ${o5a4b?.openai.totalTokens ?? "—"} | ${o5a5.openai.totalTokens} |`,
    `| est. cost USD | ${o5a4?.openai.estimatedCostUsd ?? "—"} | ${o5a4b?.openai.estimatedCostUsd ?? "—"} | ${o5a5.openai.estimatedCostUsd} |`,
    `| latency avg ms | ${o5a4?.openai.latencyAvgMs ?? "—"} | ${o5a4b?.openai.latencyAvgMs ?? "—"} | ${o5a5.openai.latencyAvgMs} |`,
    "",
    "## Success checks (sample)",
    "",
    "```",
    JSON.stringify(report.successChecks, null, 2),
    "```",
    "",
    "## Cards that would enter the feed",
    "",
  ];

  for (const r of o5a5.reviews) {
    if (r.candidateSummaries.length === 0) continue;
    lines.push(`### ${r.threadIdMasked}`);
    for (const c of r.candidateSummaries) {
      lines.push(
        `- **${c.type}** ${c.relationLabel}: ${c.requestedAction ?? c.evidenceExcerpt}`,
      );
      lines.push(`  - evidence: ${c.evidenceExcerpt}`);
    }
    lines.push("");
  }

  lines.push("## Filtered / zero-insight threads", "");
  for (const r of o5a5.reviews) {
    if (r.candidateSummaries.length > 0) continue;
    lines.push(
      `- ${r.threadIdMasked}: ${r.rejectionReasons.slice(0, 5).join(", ") || r.status}`,
    );
  }
  lines.push("", "AWAITING HUMAN REVIEW", "");
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  return { jsonPath, mdPath };
}

describe.runIf(enabled)("O5A.5 feed safety dry-run", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = MODEL;
  process.env.FEED_EXTRACTION_VERSION = "o5a.5";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "dry-runs locked 20 threads with gpt-5-mini + safety and writes evaluation",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();

      const selection = loadLockedSelection();
      expect(selection).toHaveLength(20);

      const o5a4Report = loadJsonIfExists<BlindEvaluationReport>(
        "tmp/o5a4-blind-evaluation-report.json",
      );
      const o5a4bReport = loadJsonIfExists<{
        challenger: ModelRunSnapshot;
      }>("tmp/o5a4b-gpt5mini-comparison.json");

      const hashesBefore = freezeExtractionEngineHashes();
      const sb = adminClient();
      const { count: feedItemsBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const probe = await probeFeedModelAccess({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
      });
      if (!probe.ok) throw new Error(`o5a5_probe_failed:${probe.errorCode}`);
      expect(probe.model).toBe(MODEL);

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
          const key = c.type as keyof typeof byType;
          byType[key] = (byType[key] ?? 0) + 1;
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
      expect(hashesAfter.combinedHash).toBe(hashesBefore.combinedHash);
      expect(feedItemsAfter).toBe(feedItemsBefore);

      const o5a5: ModelRunSnapshot = {
        model: MODEL,
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
            model: MODEL,
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

      const blob = reviews
        .flatMap((r) => r.candidateSummaries)
        .map(
          (c) =>
            `${c.type}|${c.requestedAction ?? ""}|${c.evidenceExcerpt}|${c.requesterDisplayName ?? ""}`,
        )
        .join("\n")
        .toLowerCase();

      const successChecks = {
        attachedMaterialsNotAction: !/מצ["״']?ב רשימת החומר/.test(blob) ||
          !reviews.some((r) =>
            r.candidateSummaries.some(
              (c) =>
                c.type === "action" &&
                /מצ["״']?ב רשימת החומר/.test(c.evidenceExcerpt),
            ),
          ),
        appsheetNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /appsheet|verification badge|תג אימות/i.test(
                `${c.evidenceExcerpt} ${c.requestedAction ?? ""}`,
              ),
          ),
        ),
        supportVerifiedAiNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /support verified|verified ai/i.test(
                `${c.requesterDisplayName ?? ""} ${c.evidenceExcerpt}`,
              ),
          ),
        ),
        aiSupportCenterNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /ai support center/i.test(
                `${c.requesterDisplayName ?? ""} ${c.evidenceExcerpt}`,
              ),
          ),
        ),
        cheneyColdNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /cheney|cad-ready|share your technical documents/i.test(
                `${c.requesterDisplayName ?? ""} ${c.evidenceExcerpt}`,
              ),
          ),
        ),
        deedyColdNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /deedy|unpause the project/i.test(
                `${c.requesterDisplayName ?? ""} ${c.evidenceExcerpt} ${c.requestedAction ?? ""}`,
              ),
          ),
        ),
        miaPausedNotUnpause: !reviews.some((r) =>
          r.candidateSummaries.some((c) =>
            /unpause|בטל השהי/i.test(c.requestedAction ?? ""),
          ),
        ),
        greetingOnlyNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /^(?:היי|שלום)\b/i.test(c.evidenceExcerpt.trim()),
          ),
        ),
        legalAtMostOneAlert: (() => {
          const legalAlerts = reviews.flatMap((r) =>
            r.candidateSummaries.filter(
              (c) =>
                c.type === "alert" &&
                /legal|דרישה משפטית|copyright|dmca/i.test(
                  `${c.requestedAction ?? ""} ${c.evidenceExcerpt} ${c.relationLabel}`,
                ),
            ),
          );
          return legalAlerts.length <= 1;
        })(),
        noInventedDeadlineSuspect: !reviews.some((r) =>
          flagReviewCards(r).includes("has_due") &&
          r.candidateSummaries.some((c) => c.automatedValidation === "fail"),
        ),
        noSelfRequest: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.automatedValidation === "fail" &&
              /self/i.test(c.evidenceExcerpt + (c.requestedAction ?? "")),
          ),
        ),
      };

      const report = {
        evaluationVersion: "o5a5_feed_safety_v1",
        status: "AWAITING HUMAN REVIEW",
        selectionSource: "tmp/o5a4-blind-selection.json",
        selectionSeed: "o5a4-blind-2026-08-13-v1",
        threadCount: selection.length,
        model: MODEL,
        actualModel,
        extractionVersion: "o5a.5",
        engineCombinedHash: hashesBefore.combinedHash,
        feedItemsUnchanged: feedItemsAfter === feedItemsBefore,
        feedItemsBefore: feedItemsBefore ?? 0,
        feedItemsAfter: feedItemsAfter ?? 0,
        alertSchemaMigration: "supabase/migrations/0020_feed_alert_type.sql",
        alertPersistBlockedUntilMigration: true,
        noO5B: true,
        noOnyx: true,
        noWebhooks: true,
        successChecks,
        o5a4: o5a4Report ? snapshotFromBlind(o5a4Report) : null,
        o5a4b: o5a4bReport
          ? snapshotFromComparisonChallenger(o5a4bReport)
          : null,
        o5a5,
        timestamp: new Date().toISOString(),
      };

      const paths = writeO5a5Reports(report);
      console.log(
        JSON.stringify(
          {
            status: report.status,
            accepted: o5a5.extraction.accepted,
            byType: o5a5.extraction.byType,
            feedItemsUnchanged: report.feedItemsUnchanged,
            successChecks,
            reportMd: paths.mdPath,
            actualModel,
          },
          null,
          2,
        ),
      );

      expect(extractionAttempts).toBeLessThanOrEqual(20);
      expect(report.status).toBe("AWAITING HUMAN REVIEW");
      expect(report.feedItemsUnchanged).toBe(true);
      if (!isFeedCircuitOpen()) {
        expect(extractionAttempts).toBe(20);
      }
    },
    1_200_000,
  );
});
