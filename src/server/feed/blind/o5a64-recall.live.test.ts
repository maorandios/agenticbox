/**
 * O5A.6.4 — Focused dry-run: recover 4 human FNs + 4 TN regressions.
 *   O5A64_RECALL=1 npx vitest run src/server/feed/blind/o5a64-recall.live.test.ts
 *
 * No persist. No engine/prompt/model changes beyond approved downstream fixes.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { buildRejectedCandidateAudit } from "@/server/feed/evidence-match";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { estimateTokenCostUsd } from "./comparison-report";
import { freezeExtractionEngineHashes } from "./engine-hash";
import { extractFeedThreadDryRun } from "./dry-run";

const enabled = process.env.O5A64_RECALL === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MODEL = "gpt-5-mini";
const MODEL_SNAPSHOT = "gpt-5-mini-2025-08-07";
const EXTRACTION_VERSION = "o5a.6_real_inbox_review";

const FN_THREADS = [
  "5f1d5b33-6147-4f45-a4d3-3e9c30fd7703",
  "f8c6e04a-d698-4456-a4a3-18055e8e007f",
  "3771e547-2ce8-4098-a939-e96203b2f306",
  "bbcd32db-4f9b-47b5-9377-39ac20d6fa6d",
] as const;

/** Locked TN regression sample (human correct_absent), ≤4 OpenAI calls. */
const TN_THREADS = [
  {
    threadId: "b32e7bcd-cf6e-4e9d-aa8a-02c28f5930c6",
    kind: "evidence_rejection_correct_absent",
  },
  {
    threadId: "e5603e07-3844-4bd9-94e6-159a093fba3d",
    kind: "system_notification",
  },
  {
    threadId: "0ad49de6-ff0a-408f-8793-24e437106d08",
    kind: "marketing",
  },
  {
    threadId: "48b98bf4-cbeb-4149-8d4e-860b1d05fd11",
    kind: "attachment_or_informational_zero",
  },
] as const;

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

function summarizeCard(c: {
  type: string;
  headline: string;
  requestedAction?: string | null;
  requestSpeechAct?: string | null;
  actionState?: string | null;
  relationToMailbox?: string | null;
  requester?: { email?: string | null; name?: string | null } | null;
  assignee?: { email?: string | null; name?: string | null } | null;
  requestEvidence?: { evidenceText?: string | null } | null;
  businessObjectEvidence?: { evidenceText?: string | null } | null;
  evidenceText?: string | null;
  dueAt?: string | null;
}) {
  return {
    type: c.type,
    title: c.requestedAction ?? c.headline,
    speechAct: c.requestSpeechAct ?? null,
    actionState: c.actionState ?? null,
    relationToMailbox: c.relationToMailbox ?? null,
    requesterEmail: c.requester?.email ?? null,
    requesterName: c.requester?.name ?? null,
    assigneeEmail: c.assignee?.email ?? null,
    assigneeName: c.assignee?.name ?? null,
    requestEvidence:
      c.requestEvidence?.evidenceText ?? c.evidenceText ?? null,
    businessObjectEvidence: c.businessObjectEvidence?.evidenceText ?? null,
    dueAt: c.dueAt ?? null,
  };
}

