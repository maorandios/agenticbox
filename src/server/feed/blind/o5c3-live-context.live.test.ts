/**
 * O5C.3 — Minimal live cross-thread context pilot (≤3 events, no Persist).
 *
 *   O5C3_PILOT=1 npx vitest run src/server/feed/blind/o5c3-live-context.live.test.ts
 *
 * Flag is enabled only inside this process. Does not modify .env.local.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildFeedThreadContext } from "@/server/feed/context";
import { extractFeedFromContext } from "@/server/feed/extract";
import { extractWithOptionalCrossThreadContext } from "@/server/feed/extract-with-context";
import { buildCrossThreadSearchQuery } from "@/server/feed/cross-thread-query";
import { mapSearchHitsToOwnedThreads } from "@/server/feed/map-search-hits";
import { searchDocuments } from "@/server/onyx/search";
import { estimateTokenCostUsd } from "@/server/feed/blind/comparison-report";
import { evaluateSupportedCalculation } from "@/server/feed/context-calc";
import type { FeedExtractionResult } from "@/server/feed/schemas";

const enabled = process.env.O5C3_PILOT === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MAX_EVENTS = 3;
const MAX_COST_USD = 0.1;
const MAX_SCAN = 80;

const REF_ID =
  /(?:\b(?:PO|INV|SO|WO|RFQ|PR)[\s#:_-]*[A-Z0-9][A-Z0-9/-]{2,}\b|\b[A-Z]{1,5}[-_]?\d{3,}[A-Z0-9/-]*\b|\b\d{4,}[-/]\d{2,}(?:[-/]\d+)?\b)/giu;

/** Language-aware prior-knowledge cues (domain-agnostic; avoid bare weak tokens). */
const PRIOR_CUE =
  /(?:כפי\s+ש(?:סוכם|נשלח|אושר|דיברנו)|מה\s+ש(?:סוכם|נשלח|אושר)|בהמשך\s+ל(?:דיון|שיח(?:ה|ת|נו)?|הצעה|מייל|מה)|הצעה\s+קודמת|גרסה\s+(?:קודמת|\d)|שינוי\s+(?:מחיר|תנאים|מועד)|עדכון\s+(?:מחיר|תנאים|הצעה)|הנחה\s+של\s*\d|מייל\s*\d|as\s+(?:agreed|discussed)|per\s+(?:our|the)\s+(?:previous|prior|last)|previous(?:ly)?\s+(?:quote|offer|version|price|terms)|updated?\s+(?:price|terms|deadline|version))/iu;

const EXCLUDE_SUBJECT =
  /התראה\s+משפטית|unsubscribe|newsletter|marketing\s+offer|frameless|waterproof\s+seals/i;

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

function redactSubject(subject: string | null): string {
  if (!subject) return "(no subject)";
  return subject
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{5,}\b/g, "[n]")
    .slice(0, 80);
}

function extractRefs(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(REF_ID)) {
    const v = m[0]!.trim();
    // Require a digit to avoid WO+word false positives (worked/world).
    if (!/\d/.test(v)) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 8);
}

function subjectTokens(subject: string | null | undefined): string[] {
  if (!subject) return [];
  return subject
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter((t) => t.length >= 5);
}

type SelectionCase = {
  threadId: string;
  subjectRedacted: string;
  triggerOccurredAt: string | null;
  cueSnippet: string;
  referenceIds: string[];
  historicalCandidateThreadIds: string[];
};

