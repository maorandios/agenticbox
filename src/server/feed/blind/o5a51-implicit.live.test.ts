/**
 * O5A.5.1 — Implicit request recovery dry-run on locked 20 threads.
 *   O5A51_IMPLICIT=1 npx vitest run src/server/feed/blind/o5a51-implicit.live.test.ts
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
import { freezeExtractionEngineHashes, maskUuid } from "./engine-hash";
import { extractFeedThreadDryRun } from "./dry-run";
import { summarizeAcceptedCandidate } from "./quality";
import { buildReviewRecord, type BlindReviewRecord } from "./report";
import { estimateTokenCostUsd } from "./comparison-report";

const enabled = process.env.O5A51_IMPLICIT === "1";
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

function loadLockedSelection() {
  const file = path.resolve(process.cwd(), "tmp/o5a4-blind-selection.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    selected: Array<{
      threadId: string;
      prefilterClassification: string;
    }>;
  };
  if (!Array.isArray(raw.selected) || raw.selected.length !== 20) {
    throw new Error("o5a51_selection_must_be_20");
  }
  return raw.selected;
}

describe.runIf(enabled)("O5A.5.1 implicit request dry-run", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = MODEL;
  process.env.FEED_EXTRACTION_VERSION = "o5a.5.1";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";
  // Pilot dry-run may exceed the default daily quota after prior evals.
  process.env.FEED_DAILY_EXTRACTION_LIMIT = "250";
  if (!process.env.FEED_AI_TIMEOUT_MS) {
    process.env.FEED_AI_TIMEOUT_MS = "120000";
  }

  it(
    "dry-runs locked 20 threads and writes o5a51 evaluation",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();
      const selection = loadLockedSelection();
      const hashesBefore = freezeExtractionEngineHashes();
      const sb = adminClient();
      const { count: feedItemsBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const probe = await probeFeedModelAccess({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
      });
      if (!probe.ok) throw new Error(`o5a51_probe_failed:${probe.errorCode}`);

      const reviews: BlindReviewRecord[] = [];
      const outcomes: Record<string, number> = {};
      let extractionAttempts = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let reasoningTokens = 0;
      let latencyTotal = 0;
      let actualModel: string | null = probe.actualModel;
      const byType = { action: 0, change: 0, decision: 0, alert: 0 };
      let acceptedTotal = 0;
      let zeroInsight = 0;
      let failures = 0;
      const rejectionReasons: Record<string, number> = {};
      const perThread: Array<Record<string, unknown>> = [];

      for (const selected of selection) {
        if (isFeedCircuitOpen()) {
          failures += 1;
          outcomes.circuit_open = (outcomes.circuit_open ?? 0) + 1;
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
        outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;

        // API failures must never count as zero insight.
        if (result.outcome.startsWith("failed")) {
          failures += 1;
          expect(result.outcome).not.toBe("completed_zero_insight");
        } else if (result.outcome === "completed_zero_insight") {
          zeroInsight += 1;
        }

        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        totalTokens += result.totalTokens;
        reasoningTokens += result.reasoningTokens ?? 0;
        if (result.actualModel) actualModel = result.actualModel;
        if (result.latencyMs != null) latencyTotal += result.latencyMs;
        acceptedTotal += result.candidates.length;
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

        const masked = maskUuid(selected.threadId);
        reviews.push(
          buildReviewRecord({
            threadId: selected.threadId,
            threadIdMasked: masked,
            prefilterClassification:
              result.prefilterClassification ?? selected.prefilterClassification,
            modelThreadClassification: result.modelThreadClassification,
            status: result.status,
            errorCode: result.errorCode ?? result.outcome,
            rawCandidateCount: result.rawCandidateCount,
            acceptedSummaries: summaries,
            rejectionReasons: result.rejected.map((r) => r.reason),
          }),
        );
        perThread.push({
          threadIdMasked: masked,
          outcome: result.outcome,
          status: result.status,
          errorCode: result.errorCode,
          incompleteReason: result.incompleteReason,
          accepted: result.candidates.map((c) => ({
            type: c.type,
            speechAct: c.requestSpeechAct,
            requestedAction: c.requestedAction,
            evidence: c.evidenceText,
            alertCategory: c.alertCategory,
            alertVerificationState: c.alertVerificationState,
          })),
          rejected: result.rejected.map((r) => r.reason),
        });
      }

      const { count: feedItemsAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      expect(freezeExtractionEngineHashes().combinedHash).toBe(
        hashesBefore.combinedHash,
      );
      expect(feedItemsAfter).toBe(feedItemsBefore);

      const legalAlertCount = perThread.reduce((n, t) => {
        const accepted = t.accepted as Array<{ alertCategory?: string | null }>;
        return (
          n + accepted.filter((c) => c.alertCategory === "legal").length
        );
      }, 0);

      const successChecks = {
        verificationFiltered: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /verified ai|verification badge|appsheet|ai support/i.test(
                `${c.requesterDisplayName ?? ""} ${c.evidenceExcerpt}`,
              ),
          ),
        ),
        coldOutreachFiltered: !reviews.some((r) =>
          r.candidateSummaries.some((c) =>
            /cad-ready|unpause the project|share your technical documents/i.test(
              `${c.evidenceExcerpt} ${c.requestedAction ?? ""}`,
            ),
          ),
        ),
        attachedListNotAction: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /מצ["״']?ב רשימת החומר(?!\s*לאישור)/.test(c.evidenceExcerpt),
          ),
        ),
        greetingOnlyFiltered: !reviews.some((r) =>
          r.candidateSummaries.some(
            (c) =>
              c.type === "action" &&
              /^(?:היי|שלום)\b/i.test(c.evidenceExcerpt.trim()),
          ),
        ),
        legalAlertCount,
        legalAlertExactlyOneWhenPresent: legalAlertCount === 1,
        noFailedCountedAsZeroInsight: true,
        feedItemsUnchanged: feedItemsAfter === feedItemsBefore,
      };

      const report = {
        evaluationVersion: "o5a51_implicit_v1",
        status: "AWAITING HUMAN REVIEW",
        model: MODEL,
        actualModel,
        extractionVersion: "o5a.5.1",
        engineCombinedHash: hashesBefore.combinedHash,
        feedItemsBefore: feedItemsBefore ?? 0,
        feedItemsAfter: feedItemsAfter ?? 0,
        feedItemsUnchanged: feedItemsAfter === feedItemsBefore,
        migration0020Applied: false,
        noO5B: true,
        noOnyx: true,
        noWebhooks: true,
        openai: {
          probeCount: 1,
          extractionAttempts,
          failures,
          inputTokens,
          outputTokens,
          reasoningTokens,
          totalTokens,
          estimatedCostUsd: estimateTokenCostUsd({
            model: MODEL,
            inputTokens,
            outputTokens,
          }),
          latencyAvgMs: extractionAttempts
            ? Math.round(latencyTotal / extractionAttempts)
            : 0,
        },
        extraction: {
          accepted: acceptedTotal,
          zeroInsight,
          failures,
          outcomes,
          byType,
          rejectionReasons,
        },
        successChecks,
        perThread,
        reviews,
        timestamp: new Date().toISOString(),
      };

      const dir = path.resolve(process.cwd(), "tmp");
      mkdirSync(dir, { recursive: true });
      const jsonPath = path.join(dir, "o5a51-implicit-request-evaluation.json");
      const mdPath = path.join(dir, "o5a51-implicit-request-evaluation.md");
      writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

      const lines = [
        "# O5A.5.1 Implicit Business Request Evaluation",
        "",
        `Status: **${report.status}**`,
        `Model: \`${MODEL}\` (actual: \`${actualModel}\`)`,
        `feed_items: ${feedItemsBefore} → ${feedItemsAfter}`,
        "",
        "## Totals",
        "",
        `- accepted: ${acceptedTotal}`,
        `- zero insight: ${zeroInsight}`,
        `- failures: ${failures}`,
        `- byType: ${JSON.stringify(byType)}`,
        `- outcomes: ${JSON.stringify(outcomes)}`,
        `- tokens: ${totalTokens} (reasoning≈${reasoningTokens})`,
        `- est. cost USD: ${report.openai.estimatedCostUsd}`,
        `- latency avg ms: ${report.openai.latencyAvgMs}`,
        "",
        "## Success checks",
        "",
        "```",
        JSON.stringify(successChecks, null, 2),
        "```",
        "",
        "## Per thread",
        "",
      ];
      for (const t of perThread) {
        lines.push(`### ${t.threadIdMasked}`);
        lines.push(`- outcome: \`${t.outcome}\``);
        const accepted = t.accepted as Array<Record<string, unknown>>;
        if (accepted.length === 0) {
          lines.push(`- rejected: ${(t.rejected as string[]).join(", ") || "—"}`);
        } else {
          for (const c of accepted) {
            lines.push(
              `- **${c.type}** (${c.speechAct ?? "—"}): ${c.requestedAction}`,
            );
            lines.push(`  - evidence: ${c.evidence}`);
          }
        }
        lines.push("");
      }
      lines.push("AWAITING HUMAN REVIEW", "");
      writeFileSync(mdPath, lines.join("\n"), "utf8");

      console.log(
        JSON.stringify(
          {
            status: report.status,
            accepted: acceptedTotal,
            byType,
            outcomes,
            successChecks,
            reportMd: mdPath,
            actualModel,
          },
          null,
          2,
        ),
      );

      expect(extractionAttempts).toBeLessThanOrEqual(20);
      expect(report.feedItemsUnchanged).toBe(true);
      expect(report.migration0020Applied).toBe(false);
      if (!isFeedCircuitOpen()) expect(extractionAttempts).toBe(20);
    },
    1_800_000,
  );
});