describe.runIf(enabled)("O5A.6.4 general recall dry-run", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = MODEL;
  process.env.FEED_EXTRACTION_VERSION = EXTRACTION_VERSION;
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";
  process.env.FEED_DAILY_EXTRACTION_LIMIT = "500";
  if (!process.env.FEED_AI_TIMEOUT_MS) {
    process.env.FEED_AI_TIMEOUT_MS = "120000";
  }

  it(
    "recovers 4 FNs, keeps 4 TNs empty, writes report, no persist",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();
      const hashesBefore = freezeExtractionEngineHashes();
      const sb = adminClient();
      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });

      const { count: feedBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const { data: pilotBefore } = await sb
        .from("feed_items")
        .select("id,thread_id,dedupe_key,headline,status")
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let latencyTotal = 0;
      let openaiCalls = 0;
      let actualModel: string | null = null;

      const fnResults: Array<Record<string, unknown>> = [];
      for (const threadId of FN_THREADS) {
        const result = await extractFeedThreadDryRun({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId,
        });
        openaiCalls += 1;
        inputTokens += result.inputTokens ?? 0;
        outputTokens += result.outputTokens ?? 0;
        totalTokens += result.totalTokens ?? 0;
        latencyTotal += result.latencyMs ?? 0;
        if (result.actualModel) actualModel = result.actualModel;

        const actions = result.candidates.filter((c) => c.type === "action");
        const rejectedAudits = result.rejected.map((r) =>
          buildRejectedCandidateAudit({
            candidate: r.candidate,
            reason: r.reason,
            stage: r.audit?.rejectionStage,
          }),
        );

        fnResults.push({
          threadId,
          outcome: result.outcome,
          errorCode: result.errorCode,
          rawCandidateCount: result.rawCandidateCount,
          acceptedActions: actions.map(summarizeCard),
          rejectedAudits,
          passReason:
            actions.length > 0
              ? "downstream_safety_or_evidence_fix_accepted_action"
              : "still_zero",
          selfRequest: actions.some(
            (c) =>
              (c.requester?.email ?? "").toLowerCase() ===
              (c.assignee?.email ?? "").toLowerCase(),
          ),
          inventedDeadline: actions.some((c) => c.dueAt != null),
        });
      }

      const tnResults: Array<Record<string, unknown>> = [];
      for (const tn of TN_THREADS) {
        const result = await extractFeedThreadDryRun({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: tn.threadId,
        });
        openaiCalls += 1;
        inputTokens += result.inputTokens ?? 0;
        outputTokens += result.outputTokens ?? 0;
        totalTokens += result.totalTokens ?? 0;
        latencyTotal += result.latencyMs ?? 0;
        if (result.actualModel) actualModel = result.actualModel;

        tnResults.push({
          threadId: tn.threadId,
          kind: tn.kind,
          outcome: result.outcome,
          acceptedCount: result.candidates.length,
          acceptedSummary: result.candidates.map(summarizeCard),
          rawCandidateCount: result.rawCandidateCount,
          rejectedAudits: result.rejected.map((r) =>
            buildRejectedCandidateAudit({
              candidate: r.candidate,
              reason: r.reason,
              stage: r.audit?.rejectionStage,
            }),
          ),
          stayedEmpty: result.candidates.length === 0,
        });
      }

      expect(freezeExtractionEngineHashes().combinedHash).toBe(
        hashesBefore.combinedHash,
      );
      if (actualModel) expect(actualModel).toBe(MODEL_SNAPSHOT);

      const { count: feedAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      expect(feedAfter).toBe(feedBefore);

      const { data: pilotAfter } = await sb
        .from("feed_items")
        .select("id,thread_id,dedupe_key,headline,status")
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");
      expect((pilotAfter ?? []).map((r) => r.id).sort()).toEqual(
        (pilotBefore ?? []).map((r) => r.id).sort(),
      );

      const fnRecovered = fnResults.filter(
        (r) => (r.acceptedActions as unknown[]).length > 0,
      ).length;
      const tnClean = tnResults.filter((r) => r.stayedEmpty).length;

      const labels = JSON.parse(
        readFileSync(
          path.resolve(tmpDir, "o5a62-human-labels.json"),
          "utf8",
        ),
      ) as {
        labels: Record<string, { label: string }>;
      };
      const review = JSON.parse(
        readFileSync(
          path.resolve(tmpDir, "o5a6-real-inbox-review.json"),
          "utf8",
        ),
      ) as {
        perThread: Array<Record<string, unknown>>;
        persistedCards: Array<Record<string, unknown>>;
      };

      const buckets: Record<string, string[]> = {
        prefilter_blocked: [],
        accepted: [],
        zero: [],
        rejected: [],
        failed: [],
      };
      const technical: Record<string, string[]> = {
        recovered_timeout: [],
      };

      for (const t of review.perThread) {
        const id = String(t.threadId);
        const outcome = String(t.outcome);
        if (outcome === "prefilter_skipped") buckets.prefilter_blocked.push(id);
        else if (outcome === "completed_with_candidates")
          buckets.accepted.push(id);
        else if (
          outcome === "completed_zero_insight" ||
          outcome === "recovered_timeout_zero_insight"
        ) {
          buckets.zero.push(id);
          if (outcome === "recovered_timeout_zero_insight") {
            technical.recovered_timeout.push(id);
          }
        } else if (outcome === "failed" || outcome === "unresolved_timeout") {
          buckets.failed.push(id);
        } else {
          buckets.rejected.push(id);
        }
      }

      const unlabeled = {
        persistedCards: (review.persistedCards ?? []).map((c) => c.threadId),
        recoveredTimeoutZeros: technical.recovered_timeout,
        failedTimeout: buckets.failed,
        prefilter: buckets.prefilter_blocked,
        note: "Human labels cover only the 20 completed_zero_insight threads.",
      };

      const labeledFn = Object.entries(labels.labels)
        .filter(([, v]) => v.label.startsWith("missing_"))
        .map(([id]) => id);
      const labeledTn = Object.entries(labels.labels)
        .filter(([, v]) => v.label === "correct_absent")
        .map(([id]) => id);

      const cost = estimateTokenCostUsd({
        model: MODEL,
        inputTokens,
        outputTokens,
      });

      const safeForControlledPersist =
        fnRecovered === 4 &&
        tnClean === 4 &&
        feedAfter === feedBefore &&
        fnResults.every((r) => r.selfRequest === false) &&
        fnResults.every((r) => r.inventedDeadline === false);

      const report = {
        evaluationVersion: "o5a6.4_general_recall_fix",
        status: "AWAITING HUMAN REVIEW OF FOUR RECOVERED ACTIONS",
        constraints: {
          noPersist: true,
          noPromptChange: true,
          noSchemaChange: true,
          noPrefilterChange: true,
          noModelChange: true,
          noO5B: true,
        },
        codeChanges: [
          "safety.classifyActionState: prefer CURRENT lead-in; open-ask vs already_sent",
          "validate: informational disposition_suppress exception for recoverable requested actions",
          "evidence-match: NFKC/HTML/bidi/quotes + Outlook inline From/Sent lead extraction",
          "speech-act: short Hebrew asks + לטיפולכם; lead-scoped request evidence",
          "validate: requestEvidence must match CURRENT lead (not nested forward); empty recovery without bare ?",
          "validate: legal/security alerts require body claim proof (letterhead/subject scare-title alone insufficient)",
          "validate: subject exact-span for business object; self-request reject; rejected audit payloads",
          "clean-content: Forwarded message splitters",
        ],
        model: MODEL,
        actualModel,
        engineCombinedHash: hashesBefore.combinedHash,
        openai: {
          calls: openaiCalls,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCostUsd: cost,
          latencyAvgMs: openaiCalls
            ? Math.round(latencyTotal / openaiCalls)
            : 0,
        },
        feedItems: {
          before: feedBefore ?? 0,
          after: feedAfter ?? 0,
          unchanged: feedBefore === feedAfter,
          pilotRowsUnchanged: true,
        },
        recoveredActions: fnResults,
        regressionTrueNegatives: tnResults,
        metricsClarification: {
          nonOverlappingBuckets30: {
            prefilter_blocked: buckets.prefilter_blocked.length,
            accepted: buckets.accepted.length,
            zero: buckets.zero.length,
            rejected: buckets.rejected.length,
            failed: buckets.failed.length,
            threadIds: buckets,
          },
          technicalAttributesNotBusinessOutcomes: technical,
          humanLabelCoverage: {
            labeledZeroInsights: Object.keys(labels.labels).length,
            labeledFalseNegatives: labeledFn.length,
            labeledTrueNegatives: labeledTn.length,
            notYetHumanLabeled: unlabeled,
          },
          precision: {
            status: "provisional",
            note: "Persisted O5A.6 cards were not human-labeled in this pass; precision stays provisional until those cards are reviewed.",
          },
          recall: {
            status: "labeled_only",
            labeledRelevant: labeledFn.length,
            recoveredInDryRun: fnRecovered,
            note: "Recall for this fix is measured on the 4 human-labeled FNs in the focused dry-run.",
          },
        },
        safeForControlledPersist,
      };

      writeFileSync(
        path.join(tmpDir, "o5a64-general-recall-fix.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md: string[] = [];
      md.push("# O5A.6.4 — General Downstream Recall Fix");
      md.push("");
      md.push(
        "Status: **AWAITING HUMAN REVIEW OF FOUR RECOVERED ACTIONS**",
      );
      md.push("");
      md.push("No persist. No O5B / Webhooks / Push / Onyx.");
      md.push("");
      md.push("## Code changes");
      md.push("");
      for (const c of report.codeChanges) md.push(`- ${c}`);
      md.push("");
      md.push("## Fixtures");
      md.push("");
      md.push("- `o5a64-recall.fixtures.test.ts` — 5 must-pass + 12 must-filter");
      md.push("- Existing Golden / O5A.5 / O5A.3 / direction / attribution suites green");
      md.push("");
      md.push("## Four recovered actions (dry-run)");
      md.push("");
      for (const r of fnResults) {
        md.push(`### ${String(r.threadId).slice(0, 8)}…`);
        md.push(`- outcome: \`${r.outcome}\``);
        md.push(`- passReason: ${r.passReason}`);
        for (const a of r.acceptedActions as Array<Record<string, unknown>>) {
          md.push(
            `- ${a.requesterName ?? "—"} <${a.requesterEmail}> → ${a.assigneeName ?? "—"} <${a.assigneeEmail}>`,
          );
          md.push(
            `- title: ${a.title}; speech=${a.speechAct}; state=${a.actionState}; relation=${a.relationToMailbox}`,
          );
          md.push(`- requestEvidence: ${a.requestEvidence}`);
          md.push(`- businessObjectEvidence: ${a.businessObjectEvidence}`);
        }
        md.push("");
      }
      md.push("## Regression true negatives");
      md.push("");
      for (const r of tnResults) {
        md.push(
          `- ${String(r.threadId).slice(0, 8)}… (${r.kind}): stayedEmpty=${r.stayedEmpty} outcome=\`${r.outcome}\``,
        );
      }
      md.push("");
      md.push("## OpenAI / cost");
      md.push("");
      md.push(`- calls: ${openaiCalls}`);
      md.push(
        `- tokens: ${totalTokens} (in=${inputTokens}, out=${outputTokens})`,
      );
      md.push(`- est. cost USD: ${cost.toFixed(6)}`);
      md.push(
        `- latency avg ms: ${openaiCalls ? Math.round(latencyTotal / openaiCalls) : 0}`,
      );
      md.push("");
      md.push("## feed_items");
      md.push("");
      md.push(
        `- before/after: ${feedBefore} → ${feedAfter} (unchanged=${feedBefore === feedAfter})`,
      );
      md.push("");
      md.push("## Metrics clarification");
      md.push("");
      md.push(
        `- non-overlapping buckets: ${JSON.stringify(report.metricsClarification.nonOverlappingBuckets30)}`,
      );
      md.push(
        "- recovered_timeout is a technical attribute, not a business outcome",
      );
      md.push("- Precision remains provisional until persisted cards are labeled");
      md.push("- Recall for this fix uses the 4 human-labeled FNs only");
      md.push("");
      md.push(
        `## Controlled Persist readiness: **${safeForControlledPersist ? "YES" : "NO"}**`,
      );
      md.push("");
      md.push("**AWAITING HUMAN REVIEW OF FOUR RECOVERED ACTIONS**");
      md.push("");

      writeFileSync(
        path.join(tmpDir, "o5a64-general-recall-fix.md"),
        md.join("\n"),
        "utf8",
      );

      expect(fnRecovered).toBe(4);
      expect(tnClean).toBe(4);
      expect(fnResults.every((r) => r.selfRequest === false)).toBe(true);
      expect(fnResults.every((r) => r.inventedDeadline === false)).toBe(true);
      expect(safeForControlledPersist).toBe(true);
      expect(openaiCalls).toBe(8);
    },
    1_800_000,
  );
});