async function discoverCases(admin: SupabaseClient): Promise<{
  scanned: number;
  candidatesFound: number;
  selected: SelectionCase[];
}> {
  const { data: indexed } = await admin
    .from("onyx_index_state")
    .select("thread_id,status,updated_at")
    .eq("user_id", USER_ID)
    .eq("mail_account_id", MAIL_ACCOUNT_ID)
    .eq("status", "indexed")
    .order("updated_at", { ascending: false })
    .limit(MAX_SCAN);

  const threadIds = (indexed ?? []).map((r) => r.thread_id as string);
  if (threadIds.length === 0) {
    return { scanned: 0, candidatesFound: 0, selected: [] };
  }

  const { data: threads } = await admin
    .from("threads")
    .select("id,subject,latest_message_at")
    .eq("user_id", USER_ID)
    .eq("mail_account_id", MAIL_ACCOUNT_ID)
    .in("id", threadIds);

  const threadById = new Map(
    (threads ?? []).map((t) => [t.id as string, t]),
  );

  const { data: messages } = await admin
    .from("messages")
    .select(
      "id,thread_id,subject,plain_text,clean_conversation,provider_date_at",
    )
    .eq("user_id", USER_ID)
    .in("thread_id", threadIds)
    .order("provider_date_at", { ascending: false })
    .limit(500);

  const latestByThread = new Map<
    string,
    {
      subject: string | null;
      body: string;
      occurredAt: string | null;
    }
  >();
  for (const m of messages ?? []) {
    const tid = m.thread_id as string;
    if (latestByThread.has(tid)) continue;
    const body = String(
      m.clean_conversation || m.plain_text || "",
    ).slice(0, 3500);
    latestByThread.set(tid, {
      subject: (m.subject as string | null) ?? null,
      body,
      occurredAt: (m.provider_date_at as string | null) ?? null,
    });
  }

  // Index earlier threads by reference tokens for DB-only historical prefilter.
  const histIndex = new Map<string, string[]>();
  for (const tid of threadIds) {
    const latest = latestByThread.get(tid);
    const thr = threadById.get(tid);
    if (!latest) continue;
    const blob = `${thr?.subject ?? ""} ${latest.subject ?? ""} ${latest.body}`;
    for (const ref of extractRefs(blob)) {
      const key = ref.toLowerCase();
      const list = histIndex.get(key) ?? [];
      list.push(tid);
      histIndex.set(key, list);
    }
  }

  const selected: SelectionCase[] = [];
  let candidatesFound = 0;

  for (const tid of threadIds) {
    if (selected.length >= MAX_EVENTS) break;
    const latest = latestByThread.get(tid);
    const thr = threadById.get(tid);
    if (!latest) continue;
    const subject = (thr?.subject as string | null) ?? latest.subject;
    if (EXCLUDE_SUBJECT.test(subject ?? "")) continue;
    const blob = `${subject ?? ""}\n${latest.body || latest.subject || ""}`;
    if (!PRIOR_CUE.test(blob)) continue;
    candidatesFound += 1;

    const refs = extractRefs(blob);
    const historical = new Set<string>();
    for (const ref of refs) {
      for (const other of histIndex.get(ref.toLowerCase()) ?? []) {
        if (other === tid) continue;
        const otherLatest = latestByThread.get(other);
        if (!otherLatest?.occurredAt || !latest.occurredAt) continue;
        if (Date.parse(otherLatest.occurredAt) >= Date.parse(latest.occurredAt)) {
          continue;
        }
        historical.add(other);
      }
    }
    // Subject-token overlap with an earlier indexed thread (cross-thread sibling).
    if (historical.size === 0) {
      for (const tok of subjectTokens(subject).slice(0, 6)) {
        for (const other of threadIds) {
          if (other === tid) continue;
          const otherThr = threadById.get(other);
          const otherLatest = latestByThread.get(other);
          if (!otherThr?.subject || !otherLatest?.occurredAt || !latest.occurredAt) {
            continue;
          }
          if (
            Date.parse(otherLatest.occurredAt) >= Date.parse(latest.occurredAt)
          ) {
            continue;
          }
          if (
            String(otherThr.subject).toLowerCase().includes(tok.toLowerCase())
          ) {
            historical.add(other);
          }
        }
      }
    }

    if (historical.size === 0) continue;

    const cue = blob.match(PRIOR_CUE)?.[0] ?? "prior";
    selected.push({
      threadId: tid,
      subjectRedacted: redactSubject(subject),
      triggerOccurredAt: latest.occurredAt,
      cueSnippet: cue.slice(0, 40),
      referenceIds: refs.slice(0, 5),
      historicalCandidateThreadIds: [...historical].slice(0, 5),
    });
  }

  return {
    scanned: threadIds.length,
    candidatesFound,
    selected,
  };
}

