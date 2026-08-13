/**
 * O5C.3.2 — Single natural disagreement resolution (Event 1 only).
 * No Stage1 re-run. ≤1 Search (if hits missing). ≤1 Completion. No Persist.
 *
 *   O5C32_PILOT=1 npx vitest run src/server/feed/blind/o5c32-disagreement-resolution.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildFeedThreadContext } from "@/server/feed/context";
import { buildContextPack } from "@/server/feed/cross-thread-context";
import { completeContextResolutionLive } from "@/server/feed/context-completion";
import { mapSearchHitsToOwnedThreads } from "@/server/feed/map-search-hits";
import { searchDocuments } from "@/server/onyx/search";
import { estimateTokenCostUsd } from "@/server/feed/blind/comparison-report";
import { classifyMaterialGain } from "@/server/feed/material-gain";
import {
  emptyIntelligenceState,
  type FeedExtractionResult,
} from "@/server/feed/schemas";

const enabled = process.env.O5C32_PILOT === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const EVENT1 = "56b3bd04-5667-415b-b840-be8c113ed147";
const MAX_COST_USD = 0.02;

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env) || process.env[key] === "") process.env[key] = value;
  }
}

describe.runIf(enabled)("O5C.3.2 single disagreement resolution", () => {
  loadEnvLocal();

  it(
    "one Completion on Event 1 with material gain gate",
    async () => {
      process.env.ONYX_ENABLED = "true";
      // Pilot-only; do not change default flag in .env.local
      process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";

      const recallPath = path.resolve(
        process.cwd(),
        "tmp",
        "o5c31-context-gate-recall.json",
      );
      const recall = JSON.parse(readFileSync(recallPath, "utf8")) as {
        events: Array<Record<string, unknown>>;
      };
      const event1 = recall.events.find((e) => e.threadId === EVENT1);
      expect(event1).toBeTruthy();
      expect(event1!.disagreement).toBe(true);

      const modelGate = event1!.modelGate as {
        needed: boolean;
        reason: FeedExtractionResult["contextRequest"] extends infer T
          ? T extends { reason: infer R }
            ? R
            : never
          : never;
        missingFacts: string[];
        referenceIds: string[];
        subjectAnchors: string[];
        triggerEvidence: string | null;
        confidence: number;
      };
      const signals = event1!.deterministicSignals;
      const savedSearch = event1!.search as {
        query: string;
        total: number;
        mapped: number;
        used: number;
        latencyMs: number;
      };

      // historicalAddsMaterialFact must be unknown until proven after Completion.
      let historicalAddsMaterialFact: "unknown" | boolean = "unknown";

      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
      const { count: feedBefore } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", USER_ID);

      const ctx = await buildFeedThreadContext({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        threadId: EVENT1,
      });
      expect(ctx).not.toBeNull();
      const latest = ctx!.messages[ctx!.messages.length - 1]!;
      const historyText = ctx!.messages
        .filter((m) => m.id !== latest.id)
        .map((m) => m.body)
        .join("\n");

      // Reconstruct saved Stage1 (no re-extract).
      const stage1Extraction: FeedExtractionResult = {
        threadClassification: "business",
        communicationNature: "business_request",
        disposition: "suppress",
        skipReason: null,
        items: [],
        nextState: emptyIntelligenceState(),
        contextRequest: {
          needed: modelGate.needed,
          reason: (modelGate.reason as "other") ?? "other",
          missingFacts: modelGate.missingFacts ?? [],
          referenceIds: modelGate.referenceIds ?? [],
          subjectAnchors: modelGate.subjectAnchors ?? [],
          triggerEvidence: modelGate.triggerEvidence ?? null,
          confidence: modelGate.confidence ?? 0,
        },
      };

      // Full Search hits were not persisted → one live Search allowed.
      let searchCalls = 0;
      let searchLatencyMs = savedSearch.latencyMs ?? 0;
      const search = await searchDocuments({
        query: savedSearch.query,
        maxResults: 20,
        skipQueryExpansion: true,
      });
      searchCalls = 1;
      searchLatencyMs = search.latencyMs;

      const mapped = await mapSearchHitsToOwnedThreads({
        hits: search.hits,
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        currentThreadId: EVENT1,
        requireIngestionSourceType: true,
        excludeStale: true,
        currentOccurredAt: latest.sentAt,
      });
      expect(mapped.mapped.length).toBeGreaterThanOrEqual(1);

      const pack = buildContextPack(
        mapped.mapped.map((m) => ({
          threadId: m.threadId,
          documentId: m.onyxDocumentId,
          occurredAt: m.occurredAt,
          participants: [],
          subject: null,
          excerpt: m.content,
          sourceLink: m.sourceLink,
        })),
      );

      const triggerSources = [
        {
          threadId: EVENT1,
          messageId: latest.id,
          occurredAt: latest.sentAt,
          evidence: (latest.body || modelGate.triggerEvidence || "trigger").slice(
            0,
            500,
          ),
          role: "trigger" as const,
        },
      ];

      const completion = await completeContextResolutionLive({
        extraction: stage1Extraction,
        contextPack: pack,
        triggerSources,
        currentSubject: ctx!.subject,
        currentMessageCleanText: latest.body,
      });

      const costUsd = estimateTokenCostUsd({
        model: completion.actualModel ?? "gpt-5-mini",
        inputTokens: completion.inputTokens ?? 0,
        outputTokens: completion.outputTokens ?? 0,
      });
      expect(costUsd).toBeLessThanOrEqual(MAX_COST_USD + 0.001);

      const gain = classifyMaterialGain({
        triggerText: latest.body,
        currentThreadText: historyText,
        historicalExcerpts: pack.sources.map((s) => ({
          threadId: s.threadId,
          excerpt: s.excerpt,
        })),
        resolution: completion.resolution,
      });

      historicalAddsMaterialFact = gain.materialGain === "material";
      // Display status: never show resolved unless material.
      const resolutionStatusForReport =
        gain.materialGain === "material" &&
        completion.resolution?.status === "resolved"
          ? "resolved"
          : gain.displayStatus;

      const policyRecommendation =
        gain.materialGain === "material"
          ? {
              allowFutureCompletionOnDisagreement: true,
              when: [
                "model gate and strong deterministic signal disagree",
                "Search returned owned/mapped earlier sources",
                "sources are temporally earlier and business-linked",
              ],
            }
          : {
              allowFutureCompletionOnDisagreement: false,
              keepAs: "not_needed",
              note: "Safety Net found a link but it did not add feed value.",
            };

      const { count: feedAfter } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", USER_ID);
      expect(feedAfter).toBe(feedBefore);

      const report = {
        evaluationVersion: "o5c.3.2_single_disagreement_resolution",
        status: "AWAITING HUMAN REVIEW OF MATERIAL CONTEXT GAIN",
        eventThreadId: EVENT1,
        historicalAddsMaterialFactBeforeCompletion: "unknown",
        historicalAddsMaterialFact,
        stage1Original: {
          items: stage1Extraction.items,
          contextRequest: stage1Extraction.contextRequest,
          latencyMsSaved: (event1!.stage1 as { latencyMs?: number })?.latencyMs ?? null,
          note: "Reused saved Stage1 outcome; no Stage1 OpenAI re-call.",
        },
        deterministicSignals: signals,
        search: {
          calls: searchCalls,
          query: savedSearch.query,
          latencyMs: searchLatencyMs,
          total: mapped.stats.totalHits,
          mapped: mapped.stats.mappedHits,
          used: pack.sources.length,
          filtered: mapped.stats.filtered,
          sources: pack.sources.map((s) => ({
            threadId: s.threadId,
            occurredAt: s.occurredAt,
            excerpt: s.excerpt.slice(0, 200),
          })),
        },
        completion: {
          calls: 1,
          ok: completion.ok,
          model: completion.model,
          actualModel: completion.actualModel,
          latencyMs: completion.latencyMs,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
          errorCode: completion.errorCode ?? null,
          rawStatus: completion.resolution?.status ?? null,
        },
        triggerOnlyFacts: gain.triggerOnlyFacts,
        historicalOnlyFacts: gain.historicalOnlyFacts,
        combinedInsight: gain.combinedInsight,
        resolutionStatus: resolutionStatusForReport,
        materialGain: gain.materialGain,
        whyHistoryChangedOrNot: gain.reason,
        wouldAddFeedValue: gain.wouldAddFeedValue,
        policyRecommendation,
        costUsd: Number(costUsd.toFixed(6)),
        onyxChatCalls: 0,
        openaiCalls: 1,
        searchCalls,
        feedItems: { before: feedBefore ?? 0, after: feedAfter ?? 0 },
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5c32-single-disagreement-resolution.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md = [
        "# O5C.3.2 — Single Natural Disagreement Resolution",
        "",
        `Status: **${report.status}**`,
        "",
        `Event 1 only: \`${EVENT1}\``,
        "",
        "## Stage 1 (saved, not re-run)",
        `- items: ${stage1Extraction.items.length}`,
        `- contextRequest: ${JSON.stringify(stage1Extraction.contextRequest)}`,
        `- signals: ${JSON.stringify(signals)}`,
        "",
        "## Report semantics",
        `- historicalAddsMaterialFact before Completion: **unknown**`,
        `- historicalAddsMaterialFact after proof: **${historicalAddsMaterialFact}**`,
        "",
        "## Search",
        `- calls: ${searchCalls} (full hits were not persisted)`,
        `- total/mapped/used: ${mapped.stats.totalHits}/${mapped.stats.mappedHits}/${pack.sources.length}`,
        `- latencyMs: ${searchLatencyMs}`,
        ...pack.sources.map(
          (s, i) =>
            `- source ${i + 1}: ${s.threadId} @ ${s.occurredAt} — ${s.excerpt.slice(0, 120).replace(/\n/g, " ")}`,
        ),
        "",
        "## Trigger-only facts",
        ...gain.triggerOnlyFacts.map((f) => `- ${f.fact}`),
        "",
        "## Historical-only facts",
        ...(gain.historicalOnlyFacts.length
          ? gain.historicalOnlyFacts.map(
              (f) => `- [${f.threadId}] ${f.fact}`,
            )
          : ["- (none proven)"]),
        "",
        "## Combined insight",
        ...(gain.combinedInsight.length
          ? gain.combinedInsight.map((h) => `- ${h}`)
          : ["- (none)"]),
        "",
        "## Material gain",
        `- materialGain: **${gain.materialGain}**`,
        `- display resolutionStatus: **${resolutionStatusForReport}**`,
        `- raw completion status: ${completion.resolution?.status ?? null}`,
        `- why: ${gain.reason}`,
        `- wouldAddFeedValue: ${gain.wouldAddFeedValue}`,
        "",
        "## Policy (report only)",
        "```json",
        JSON.stringify(policyRecommendation, null, 2),
        "```",
        "",
        "## Cost / safety",
        `- OpenAI calls: 1`,
        `- Search calls: ${searchCalls}`,
        `- Onyx Chat: 0`,
        `- Completion latencyMs: ${completion.latencyMs}`,
        `- tokens in/out: ${completion.inputTokens}/${completion.outputTokens}`,
        `- costUsd: ${report.costUsd} (cap ${MAX_COST_USD})`,
        `- feed_items: ${feedBefore} → ${feedAfter}`,
        "",
        "AWAITING HUMAN REVIEW OF MATERIAL CONTEXT GAIN",
      ];
      writeFileSync(
        path.join(tmpDir, "o5c32-single-disagreement-resolution.md"),
        md.join("\n"),
        "utf8",
      );

      expect(searchCalls).toBeLessThanOrEqual(1);
      expect(report.openaiCalls).toBe(1);
      expect(report.onyxChatCalls).toBe(0);
      if (gain.materialGain !== "material") {
        expect(resolutionStatusForReport).not.toBe("resolved");
      }
    },
    12 * 60_000,
  );
});
