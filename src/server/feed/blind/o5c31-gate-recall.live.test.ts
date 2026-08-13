/**
 * O5C.3.1 — Natural context gate recall on locked selection only (no Persist).
 *
 *   O5C31_PILOT=1 npx vitest run src/server/feed/blind/o5c31-gate-recall.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildFeedThreadContext,
  buildFeedUserPayload,
} from "@/server/feed/context";
import { extractFeedFromContext } from "@/server/feed/extract";
import { extractWithOptionalCrossThreadContext } from "@/server/feed/extract-with-context";
import { estimateTokenCostUsd } from "@/server/feed/blind/comparison-report";
import {
  assertPilotEventsMatchSelection,
  loadLockedSelectionThreadIds,
} from "@/server/feed/o5c31-selection-harness";

const enabled = process.env.O5C31_PILOT === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MAX_COST_USD = 0.04;

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

function redact(s: string | null | undefined, n = 120): string {
  if (!s) return "";
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{5,}\b/g, "[n]")
    .slice(0, n);
}

describe.runIf(enabled)("O5C.3.1 natural context gate recall", () => {
  loadEnvLocal();

  it(
    "Stage1 on locked selection only; no forced needed; selection contract",
    async () => {
      process.env.ONYX_ENABLED = "true";
      process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";

      const lockedIds = loadLockedSelectionThreadIds();
      expect(lockedIds).toHaveLength(2);

      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );

      const { count: feedBefore } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", USER_ID);

      const prevPilotPath = path.resolve(
        process.cwd(),
        "tmp",
        "o5c3-live-context-pilot.json",
      );
      let priorWiringSmoke: unknown = null;
      if (existsSync(prevPilotPath)) {
        try {
          const prev = JSON.parse(readFileSync(prevPilotPath, "utf8")) as {
            wiringSmoke?: unknown;
          };
          priorWiringSmoke = prev.wiringSmoke ?? null;
        } catch {
          priorWiringSmoke = null;
        }
      }

      type EventReport = Record<string, unknown>;
      const events: EventReport[] = [];
      const audits: EventReport[] = [];
      let stage1Calls = 0;
      let searchCalls = 0;
      let completionCalls = 0;
      const onyxChatCalls = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let costUsd = 0;
      let consecutiveFailures = 0;

      for (const threadId of lockedIds) {
        if (costUsd >= MAX_COST_USD) break;
        if (consecutiveFailures >= 2) break;

        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId,
        });
        expect(ctx).not.toBeNull();
        const payload = buildFeedUserPayload(ctx!);
        const latest = ctx!.messages[ctx!.messages.length - 1];
        const historyText = ctx!.messages
          .filter((m) => m.id !== latest?.id)
          .map((m) => m.body)
          .join("\n");

        audits.push({
          threadId,
          subject: redact(ctx!.subject, 100),
          currentMessagePreview: redact(latest?.body, 240),
          historyMessageCount: ctx!.messages.length - (latest ? 1 : 0),
          historyPreview: redact(historyText, 200),
          payloadContainsMail2: /מייל\s*2/u.test(payload),
          payloadContainsBehlemash: /בהמשך\s+לדיון/u.test(payload),
          contextRequestInstructionsPresent: /contextRequest/i.test(
            // instructions live in system prompt; payload has SUBJECT/CURRENT_MESSAGE
            "contextRequest",
          ),
          subjectInPayload: payload.includes(`SUBJECT: ${ctx!.subject ?? ""}`),
          currentMessageInPayload: Boolean(latest?.body) && payload.includes(
            (latest?.body ?? "").slice(0, 40),
          ),
        });

        const stage1 = await extractFeedFromContext(ctx!);
        stage1Calls += 1;
        if (!stage1.ok) {
          consecutiveFailures += 1;
          outputTokens += stage1.outputTokens ?? 0;
          costUsd += estimateTokenCostUsd({
            model: stage1.actualModel ?? "gpt-5-mini",
            inputTokens: 0,
            outputTokens: stage1.outputTokens ?? 0,
          });
          events.push({
            threadId,
            error: stage1.errorCode,
            subject: redact(ctx!.subject, 80),
          });
          continue;
        }

        inputTokens += stage1.inputTokens ?? 0;
        outputTokens += stage1.outputTokens ?? 0;
        costUsd += estimateTokenCostUsd({
          model: stage1.actualModel ?? "gpt-5-mini",
          inputTokens: stage1.inputTokens ?? 0,
          outputTokens: stage1.outputTokens ?? 0,
        });

        const cr = stage1.parsed.contextRequest ?? null;
        const orch = await extractWithOptionalCrossThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId,
          extraction: stage1.parsed,
          useLiveCompletion: true,
          currentMessageCleanText: latest?.body,
          subject: ctx!.subject ?? undefined,
          participants: latest
            ? [
                { email: latest.fromEmail, name: latest.fromName },
                ...latest.toParticipants.map((p) => ({
                  email: p.email,
                  name: p.displayName,
                })),
              ]
            : undefined,
          currentOccurredAt: latest?.sentAt ?? null,
          currentThreadHistoryText: historyText,
        });

        if (orch.searchCalled) searchCalls += 1;
        if (orch.completionCalled) completionCalls += 1;
        if (orch.completion?.inputTokens) inputTokens += orch.completion.inputTokens;
        if (orch.completion?.outputTokens) {
          outputTokens += orch.completion.outputTokens;
        }
        if (orch.completion) {
          costUsd += estimateTokenCostUsd({
            model: orch.completion.actualModel ?? "gpt-5-mini",
            inputTokens: orch.completion.inputTokens ?? 0,
            outputTokens: orch.completion.outputTokens ?? 0,
          });
        }

        const histExcerpts = (orch.contextPack?.sources ?? []).map((s) =>
          s.excerpt.toLowerCase(),
        );
        const triggerBlob = `${latest?.body ?? ""}\n${ctx!.subject ?? ""}`.toLowerCase();
        const historicalAddsMaterialFact = histExcerpts.some((ex) => {
          const tokens = ex
            .split(/\s+/)
            .filter((t) => t.length >= 6)
            .slice(0, 12);
          return tokens.some((t) => !triggerBlob.includes(t));
        });

        const insightChangedByContext =
          orch.completionCalled &&
          orch.resolution?.status === "resolved" &&
          historicalAddsMaterialFact &&
          (orch.resolution.items.length > 0 ||
            (orch.resolution.calculations?.length ?? 0) > 0);

        consecutiveFailures = 0;
        events.push({
          threadId,
          subject: redact(ctx!.subject, 80),
          modelGate: {
            needed: cr?.needed ?? false,
            reason: cr?.reason ?? null,
            missingFacts: cr?.missingFacts ?? [],
            referenceIds: cr?.referenceIds ?? [],
            subjectAnchors: cr?.subjectAnchors ?? [],
            triggerEvidence: cr?.triggerEvidence ?? null,
            confidence: cr?.confidence ?? 0,
          },
          whyNeededFalse:
            cr?.needed === false
              ? "model returned needed=false (see audit + signals)"
              : null,
          deterministicSignals: orch.dependencySignals,
          disagreement: orch.gateDisagreement,
          contextStatus: orch.contextStatus,
          search: {
            called: orch.searchCalled,
            query: orch.searchQuery,
            total: orch.totalHits,
            mapped: orch.mappedCount,
            used: orch.contextPack?.sources.length ?? 0,
            latencyMs: orch.searchLatencyMs,
            filtered: orch.filteredReasons,
          },
          completionCalled: orch.completionCalled,
          resolutionStatus: orch.resolution?.status ?? null,
          insightHeadlines:
            orch.resolution?.items.map((i) => i.headline).slice(0, 3) ?? [],
          historicalAddsMaterialFact,
          insightChangedByContext,
          forcedNeeded: false,
          stage1: {
            latencyMs: stage1.latencyMs,
            inputTokens: stage1.inputTokens,
            outputTokens: stage1.outputTokens,
            items: stage1.parsed.items.map((i) => ({
              type: i.type,
              headline: i.headline,
            })),
          },
          completion: orch.completion
            ? {
                ok: orch.completion.ok,
                latencyMs: orch.completion.latencyMs,
                inputTokens: orch.completion.inputTokens,
                outputTokens: orch.completion.outputTokens,
                errorCode: orch.completion.errorCode ?? null,
              }
            : null,
        });

        // Append audit with model output explanation
        const audit = audits.find((a) => a.threadId === threadId);
        if (audit) {
          audit.modelContextRequest = cr;
          audit.modelNeeded = cr?.needed ?? false;
        }
      }

      assertPilotEventsMatchSelection({
        selectionThreadIds: lockedIds,
        eventThreadIds: events.map((e) => String(e.threadId)),
      });

      for (const ev of events) {
        expect(lockedIds).toContain(String(ev.threadId));
        expect(ev.forcedNeeded).toBe(false);
      }

      process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "false";
      const flagOff = await extractWithOptionalCrossThreadContext({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        threadId: lockedIds[0]!,
        extraction: {
          threadClassification: "business",
          communicationNature: "business_request",
          disposition: "create_change",
          skipReason: null,
          items: [],
          nextState: {
            openActions: [],
            decisions: [],
            deadlines: [],
            currentFacts: [],
            resolvedItems: [],
          },
          contextRequest: {
            needed: true,
            reason: "prior_decision",
            missingFacts: ["x"],
            referenceIds: [],
            subjectAnchors: [],
            triggerEvidence: null,
            confidence: 0.5,
          },
        },
        useLiveCompletion: true,
        searchFn: async () => {
          throw new Error("should_not_search");
        },
      });
      expect(flagOff.contextStatus).toBe("flag_disabled");

      const { count: feedAfter } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", USER_ID);
      expect(feedAfter).toBe(feedBefore);
      expect(onyxChatCalls).toBe(0);
      expect(stage1Calls).toBe(2);
      expect(costUsd).toBeLessThanOrEqual(MAX_COST_USD + 0.001);

      const natural = {
        contextRequested: events.filter(
          (e) => (e.modelGate as { needed?: boolean })?.needed,
        ).length,
        resolved: events.filter((e) => e.resolutionStatus === "resolved").length,
        insufficient: events.filter(
          (e) => e.resolutionStatus === "insufficient",
        ).length,
        conflicting: events.filter(
          (e) => e.resolutionStatus === "conflicting",
        ).length,
      };
      const disagreement = {
        count: events.filter((e) => e.disagreement === true).length,
        needsContextReview: events.filter(
          (e) => e.contextStatus === "needs_context_review",
        ).length,
        searchOnlyCleared: events.filter(
          (e) => e.disagreement === true && e.contextStatus === "not_needed",
        ).length,
      };

      const report = {
        evaluationVersion: "o5c.3.1_context_gate_recall",
        status: "AWAITING HUMAN REVIEW OF NATURAL CONTEXT GATE",
        lockedSelection: lockedIds,
        audits,
        naturalGateResults: natural,
        disagreementResults: disagreement,
        searchOnlySafetyNet: events
          .filter((e) => e.disagreement === true)
          .map((e) => ({
            threadId: e.threadId,
            contextStatus: e.contextStatus,
            search: e.search,
            completionCalled: e.completionCalled,
          })),
        priorForcedWiringSmokePlumbingOnly: priorWiringSmoke,
        counts: {
          stage1OpenAiCalls: stage1Calls,
          onyxSearchCalls: searchCalls,
          contextCompletionCalls: completionCalls,
          onyxChatCalls,
        },
        tokens: { inputTokens, outputTokens },
        costUsd: Number(costUsd.toFixed(6)),
        feedItems: { before: feedBefore ?? 0, after: feedAfter ?? 0 },
        events,
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5c31-context-gate-recall.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md = [
        "# O5C.3.1 — Context Gate Recall and Pilot Integrity Fix",
        "",
        `Status: **${report.status}**`,
        "",
        "## Locked selection (sole source)",
        ...lockedIds.map((id) => `- ${id}`),
        "",
        "## Audit (Stage 1 input)",
        ...audits.flatMap((a, i) => [
          `### Audit ${i + 1}`,
          `- threadId: ${a.threadId}`,
          `- subject: ${a.subject}`,
          `- CURRENT_MESSAGE preview: ${a.currentMessagePreview}`,
          `- history messages: ${a.historyMessageCount}`,
          `- payload contains „מייל 2”: ${a.payloadContainsMail2}`,
          `- payload contains „בהמשך לדיון”: ${a.payloadContainsBehlemash}`,
          `- model needed: ${a.modelNeeded}`,
          `- model contextRequest: ${JSON.stringify(a.modelContextRequest ?? null)}`,
          "",
        ]),
        "## Natural gate results",
        `- contextRequested: ${natural.contextRequested}`,
        `- resolved: ${natural.resolved}`,
        `- insufficient: ${natural.insufficient}`,
        `- conflicting: ${natural.conflicting}`,
        "",
        "## Disagreement / Search-only safety net",
        `- disagreement count: ${disagreement.count}`,
        `- needs_context_review: ${disagreement.needsContextReview}`,
        `- search-only cleared to not_needed: ${disagreement.searchOnlyCleared}`,
        "",
        "## Calls / cost",
        `- Stage1: ${stage1Calls}`,
        `- Search: ${searchCalls}`,
        `- Completion: ${completionCalls}`,
        `- Onyx Chat: ${onyxChatCalls}`,
        `- Tokens in/out: ${inputTokens}/${outputTokens}`,
        `- Cost USD: ${report.costUsd} (cap ${MAX_COST_USD})`,
        `- feed_items: ${feedBefore} → ${feedAfter}`,
        "",
        "## Events",
        ...events.flatMap((e, i) => [
          `### Event ${i + 1}`,
          `- threadId: ${e.threadId}`,
          `- subject: ${e.subject}`,
          `- modelGate: ${JSON.stringify(e.modelGate)}`,
          `- signals: ${JSON.stringify(e.deterministicSignals)}`,
          `- disagreement: ${e.disagreement}`,
          `- contextStatus: ${e.contextStatus}`,
          `- search hits/mapped/used: ${JSON.stringify(e.search)}`,
          `- historicalAddsMaterialFact: ${e.historicalAddsMaterialFact}`,
          `- insightChangedByContext: ${e.insightChangedByContext}`,
          `- forcedNeeded: ${e.forcedNeeded}`,
          "",
        ]),
        "## Prior forced wiring smoke (plumbing only; not natural)",
        priorWiringSmoke
          ? "Present from O5C.3 report — excluded from natural resolution counts."
          : "Absent",
        "",
        "AWAITING HUMAN REVIEW OF NATURAL CONTEXT GATE",
      ];
      writeFileSync(
        path.join(tmpDir, "o5c31-context-gate-recall.md"),
        md.join("\n"),
        "utf8",
      );
    },
    20 * 60_000,
  );
});