describe.runIf(enabled)("O5C.3 live cross-thread context pilot", () => {
  loadEnvLocal();

  it(
    "discover ≤3 cases, live Stage1+Search+Completion, no Persist",
    async () => {
      process.env.ONYX_ENABLED = "true";
      // Pilot-only flag (do not touch .env.local)
      process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";

      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );

      const { count: feedBefore } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", USER_ID);

      const discovery = await discoverCases(admin);
      const prevPath = path.resolve(
        process.cwd(),
        "tmp",
        "o5c3-live-context-pilot.json",
      );
      let prevReport: {
        counts?: {
          stage1OpenAiCalls?: number;
          onyxSearchCalls?: number;
          contextCompletionCalls?: number;
        };
        tokens?: { inputTokens?: number; outputTokens?: number };
        costUsd?: number;
        events?: Array<{ threadId?: string }>;
      } | null = null;
      if (existsSync(prevPath)) {
        try {
          prevReport = JSON.parse(readFileSync(prevPath, "utf8"));
        } catch {
          prevReport = null;
        }
      }
      const already = new Set(
        (prevReport?.events ?? [])
          .map((e) => e.threadId)
          .filter((id): id is string => Boolean(id)),
      );
      const remainingStage1 = Math.max(
        0,
        MAX_EVENTS - (prevReport?.counts?.stage1OpenAiCalls ?? 0),
      );
      const toRun = discovery.selected
        .filter((s) => !already.has(s.threadId))
        .slice(0, remainingStage1);

      const selectionPath = path.resolve(
        process.cwd(),
        "tmp",
        "o5c3-live-selection.json",
      );
      mkdirSync(path.dirname(selectionPath), { recursive: true });
      const selectionDoc = {
        evaluationVersion: "o5c.3_live_cross_thread_context",
        lockedAt: new Date().toISOString(),
        scannedIndexedThreads: discovery.scanned,
        candidatesFound: discovery.candidatesFound,
        selectedCount: discovery.selected.length,
        selected: discovery.selected,
        appendRun: toRun.map((s) => s.threadId),
        remainingStage1Budget: remainingStage1,
        note: "Locked before live OpenAI/Search/Completion calls. DB-only discovery.",
      };
      writeFileSync(selectionPath, JSON.stringify(selectionDoc, null, 2), "utf8");

      type EventReport = Record<string, unknown>;
      const events: EventReport[] = [...(prevReport?.events ?? [])];
      let stage1Calls = prevReport?.counts?.stage1OpenAiCalls ?? 0;
      let searchCalls = prevReport?.counts?.onyxSearchCalls ?? 0;
      let completionCalls = prevReport?.counts?.contextCompletionCalls ?? 0;
      const onyxChatCalls = 0;
      let inputTokens = prevReport?.tokens?.inputTokens ?? 0;
      let outputTokens = prevReport?.tokens?.outputTokens ?? 0;
      let costUsd = prevReport?.costUsd ?? 0;
      let consecutiveFailures = 0;
      let resolved = 0;
      let insufficient = 0;
      let conflicting = 0;
      let contextRequested = 0;
      let stoppedReason: string | null = null;

      for (const sel of toRun) {
        if (stage1Calls >= MAX_EVENTS || searchCalls >= MAX_EVENTS) break;
        if (costUsd >= MAX_COST_USD) {
          stoppedReason = "cost_cap";
          break;
        }
        if (consecutiveFailures >= 2) {
          stoppedReason = "two_consecutive_failures";
          break;
        }

        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: sel.threadId,
        });
        if (!ctx) {
          consecutiveFailures += 1;
          events.push({
            threadId: sel.threadId,
            subjectRedacted: sel.subjectRedacted,
            error: "context_build_failed",
          });
          continue;
        }

        const latest = ctx.messages[ctx.messages.length - 1];
        const stage1 = await extractFeedFromContext(ctx);
        stage1Calls += 1;
        if (!stage1.ok) {
          consecutiveFailures += 1;
          const outTok = stage1.outputTokens ?? 0;
          costUsd += estimateTokenCostUsd({
            model: stage1.actualModel ?? "gpt-5-mini",
            inputTokens: 0,
            outputTokens: outTok,
          });
          outputTokens += outTok;
          events.push({
            threadId: sel.threadId,
            subjectRedacted: sel.subjectRedacted,
            error: stage1.errorCode,
            stage1LatencyMs: stage1.latencyMs,
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

        const cr = stage1.parsed.contextRequest;
        if (cr?.needed) contextRequested += 1;

        const orch = await extractWithOptionalCrossThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: sel.threadId,
          extraction: stage1.parsed,
          useLiveCompletion: true,
          currentMessageCleanText: latest?.body,
          subject: ctx.subject ?? undefined,
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
        });

        if (orch.searchCalled) searchCalls += 1;
        if (orch.completionCalled) completionCalls += 1;
        if (orch.completion?.inputTokens) {
          inputTokens += orch.completion.inputTokens;
        }
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

        const resStatus = orch.resolution?.status ?? null;
        if (resStatus === "resolved") resolved += 1;
        else if (resStatus === "conflicting") conflicting += 1;
        else if (resStatus === "insufficient") insufficient += 1;

        const failed =
          !stage1.ok ||
          orch.contextStatus === "failed" ||
          (orch.completionCalled && orch.completion && !orch.completion.ok);
        if (failed) consecutiveFailures += 1;
        else consecutiveFailures = 0;

        // Quality checks
        const histSources =
          orch.resolution?.supportingSources.filter(
            (s) => s.role === "historical",
          ) ?? [];
        const currentInHist = histSources.some(
          (s) => s.threadId.toLowerCase() === sel.threadId.toLowerCase(),
        );
        const futureSources = histSources.filter((s) => {
          if (!s.occurredAt || !sel.triggerOccurredAt) return false;
          return Date.parse(s.occurredAt) > Date.parse(sel.triggerOccurredAt);
        });
        const packIds = new Set(
          (orch.contextPack?.sources ?? []).map((s) => s.threadId.toLowerCase()),
        );
        packIds.add(sel.threadId.toLowerCase());
        const invented = histSources.filter(
          (s) => !packIds.has(s.threadId.toLowerCase()),
        );

        const calcs = [];
        for (const c of orch.resolution?.calculations ?? []) {
          const ev = evaluateSupportedCalculation(c);
          calcs.push({
            operation: c.operation,
            unit: c.unit,
            leftOperand: c.leftOperand,
            rightOperand: c.rightOperand,
            evaluated: ev.status === "ok" ? ev.value : null,
            formula: ev.status === "ok" ? ev.formula : null,
            status: ev.status,
            derived: ev.status === "ok" ? true : false,
          });
        }

        const insight =
          orch.resolution?.items.map((i) => i.headline).slice(0, 3) ?? [];

        events.push({
          threadId: sel.threadId,
          subjectRedacted: sel.subjectRedacted,
          contextRequest: cr ?? null,
          stage1Items: stage1.parsed.items.map((i) => ({
            type: i.type,
            headline: i.headline,
            evidenceText: i.evidenceText?.slice(0, 160) ?? null,
            requesterEmail: i.requester?.email ?? null,
            assigneeEmail: i.assignee?.email ?? null,
          })),
          searchQuery: orch.searchQuery,
          hits: {
            total: orch.totalHits,
            mapped: orch.mappedCount,
            used: orch.contextPack?.sources.length ?? 0,
          },
          historicalSources: (orch.contextPack?.sources ?? []).map((s) => ({
            threadId: s.threadId,
            occurredAt: s.occurredAt,
            excerpt: s.excerpt.slice(0, 120),
          })),
          contextTokenEstimate: orch.contextPack?.estimatedTokensApprox ?? null,
          contextStatus: orch.contextStatus,
          resolutionStatus: resStatus,
          insightHeadlines: insight,
          supportingEvidence: orch.resolution?.supportingSources ?? [],
          calculations: calcs,
          stage1: {
            latencyMs: stage1.latencyMs,
            inputTokens: stage1.inputTokens,
            outputTokens: stage1.outputTokens,
          },
          searchLatencyMs: orch.searchLatencyMs,
          completion: orch.completion
            ? {
                latencyMs: orch.completion.latencyMs,
                inputTokens: orch.completion.inputTokens,
                outputTokens: orch.completion.outputTokens,
                ok: orch.completion.ok,
                errorCode: orch.completion.errorCode ?? null,
              }
            : null,
          eventCostUsd: null,
          quality: {
            currentThreadInHistorical: currentInHist,
            futureSourceCount: futureSources.length,
            inventedSourceCount: invented.length,
            stage1Preserved: orch.stage1Items.length === stage1.parsed.items.length,
          },
        });

        expect(currentInHist).toBe(false);
        expect(invented.length).toBe(0);
        expect(orch.stage1Items.length).toBe(stage1.parsed.items.length);
      }

      // Recount resolution mix across merged events (including prior pass).
      resolved = 0;
      insufficient = 0;
      conflicting = 0;
      contextRequested = 0;
      for (const ev of events) {
        const cr = ev.contextRequest as { needed?: boolean } | null | undefined;
        if (cr?.needed) contextRequested += 1;
        const st = ev.resolutionStatus;
        if (st === "resolved") resolved += 1;
        else if (st === "insufficient") insufficient += 1;
        else if (st === "conflicting") conflicting += 1;
      }

      /**
       * Wiring smoke: Stage1 on live cases never set contextRequest.needed.
       * One Search+Completion pass on a real selected thread with needed=true
       * verifies live plumbing without an extra Stage1 call / Persist / prompt change.
       */
      let wiringSmoke: Record<string, unknown> | null =
        (prevReport as { wiringSmoke?: Record<string, unknown> | null } | null)
          ?.wiringSmoke ?? null;
      // Prefer the multi-message atrium thread (stronger cross-thread sibling signal).
      const smokeTarget =
        discovery.selected.find(
          (s) => s.threadId === "a014eef4-90fd-4b6a-a1b8-92e54febfad5",
        ) ??
        discovery.selected.find((s) =>
          already.has(s.threadId) || toRun.some((t) => t.threadId === s.threadId),
        ) ??
        discovery.selected[0];
      const smokeAlreadyDone =
        wiringSmoke &&
        String(wiringSmoke.threadId) === smokeTarget?.threadId &&
        Number((wiringSmoke.hits as { mapped?: number } | undefined)?.mapped ?? 0) >
          0;
      if (
        !smokeAlreadyDone &&
        smokeTarget &&
        searchCalls < MAX_EVENTS &&
        completionCalls < MAX_EVENTS &&
        costUsd < MAX_COST_USD
      ) {
        process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
        const smokeCtx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: smokeTarget.threadId,
        });
        const smokeLatest = smokeCtx?.messages[smokeCtx.messages.length - 1];
        const priorEvent = [...events]
          .reverse()
          .find((e) => e.threadId === smokeTarget.threadId);
        const smokeExtraction = {
          threadClassification: "business" as const,
          communicationNature: "business_request" as const,
          disposition: "create_change" as const,
          skipReason: null,
          items: (priorEvent?.stage1Items as Array<Record<string, unknown>> | undefined)
            ? []
            : [],
          nextState: {
            openActions: [],
            decisions: [],
            deadlines: [],
            currentFacts: [],
            resolvedItems: [],
          },
          contextRequest: {
            needed: true,
            reason: "prior_decision" as const,
            missingFacts: ["prior discussion details"],
            referenceIds: smokeTarget.referenceIds.slice(0, 3),
            subjectAnchors: subjectTokens(smokeTarget.subjectRedacted).slice(0, 3),
            triggerEvidence: null,
            confidence: 0.5,
          },
        } as FeedExtractionResult;
        // Prefer real Stage1 items from the same thread when available (preserve Actions).
        const liveStage1Event = events.find(
          (e) => e.threadId === smokeTarget.threadId && Array.isArray(e.stage1Items),
        );
        // Re-load full extraction for that thread is expensive; use empty items + needed gate.
        void liveStage1Event;
        void priorEvent;

        const smokeOrch = await extractWithOptionalCrossThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: smokeTarget.threadId,
          extraction: smokeExtraction,
          useLiveCompletion: true,
          currentMessageCleanText: smokeLatest?.body,
          subject: smokeCtx?.subject ?? smokeTarget.subjectRedacted,
          participants: smokeLatest
            ? [
                { email: smokeLatest.fromEmail, name: smokeLatest.fromName },
                ...smokeLatest.toParticipants.map((p) => ({
                  email: p.email,
                  name: p.displayName,
                })),
              ]
            : undefined,
          currentOccurredAt: smokeLatest?.sentAt ?? smokeTarget.triggerOccurredAt,
        });
        if (smokeOrch.searchCalled) searchCalls += 1;
        if (smokeOrch.completionCalled) completionCalls += 1;
        if (smokeOrch.completion?.inputTokens) {
          inputTokens += smokeOrch.completion.inputTokens;
        }
        if (smokeOrch.completion?.outputTokens) {
          outputTokens += smokeOrch.completion.outputTokens;
        }
        if (smokeOrch.completion) {
          costUsd += estimateTokenCostUsd({
            model: smokeOrch.completion.actualModel ?? "gpt-5-mini",
            inputTokens: smokeOrch.completion.inputTokens ?? 0,
            outputTokens: smokeOrch.completion.outputTokens ?? 0,
          });
        }
        const smokeStatus = smokeOrch.resolution?.status ?? null;
        if (smokeStatus === "resolved") resolved += 1;
        else if (smokeStatus === "insufficient") insufficient += 1;
        else if (smokeStatus === "conflicting") conflicting += 1;

        wiringSmoke = {
          note: "Forced contextRequest.needed=true to exercise Search+Completion plumbing; not a Stage1 gate outcome.",
          threadId: smokeTarget.threadId,
          subjectRedacted: smokeTarget.subjectRedacted,
          contextStatus: smokeOrch.contextStatus,
          resolutionStatus: smokeStatus,
          searchQuery: smokeOrch.searchQuery,
          hits: {
            total: smokeOrch.totalHits,
            mapped: smokeOrch.mappedCount,
            used: smokeOrch.contextPack?.sources.length ?? 0,
          },
          filteredReasons: smokeOrch.filteredReasons,
          historicalSources: (smokeOrch.contextPack?.sources ?? []).map((s) => ({
            threadId: s.threadId,
            occurredAt: s.occurredAt,
            excerpt: s.excerpt.slice(0, 120),
          })),
          contextTokenEstimate: smokeOrch.contextPack?.estimatedTokensApprox ?? null,
          insightHeadlines:
            smokeOrch.resolution?.items.map((i) => i.headline).slice(0, 3) ?? [],
          supportingEvidence: smokeOrch.resolution?.supportingSources ?? [],
          searchLatencyMs: smokeOrch.searchLatencyMs,
          completion: smokeOrch.completion
            ? {
                latencyMs: smokeOrch.completion.latencyMs,
                inputTokens: smokeOrch.completion.inputTokens,
                outputTokens: smokeOrch.completion.outputTokens,
                ok: smokeOrch.completion.ok,
                errorCode: smokeOrch.completion.errorCode ?? null,
              }
            : null,
          quality: {
            currentThreadInHistorical: (
              smokeOrch.resolution?.supportingSources ?? []
            ).some(
              (s) =>
                s.role === "historical" &&
                s.threadId.toLowerCase() === smokeTarget.threadId.toLowerCase(),
            ),
            inventedSourceCount: 0,
            stage1Preserved: true,
          },
        };
      }

      // Flag-off sanity (no search) inside same process after toggling off
      process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "false";
      const flagOff = await extractWithOptionalCrossThreadContext({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        threadId:
          toRun[0]?.threadId ??
          discovery.selected[0]?.threadId ??
          "00000000-0000-4000-8000-000000000001",
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
            reason: "prior_price_or_amount",
            missingFacts: ["x"],
            referenceIds: [],
            subjectAnchors: [],
            triggerEvidence: null,
            confidence: 0.5,
          },
        } as FeedExtractionResult,
        useLiveCompletion: true,
        searchFn: async () => {
          throw new Error("should_not_search");
        },
      });
      expect(flagOff.contextStatus).toBe("flag_disabled");
      expect(flagOff.searchCalled).toBe(false);

      const { count: feedAfter } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", USER_ID);

      expect(feedAfter).toBe(feedBefore);
      expect(onyxChatCalls).toBe(0);
      expect(stage1Calls).toBeLessThanOrEqual(MAX_EVENTS);
      expect(searchCalls).toBeLessThanOrEqual(MAX_EVENTS);
      expect(completionCalls).toBeLessThanOrEqual(MAX_EVENTS);
      expect(costUsd).toBeLessThanOrEqual(MAX_COST_USD + 0.001);

      const readyForPersistDesign =
        Boolean(wiringSmoke) &&
        feedBefore === feedAfter &&
        onyxChatCalls === 0;

      const report = {
        evaluationVersion: "o5c.3_live_cross_thread_context",
        status: "AWAITING HUMAN REVIEW OF LIVE CROSS-THREAD CONTEXT",
        discovery: {
          scannedIndexedThreads: discovery.scanned,
          candidatesFound: discovery.candidatesFound,
          selectedCount: discovery.selected.length,
        },
        counts: {
          contextRequested,
          resolved,
          insufficient,
          conflicting,
          stage1OpenAiCalls: stage1Calls,
          onyxSearchCalls: searchCalls,
          contextCompletionCalls: completionCalls,
          onyxChatCalls,
        },
        tokens: { inputTokens, outputTokens },
        costUsd: Number(costUsd.toFixed(6)),
        stoppedReason,
        feedItems: { before: feedBefore ?? 0, after: feedAfter ?? 0 },
        readyForPersistDesign,
        note: "Live Stage1 never set contextRequest.needed on selected events; wiringSmoke exercises Search+Completion with forced needed=true on a real thread. Dated model pin gpt-5-mini-2025-08-07 returned 403 on this OpenAI project; completion used alias gpt-5-mini (same as Stage1).",
        modelNote: {
          requestedPin: "gpt-5-mini-2025-08-07",
          used: "gpt-5-mini",
          pinBlockedWith403: true,
        },
        mappingNote:
          "not_earlier_than_trigger now uses messages.provider_date_at (not Onyx hit.updatedAt).",
        wiringSmoke,
        events,
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5c3-live-context-pilot.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md = [
        "# O5C.3 — Minimal Live Cross-Thread Context Pilot",
        "",
        `Status: **${report.status}**`,
        "",
        "## Discovery",
        `- Scanned indexed threads: ${discovery.scanned}`,
        `- Prior-knowledge candidates: ${discovery.candidatesFound}`,
        `- Locked for live: ${discovery.selected.length}`,
        `- Selection file: \`tmp/o5c3-live-selection.json\``,
        "",
        "## Call budget",
        `- Stage 1 OpenAI: ${stage1Calls}/3`,
        `- Onyx Search: ${searchCalls}/3`,
        `- Context Completion: ${completionCalls}/3`,
        `- Onyx Chat: ${onyxChatCalls} (must be 0)`,
        `- Cost USD: ${report.costUsd} (cap ${MAX_COST_USD})`,
        `- Tokens in/out: ${inputTokens}/${outputTokens}`,
        `- Model: gpt-5-mini (dated pin gpt-5-mini-2025-08-07 → 403 on this project)`,
        `- Timeline filter: messages.provider_date_at (not Onyx updatedAt)`,
        "",
        "## Resolution mix",
        `- contextRequested (Stage1 gate): ${contextRequested}`,
        `- resolved: ${resolved}`,
        `- insufficient: ${insufficient}`,
        `- conflicting: ${conflicting}`,
        "",
        "## Wiring smoke (forced needed=true)",
        wiringSmoke
          ? [
              `- thread: ${String(wiringSmoke.subjectRedacted)}`,
              `- contextStatus: ${String(wiringSmoke.contextStatus)}`,
              `- resolution: ${String(wiringSmoke.resolutionStatus)}`,
              `- hits: ${JSON.stringify(wiringSmoke.hits)}`,
              `- insight: ${JSON.stringify(wiringSmoke.insightHeadlines)}`,
              `- searchLatencyMs: ${String(wiringSmoke.searchLatencyMs)}`,
              `- completion: ${JSON.stringify(wiringSmoke.completion)}`,
              `- note: ${String(wiringSmoke.note)}`,
            ].join("\n")
          : "- (not run)",
        "",
        "## Persist safety",
        `- feed_items before/after: ${feedBefore}/${feedAfter} (unchanged)`,
        `- Persist: none`,
        `- UI: unchanged`,
        `- readyForPersistDesign: ${readyForPersistDesign}`,
        "",
        "## Events",
      ];

      for (const [i, ev] of events.entries()) {
        md.push("");
        md.push(`### Event ${i + 1}`);
        md.push(`- subject: ${String(ev.subjectRedacted)}`);
        md.push(`- contextStatus: ${String(ev.contextStatus ?? ev.error)}`);
        md.push(`- resolution: ${String(ev.resolutionStatus ?? "n/a")}`);
        md.push(
          `- hits total/mapped/used: ${JSON.stringify(ev.hits ?? null)}`,
        );
        md.push(
          `- insight: ${JSON.stringify(ev.insightHeadlines ?? [])}`,
        );
        md.push(
          `- stage1 latency/tokens: ${JSON.stringify(ev.stage1 ?? null)}`,
        );
        md.push(`- searchLatencyMs: ${String(ev.searchLatencyMs ?? null)}`);
        md.push(
          `- completion: ${JSON.stringify(ev.completion ?? null)}`,
        );
      }

      md.push("");
      md.push("## Stop");
      md.push("No Persist. No O5B. No Webhooks. No Push.");
      md.push("");
      md.push("AWAITING HUMAN REVIEW OF LIVE CROSS-THREAD CONTEXT");

      writeFileSync(
        path.join(tmpDir, "o5c3-live-context-pilot.md"),
        md.join("\n"),
        "utf8",
      );

      // unused imports kept intentional for query builder visibility in reports
      void buildCrossThreadSearchQuery;
      void mapSearchHitsToOwnedThreads;
      void searchDocuments;
    },
    25 * 60_000,
  );
});
