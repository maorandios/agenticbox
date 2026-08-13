/**
 * O5A.6 — Real Inbox Review Pilot (30 threads, controlled persist).
 *   O5A6_PILOT=1 npx vitest run src/server/feed/blind/o5a6-real-inbox.live.test.ts
 *
 * No O5B / Webhooks / Push / Onyx. No engine changes during run.
 * Selection locked to tmp/o5a6-selection.json before any OpenAI calls.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isFeedCircuitOpen, resetFeedCircuit } from "@/server/feed/circuit";
import { cleanFeedMessageBody } from "@/server/feed/clean-content";
import { buildFeedThreadContext, computeDedupeKey } from "@/server/feed/context";
import {
  classifyFeedThreadEligibility,
  type EligibilityMessageInput,
  type FeedThreadEligibility,
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
import { O5A4_EXCLUDED_THREAD_IDS } from "./constants";
import { estimateTokenCostUsd } from "./comparison-report";
import { freezeExtractionEngineHashes, maskUuid } from "./engine-hash";

const enabled = process.env.O5A6_PILOT === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MODEL = "gpt-5-mini";
const EXTRACTION_VERSION = "o5a.6_real_inbox_review";
const SELECTION_SEED = "o5a6-real-inbox-2026-08-13-v1";
const HARD_CAP = 30;
const SCAN_CAP = 400;
const CANONICAL = "מאור | טריגו מידול והנדסה";
const MAILBOX = "office@trigo-models.com";

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

function selectionHash(seed: string, threadId: string): string {
  return createHash("sha256")
    .update(`${seed}:${threadId}`, "utf8")
    .digest("hex");
}

function loadPriorPilotThreadIds(): Set<string> {
  const ids = new Set<string>(O5A4_EXCLUDED_THREAD_IDS);
  const files = [
    "tmp/o5a4-blind-selection.json",
    "tmp/o5a51-implicit-request-evaluation.json",
    "tmp/o5a52-final-human-review.json",
    "tmp/o5a52-controlled-persist-report.json",
    "tmp/o5a5-feed-safety-evaluation.json",
  ];
  for (const rel of files) {
    const p = path.resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    // Collect UUIDs that look like thread ids from routes / selected arrays
    for (const m of raw.matchAll(
      /threadId(?:Masked)?["\s:=]*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    )) {
      ids.add(m[1]!.toLowerCase());
    }
    for (const m of raw.matchAll(
      /\/inbox\?threadId=([0-9a-f-]{36})/gi,
    )) {
      ids.add(m[1]!.toLowerCase());
    }
    for (const m of raw.matchAll(
      /"threadId"\s*:\s*"([0-9a-f-]{36})"/gi,
    )) {
      ids.add(m[1]!.toLowerCase());
    }
  }
  return ids;
}

async function loadEligibilityMessages(
  sb: ReturnType<typeof adminClient>,
  threadId: string,
): Promise<EligibilityMessageInput[]> {
  const { data: messageRows, error } = await sb
    .from("messages")
    .select("id,subject,plain_text,clean_conversation,direction")
    .eq("user_id", USER_ID)
    .eq("thread_id", threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`o5a6_messages_failed:${error.message}`);
  const rows = messageRows ?? [];
  const messageIds = rows.map((r) => r.id as string);
  const participantsByMessage = new Map<
    string,
    Array<{ role: string; email: string; name: string | null }>
  >();
  if (messageIds.length) {
    const { data: parts, error: pErr } = await sb
      .from("message_participants")
      .select("message_id,role,email,name")
      .eq("user_id", USER_ID)
      .in("message_id", messageIds);
    if (pErr) throw new Error(`o5a6_parts_failed:${pErr.message}`);
    for (const p of parts ?? []) {
      const mid = p.message_id as string;
      const list = participantsByMessage.get(mid) ?? [];
      list.push({
        role: String(p.role),
        email: String(p.email ?? ""),
        name: (p.name as string | null) ?? null,
      });
      participantsByMessage.set(mid, list);
    }
  }
  return rows.map((row) => {
    const parts = participantsByMessage.get(row.id as string) ?? [];
    const from = parts.find((p) => p.role === "from");
    const raw =
      String(row.clean_conversation ?? "").trim() ||
      String(row.plain_text ?? "").trim();
    return {
      subject: (row.subject as string | null) ?? null,
      fromEmail: from?.email || null,
      fromName: from?.name ?? null,
      toEmails: parts
        .filter((p) => p.role === "to" || p.role === "cc")
        .map((p) => p.email)
        .filter(Boolean),
      direction: (row.direction === "outbound" ? "outbound" : "inbound") as
        | "inbound"
        | "outbound",
      body: cleanFeedMessageBody(raw).cleanText,
    };
  });
}

describe.runIf(enabled)("O5A.6 real inbox review pilot", () => {
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
    "selects 30, extracts, persists, writes review report",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();
      const hashesBefore = freezeExtractionEngineHashes();
      const sb = adminClient();
      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const selectionPath = path.join(tmpDir, "o5a6-selection.json");

      const { count: feedItemsBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      // --- Selection (locked before OpenAI) ---
      let selection: {
        evaluationVersion: string;
        selectionSeed: string;
        hardCap: number;
        selected: Array<{
          threadId: string;
          threadIdMasked: string;
          selectionHash: string;
          prefilterClassification: FeedThreadEligibility;
          eligibleForExtraction: boolean;
        }>;
      };

      if (existsSync(selectionPath)) {
        selection = JSON.parse(readFileSync(selectionPath, "utf8"));
        expect(selection.selected).toHaveLength(HARD_CAP);
      } else {
        const priorPilot = loadPriorPilotThreadIds();
        const { data: activeFeed } = await sb
          .from("feed_items")
          .select("thread_id")
          .eq("user_id", USER_ID)
          .eq("mail_account_id", MAIL_ACCOUNT_ID)
          .in("status", ["new", "open", "scheduled"]);
        const activeThreads = new Set(
          (activeFeed ?? []).map((r) =>
            String(r.thread_id).toLowerCase(),
          ),
        );

        const { data: seenRuns } = await sb
          .from("feed_extraction_runs")
          .select("thread_id")
          .eq("user_id", USER_ID)
          .eq("mail_account_id", MAIL_ACCOUNT_ID)
          .not("thread_id", "is", null);
        const seen = new Set(
          (seenRuns ?? [])
            .map((r) => r.thread_id as string)
            .filter(Boolean)
            .map((id) => id.toLowerCase()),
        );

        const { data: threads, error: tErr } = await sb
          .from("threads")
          .select("id,subject")
          .eq("user_id", USER_ID)
          .eq("mail_account_id", MAIL_ACCOUNT_ID)
          .order("latest_message_at", { ascending: false, nullsFirst: false })
          .limit(SCAN_CAP);
        if (tErr) throw new Error(`o5a6_threads_failed:${tErr.message}`);

        const candidates: Array<{
          threadId: string;
          subject: string | null;
          prefilterClassification: FeedThreadEligibility;
          eligibleForExtraction: boolean;
          selectionHash: string;
        }> = [];

        for (const t of threads ?? []) {
          const id = String(t.id).toLowerCase();
          if (priorPilot.has(id)) continue;
          if (seen.has(id)) continue;
          if (activeThreads.has(id)) continue;

          const messages = await loadEligibilityMessages(sb, t.id as string);
          const elig = classifyFeedThreadEligibility({
            subject: (t.subject as string | null) ?? null,
            accountEmail: MAILBOX,
            messages,
          });
          // Include ALL classifications — sample must exercise real filters.
          candidates.push({
            threadId: t.id as string,
            subject: (t.subject as string | null) ?? null,
            prefilterClassification: elig.classification,
            eligibleForExtraction: elig.eligibleForExtraction,
            selectionHash: selectionHash(SELECTION_SEED, t.id as string),
          });
        }

        candidates.sort((a, b) => {
          if (a.selectionHash < b.selectionHash) return -1;
          if (a.selectionHash > b.selectionHash) return 1;
          return a.threadId.localeCompare(b.threadId);
        });

        const selected = candidates.slice(0, HARD_CAP).map((c) => ({
          threadId: c.threadId,
          threadIdMasked: maskUuid(c.threadId),
          selectionHash: c.selectionHash,
          prefilterClassification: c.prefilterClassification,
          eligibleForExtraction: c.eligibleForExtraction,
        }));
        expect(selected.length).toBe(HARD_CAP);

        selection = {
          evaluationVersion: "o5a6_real_inbox_v1",
          selectionSeed: SELECTION_SEED,
          hardCap: HARD_CAP,
          selected,
        };
        writeFileSync(selectionPath, JSON.stringify(selection, null, 2), "utf8");
      }

      // Probe once
      const probe = await probeFeedModelAccess({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
      });
      if (!probe.ok) {
        throw new Error(`o5a6_probe_failed:${probe.errorCode}`);
      }

      const perThread: Array<Record<string, unknown>> = [];
      const rejectionReasons: Record<string, number> = {};
      const byType = { action: 0, change: 0, decision: 0, alert: 0 };
      let openaiCalls = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let reasoningTokens = 0;
      let latencyTotal = 0;
      let acceptedCards = 0;
      let zeroInsight = 0;
      let prefilterBlocked = 0;
      let failures = 0;
      let consecutiveFailures = 0;
      let stoppedEarly: string | null = null;
      let actualModel: string | null = probe.actualModel;
      const persisted: Array<Record<string, unknown>> = [];
      const insertedIds: string[] = [];

      const processedEligible = () =>
        perThread.filter(
          (t) =>
            t.outcome !== "prefilter_skipped" &&
            t.outcome !== "batch_stopped_before",
        ).length;

      for (const sel of selection.selected) {
        if (stoppedEarly) {
          perThread.push({
            threadId: sel.threadId,
            threadIdMasked: sel.threadIdMasked,
            outcome: "batch_stopped_before",
            prefilterClassification: sel.prefilterClassification,
            sourceRoute: `/inbox?threadId=${sel.threadId}`,
          });
          continue;
        }
        if (isFeedCircuitOpen()) {
          stoppedEarly = "circuit_open";
          failures += 1;
          break;
        }

        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: sel.threadId,
        });
        if (!ctx) {
          failures += 1;
          consecutiveFailures += 1;
          perThread.push({
            threadId: sel.threadId,
            threadIdMasked: sel.threadIdMasked,
            outcome: "failed",
            errorCode: "context_build_failed",
            prefilterClassification: sel.prefilterClassification,
            sourceRoute: `/inbox?threadId=${sel.threadId}`,
          });
          if (consecutiveFailures >= 3) {
            stoppedEarly = "three_consecutive_failures";
          }
          continue;
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

        // Record run row for audit (even prefilter)
        const now = new Date().toISOString();
        const { data: runRow } = await sb
          .from("feed_extraction_runs")
          .insert({
            user_id: USER_ID,
            mail_account_id: MAIL_ACCOUNT_ID,
            thread_id: sel.threadId,
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
          prefilterBlocked += 1;
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
          perThread.push({
            threadId: sel.threadId,
            threadIdMasked: sel.threadIdMasked,
            outcome: "prefilter_skipped",
            prefilterClassification: eligibility.classification,
            openaiCalled: false,
            sourceRoute: `/inbox?threadId=${sel.threadId}`,
            accepted: [],
            rejected: [],
          });
          continue;
        }

        openaiCalls += 1;
        const ai = await extractFeedFromContext(ctx);
        if (ai.actualModel) actualModel = ai.actualModel;
        if (ai.latencyMs != null) latencyTotal += ai.latencyMs;
        inputTokens += ai.inputTokens ?? 0;
        outputTokens += ai.outputTokens ?? 0;
        totalTokens += ai.totalTokens ?? 0;
        reasoningTokens += ai.reasoningTokens ?? 0;

        if (!ai.ok) {
          failures += 1;
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
                input_tokens: ai.inputTokens,
                output_tokens: ai.outputTokens,
                total_tokens: ai.totalTokens,
                completed_at: new Date().toISOString(),
              })
              .eq("id", runId);
          }
          perThread.push({
            threadId: sel.threadId,
            threadIdMasked: sel.threadIdMasked,
            outcome: "failed",
            errorCode: ai.errorCode,
            incompleteReason: ai.incompleteReason ?? null,
            latencyMs: ai.latencyMs,
            openaiCalled: true,
            prefilterClassification: eligibility.classification,
            sourceRoute: `/inbox?threadId=${sel.threadId}`,
            accepted: [],
            rejected: [],
          });
          const denom = processedEligible() || 1;
          if (consecutiveFailures >= 3) {
            stoppedEarly = "three_consecutive_failures";
          } else if (failures / denom > 0.2 && denom >= 5) {
            stoppedEarly = "failure_rate_over_20pct";
          }
          continue;
        }

        consecutiveFailures = 0;
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
          .eq("thread_id", sel.threadId)
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
              threadId: sel.threadId,
              sourceMessageId: c.sourceMessageId,
              type: c.type,
              evidenceText: c.evidenceText,
            }),
        });

        let finalAccepted = accepted;
        if (ctx.contextCoverage === "truncated") {
          finalAccepted = accepted.filter((c) => c.type === "action");
        }
        // Migration 0020 applied — persist alerts.
        // Prefix topic keys for reversible pilot identification.
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
            threadId: sel.threadId,
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

          // Ensure no accidental supersede of non-pilot items
          expect(persist.supersededIds).toHaveLength(0);

          for (const c of finalAccepted) {
            byType[c.type as keyof typeof byType] =
              (byType[c.type as keyof typeof byType] ?? 0) + 1;
            acceptedCards += 1;
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
              sourceRoute: `/inbox?threadId=${sel.threadId}`,
              sourceUrl: `/source/thread/${sel.threadId}?message=${encodeURIComponent(c.sourceMessageId)}`,
              extractionVersion: EXTRACTION_VERSION,
            };
            cardSummaries.push(summary);
            persisted.push({
              ...summary,
              threadId: sel.threadId,
              threadIdMasked: sel.threadIdMasked,
            });
          }
        } else {
          zeroInsight += 1;
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
              rejected_count:
                rejected.length + gateRejected + skippedDupes,
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

        perThread.push({
          threadId: sel.threadId,
          threadIdMasked: sel.threadIdMasked,
          outcome:
            finalAccepted.length > 0
              ? "completed_with_candidates"
              : "completed_zero_insight",
          prefilterClassification: eligibility.classification,
          modelThreadClassification: ai.parsed.threadClassification,
          openaiCalled: true,
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
          sourceRoute: `/inbox?threadId=${sel.threadId}`,
        });
      }

      expect(freezeExtractionEngineHashes().combinedHash).toBe(
        hashesBefore.combinedHash,
      );

      const { count: feedItemsAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const { data: newPilotRows } = await sb
        .from("feed_items")
        .select(
          "id,type,headline,requested_action,evidence_text,status,dedupe_key,extraction_version,alert_category,alert_verification_state,action_state,relation_to_mailbox,requester_email,assignee_email,thread_id,source_message_id",
        )
        .eq("user_id", USER_ID)
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      // Live feed check
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

      const cost = estimateTokenCostUsd({
        model: MODEL,
        inputTokens,
        outputTokens,
      });

      const report = {
        evaluationVersion: "o5a6_real_inbox_v1",
        status: "AWAITING HUMAN REVIEW OF 30-THREAD LIVE PILOT",
        model: MODEL,
        actualModel,
        extractionVersion: EXTRACTION_VERSION,
        selectionSeed: SELECTION_SEED,
        engineCombinedHash: hashesBefore.combinedHash,
        engineUnchanged: true,
        stoppedEarly,
        constraints: {
          noO5B: true,
          noWebhooks: true,
          noPush: true,
          noOnyx: true,
          noEngineChanges: true,
          noAutoRetry: true,
        },
        feedItems: {
          before: feedItemsBefore ?? 0,
          after: feedItemsAfter ?? 0,
          delta: (feedItemsAfter ?? 0) - (feedItemsBefore ?? 0),
          pilotRows: (newPilotRows ?? []).length,
        },
        selection: {
          lockedFile: "tmp/o5a6-selection.json",
          count: selection.selected.length,
          prefilterAtSelection: selection.selected.reduce(
            (acc, s) => {
              acc[s.prefilterClassification] =
                (acc[s.prefilterClassification] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          threads: selection.selected,
        },
        openai: {
          probeCount: 1,
          extractionAttempts: openaiCalls,
          failures,
          inputTokens,
          outputTokens,
          reasoningTokens,
          totalTokens,
          estimatedCostUsd: cost,
          latencyAvgMs: openaiCalls
            ? Math.round(latencyTotal / openaiCalls)
            : 0,
        },
        extraction: {
          prefilterBlocked,
          acceptedCards,
          zeroInsight,
          failures,
          outcomes: {
            prefilter_skipped: prefilterBlocked,
            completed_with_candidates: perThread.filter(
              (t) => t.outcome === "completed_with_candidates",
            ).length,
            completed_zero_insight: zeroInsight,
            failed: failures,
            batch_stopped_before: perThread.filter(
              (t) => t.outcome === "batch_stopped_before",
            ).length,
          },
          byType,
          rejectionReasons,
        },
        persistedCards: persisted,
        pilotDbRows: newPilotRows ?? [],
        liveFeed: {
          pilotVisibleCount: pilotFeedCards.length,
          rtlHebrewOk: rtlOk || pilotFeedCards.length === 0,
          topCards: pilotFeedCards.slice(0, 15).map((c) => ({
            id: c.id,
            typeLabel: c.typeLabel,
            headline: c.headline,
            sourceUrl: c.sourceUrl,
            status: c.status,
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
      md.push("# O5A.6 Real Inbox Review Pilot");
      md.push("");
      md.push(
        "Status: **AWAITING HUMAN REVIEW OF 30-THREAD LIVE PILOT**",
      );
      md.push(`Model: \`${MODEL}\` (actual: \`${actualModel}\`)`);
      md.push(`Extraction version: \`${EXTRACTION_VERSION}\``);
      md.push(
        `feed_items: ${feedItemsBefore} → ${feedItemsAfter} (delta=${(feedItemsAfter ?? 0) - (feedItemsBefore ?? 0)})`,
      );
      if (stoppedEarly) md.push(`Stopped early: **${stoppedEarly}**`);
      md.push("");
      md.push("## Totals");
      md.push("");
      md.push(`- selected: ${selection.selected.length}`);
      md.push(`- prefilter blocked: ${prefilterBlocked}`);
      md.push(`- OpenAI calls: ${openaiCalls}`);
      md.push(`- accepted cards: ${acceptedCards}`);
      md.push(`- zero insight: ${zeroInsight}`);
      md.push(`- failed (not zero): ${failures}`);
      md.push(`- byType: ${JSON.stringify(byType)}`);
      md.push(
        `- tokens: ${totalTokens} (in=${inputTokens}, out=${outputTokens}, reasoning≈${reasoningTokens})`,
      );
      md.push(`- est. cost USD: ${cost.toFixed(6)}`);
      md.push(
        `- latency avg ms: ${openaiCalls ? Math.round(latencyTotal / openaiCalls) : 0}`,
      );
      md.push(`- rejectionReasons: ${JSON.stringify(rejectionReasons)}`);
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
        md.push(`- source: ${c.sourceRoute}`);
        md.push(`- extraction_version: \`${EXTRACTION_VERSION}\``);
        md.push("");
      }
      md.push("## Per thread");
      md.push("");
      for (const t of perThread) {
        md.push(`### ${t.threadIdMasked}`);
        md.push(`- outcome: \`${t.outcome}\``);
        md.push(`- prefilter: ${t.prefilterClassification}`);
        if (t.errorCode) md.push(`- error: ${t.errorCode}`);
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
      md.push("**AWAITING HUMAN REVIEW OF 30-THREAD LIVE PILOT**");

      writeFileSync(
        path.join(tmpDir, "o5a6-real-inbox-review.md"),
        md.join("\n"),
        "utf8",
      );

      expect(selection.selected).toHaveLength(HARD_CAP);
      expect(report.constraints.noO5B).toBe(true);
    },
    1_800_000,
  );
});
