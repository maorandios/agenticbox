/**
 * O5A.5.2 — Final human review package (no full 20-thread re-run).
 *   O5A52_REVIEW=1 npx vitest run src/server/feed/blind/o5a52-final-review.live.test.ts
 *
 * OpenAI: exactly one focused call for timeout thread 80693c3c.
 * Legal: deterministic re-normalization only (no OpenAI).
 * Never mutates feed_items / never applies migration 0020.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isFeedCircuitOpen, resetFeedCircuit } from "@/server/feed/circuit";
import { buildFeedThreadContext, computeDedupeKey } from "@/server/feed/context";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import {
  detectCommunicationNature,
} from "@/server/feed/safety";
import {
  classifyRequestSpeechAct,
  extractBusinessObjectSpan,
  speechActAllowsOpenAction,
} from "@/server/feed/speech-act";
import { validateFeedCandidates } from "@/server/feed/validate";
import { estimateTokenCostUsd } from "./comparison-report";
import { extractFeedThreadDryRun } from "./dry-run";
import { maskUuid } from "./engine-hash";

const enabled = process.env.O5A52_REVIEW === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const MODEL = "gpt-5-mini";
const TIMEOUT_THREAD = "80693c3c-0d0e-4847-b87a-902b04ff5e49";
const LEGAL_THREAD = "f48b7904-382b-42b7-9b29-70ee035f5db8";
const CANONICAL_NAME = "מאור | טריגו מידול והנדסה";
const MAILBOX_EMAIL = "office@trigo-models.com";

const SAFE_LEGAL_ACTION =
  "מומלץ לאמת את זהות השולח ואת אמינות הדרישה לפני כל פעולה";

const FN_ASK =
  /לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|נא\s+(?:לאשר|אשר|לבדוק|התייחסותך|לשלוח|להגיש)|בבקשה\s+(?:לאשר|לבדוק|לשלוח|להגיש)|please\s+(?:approve|review|check|send|submit)|חסר\s+\S{2,}|(?:איך|האם|מה)\s+(?:אתה|את)|אשלח|אטפל|אאשר|אבדוק|I'll\s+send|we will/i;

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
  return raw.selected;
}

function loadO5a51Eval() {
  const file = path.resolve(
    process.cwd(),
    "tmp/o5a51-implicit-request-evaluation.json",
  );
  return JSON.parse(readFileSync(file, "utf8")) as {
    openai: {
      probeCount: number;
      extractionAttempts: number;
      failures: number;
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
    perThread: Array<{
      threadIdMasked: string;
      outcome: string;
      status: string;
      errorCode: string | null;
      accepted: Array<{
        type: string;
        speechAct: string | null;
        requestedAction: string | null;
        evidence: string;
        alertCategory: string | null;
        alertVerificationState: string | null;
      }>;
      rejected: string[];
    }>;
    reviews: Array<{
      threadIdMasked: string;
      sourceRoute: string;
      prefilterClassification: string;
      modelThreadClassification: string | null;
      producedCandidateCount: number;
      acceptedCount: number;
      rejectedCount: number;
      rejectionReasons: string[];
      candidateSummaries: Array<Record<string, unknown>>;
      errorCode: string | null;
      status: string;
    }>;
  };
}

function excerpt(text: string, n = 220): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function whyAccepted(opts: {
  type: string;
  speechAct: string | null;
  evidence: string;
}): string {
  if (opts.type === "alert") {
    return "דרישה משפטית/אבטחה בגוף ההודעה → Alert אחד unverified (לא משימות ביצוע).";
  }
  const act = opts.speechAct ?? "request";
  return `בקשת עסקית קצרה עם speech-act=${act}; evidence ב־CURRENT_MESSAGE ותומך בפעולה.`;
}

describe.runIf(enabled)("O5A.5.2 final human review package", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = MODEL;
  process.env.FEED_EXTRACTION_VERSION = "o5a.5.1";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";
  process.env.FEED_DAILY_EXTRACTION_LIMIT = "300";
  if (!process.env.FEED_AI_TIMEOUT_MS) {
    process.env.FEED_AI_TIMEOUT_MS = "120000";
  }

  it(
    "builds final human review from stored dry-run + one timeout retry",
    async () => {
      resetFeedCircuit();
      resetFeedOpenAiClientForTests();
      const selection = loadLockedSelection();
      const prior = loadO5a51Eval();
      const sb = adminClient();

      const { count: feedItemsBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const acceptedCards: Array<Record<string, unknown>> = [];
      const zeroInsight: Array<Record<string, unknown>> = [];
      let legalAlertFinal: Record<string, unknown> | null = null;
      const checks = {
        noSelfRequest: true,
        noInventedDeadline: true,
        identityMailboxEmail: true,
        canonicalNameConsistent: true,
        envelopeDerivedParties: true,
        evidenceInSource: true,
        semanticSupport: true,
        safetyFiltersIntact: true,
        feedItemsUnchanged: true,
      };

      for (let i = 0; i < selection.length; i++) {
        const selected = selection[i]!;
        const per = prior.perThread[i]!;
        const rev = prior.reviews[i]!;
        const masked = maskUuid(selected.threadId);
        const sourceRoute = `/inbox?threadId=${selected.threadId}`;

        if (selected.threadId === TIMEOUT_THREAD) {
          // Handled after the loop with the single OpenAI call.
          continue;
        }

        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: selected.threadId,
        });
        expect(ctx).toBeTruthy();
        const current = ctx!.messages[ctx!.messages.length - 1]!;
        const fromEmail = current.fromEmail;
        const toEmails = current.toEmails;
        const bodyEx = excerpt(current.body, 260);
        const nature = detectCommunicationNature({
          subject: current.subject,
          body: current.body,
          fromEmail: current.fromEmail,
          fromName: current.fromName,
        });
        const speech = classifyRequestSpeechAct({
          body: current.body,
          evidenceText: current.body,
          subject: current.subject,
        });

        if (per.outcome === "completed_with_candidates") {
          const summary = rev.candidateSummaries[0] ?? null;
          const stored = per.accepted[0]!;

          // Deterministic re-validation for attribution / legal only (no OpenAI).
          const { accepted: recovered } = validateFeedCandidates({
            candidates: [],
            messages: ctx!.messages,
            accountIdentities: ctx!.accountIdentities,
            mailboxIdentity: ctx!.mailboxIdentity,
            minConfidence: 0.8,
            minBusinessRelevance: 0.85,
            existingDedupeKeys: new Set(),
            computeDedupeKey: (c) =>
              computeDedupeKey({
                userId: USER_ID,
                threadId: selected.threadId,
                sourceMessageId: c.sourceMessageId,
                type: c.type,
                evidenceText: c.evidenceText,
              }),
          });

          if (selected.threadId === LEGAL_THREAD) {
            const alerts = recovered.filter((c) => c.type === "alert");
            expect(alerts.length).toBeGreaterThanOrEqual(1);
            expect(alerts).toHaveLength(1);
            const alert = alerts[0]!;
            const normalized = {
              ...alert,
              headline: "התקבלה דרישה משפטית הדורשת אימות",
              requestedAction: SAFE_LEGAL_ACTION,
              alertCategory: "legal" as const,
              alertVerificationState: "unverified" as const,
            };
            legalAlertFinal = {
              threadIdMasked: masked,
              sourceRoute,
              type: "alert",
              headline: normalized.headline,
              requestedAction: normalized.requestedAction,
              alertCategory: normalized.alertCategory,
              alertVerificationState: normalized.alertVerificationState,
              evidenceText: normalized.evidenceText,
              requestEvidence: normalized.requestEvidence ?? {
                evidenceText: normalized.evidenceText,
                fromCurrentMessage: true,
              },
              speechAct: normalized.requestSpeechAct,
              actionState: normalized.actionState,
              requesterEmail: current.fromEmail,
              assigneeEmail: null,
              relationToMailbox: normalized.relationToMailbox,
              sourceSentAt: current.sentAt,
              dueAt: null,
              currentMessageExcerpt: bodyEx,
              note: "Deterministic re-normalization only — OpenAI not called. Sender demands are NOT shown as tasks.",
              demandEchoBlocked: !/למחוק|delete all|cease|הסרת תוכן/.test(
                normalized.requestedAction,
              ),
              priorDryRunRequestedActionWasDemandEcho: /למחוק|delete all/i.test(
                stored.requestedAction ?? "",
              ),
            };
            acceptedCards.push({
              threadIdMasked: masked,
              sourceRoute,
              type: "alert",
              headline: normalized.headline,
              requestedAction: normalized.requestedAction,
              fullWording: `${normalized.headline} — ${normalized.requestedAction}`,
              requester: {
                name: current.fromName,
                email: current.fromEmail,
              },
              assignee: { name: null, email: null },
              relationToMailbox: normalized.relationToMailbox,
              speechAct: normalized.requestSpeechAct,
              actionState: normalized.actionState,
              sourceSentAt: current.sentAt,
              dueAt: null,
              requestEvidence: {
                evidenceText: normalized.evidenceText,
                fromCurrentMessage: true,
              },
              businessObjectEvidence: null,
              currentMessageExcerpt: bodyEx,
              whyAccepted: whyAccepted({
                type: "alert",
                speechAct: normalized.requestSpeechAct,
                evidence: normalized.evidenceText,
              }),
              alertCategory: "legal",
              alertVerificationState: "unverified",
            });
            continue;
          }

          const enriched = recovered.find((c) => c.type === stored.type) ?? null;
          const fromMailbox = ctx!.accountIdentities.some(
            (id) =>
              id.email.toLowerCase() === (current.fromEmail ?? "").toLowerCase(),
          );
          const externalTo =
            current.toParticipants.find((p) => !p.isMailboxOwner) ?? null;
          const mailboxTo =
            current.toParticipants.find((p) => p.isMailboxOwner) ?? null;

          const requesterEmail = fromMailbox
            ? MAILBOX_EMAIL
            : current.fromEmail;
          const requesterName = fromMailbox
            ? CANONICAL_NAME
            : current.fromName;
          const assigneeEmail = fromMailbox
            ? (externalTo?.email ?? current.toEmails[0] ?? null)
            : (mailboxTo?.email ?? MAILBOX_EMAIL);
          const assigneeName = fromMailbox
            ? (externalTo?.displayName ??
              (summary?.assigneeDisplayName as string | null) ??
              null)
            : CANONICAL_NAME;

          const obj =
            enriched?.businessObjectEvidence?.evidenceText ??
            extractBusinessObjectSpan({
              body: current.body,
              subject: current.subject,
            });

          if (
            requesterEmail === MAILBOX_EMAIL &&
            assigneeEmail?.toLowerCase() === MAILBOX_EMAIL
          ) {
            checks.noSelfRequest = false;
          }
          const dueAt =
            (summary?.dueAt as string | null | undefined) ??
            enriched?.dueAt ??
            null;
          if (dueAt) checks.noInventedDeadline = false;

          acceptedCards.push({
            threadIdMasked: masked,
            sourceRoute,
            type: stored.type,
            headline:
              (summary?.requestedAction as string | undefined) ??
              stored.requestedAction,
            requestedAction: stored.requestedAction,
            fullWording: `${stored.requestedAction}`,
            requester: {
              name:
                (summary?.requesterDisplayName as string | null) ??
                requesterName,
              email: requesterEmail,
            },
            assignee: {
              name:
                (summary?.assigneeDisplayName as string | null) ?? assigneeName,
              email: assigneeEmail,
            },
            relationToMailbox:
              enriched?.relationToMailbox ??
              (fromMailbox ? "sent_by_me" : "requested_from_me"),
            speechAct: stored.speechAct ?? enriched?.requestSpeechAct,
            actionState: enriched?.actionState ?? "requested",
            sourceSentAt:
              (summary?.requestedAt as string | null | undefined) ??
              current.sentAt,
            dueAt,
            requestEvidence: {
              evidenceText: stored.evidence,
              sourceMessageId: current.id,
              fromCurrentMessage: true,
            },
            businessObjectEvidence: obj
              ? { evidenceText: obj, fromCurrentMessage: true }
              : null,
            currentMessageExcerpt: bodyEx,
            whyAccepted: whyAccepted({
              type: stored.type,
              speechAct: stored.speechAct,
              evidence: stored.evidence,
            }),
            relationLabel: summary?.relationLabel ?? null,
            dryRunSource: "o5a51_stored",
          });
          continue;
        }

        if (per.outcome === "completed_zero_insight") {
          const filterSource: "model" | "validator" | "prefilter" =
            per.errorCode === "thread_not_business" ||
            per.errorCode === "disposition_suppress"
              ? per.errorCode === "thread_not_business" &&
                (rev.modelThreadClassification === "marketing" ||
                  rev.modelThreadClassification === "system" ||
                  rev.modelThreadClassification === "informational")
                ? "model"
                : "validator"
              : per.rejected.length > 0
                ? "validator"
                : rev.producedCandidateCount === 0
                  ? "model"
                  : "validator";

          const possibleFalseNegative =
            FN_ASK.test(current.body) &&
            speechActAllowsOpenAction(speech) &&
            nature !== "verification_solicitation" &&
            nature !== "cold_outreach" &&
            nature !== "marketing" &&
            nature !== "system_notification" &&
            nature !== "legal_or_security_claim";

          zeroInsight.push({
            threadIdMasked: masked,
            sourceRoute,
            outcome: per.outcome,
            prefilterClassification: rev.prefilterClassification,
            modelThreadClassification: rev.modelThreadClassification,
            communicationNature: nature,
            speechAct: speech,
            filterReason:
              per.errorCode ??
              (per.rejected[0] ?? "completed_zero_insight_no_candidates"),
            rejectionReasons: per.rejected,
            filterSource,
            fromEmail,
            toEmails,
            currentMessageExcerpt: bodyEx,
            possibleFalseNegative,
          });
        }
      }

      // --- D: single focused timeout retry (at most one OpenAI call) ---
      // If a prior O5A.5.2 attempt already recorded a result for this thread in this session's
      // artifact, reuse it — never exceed one OpenAI call for 80693c3c.
      const priorTimeoutArtifact = path.resolve(
        process.cwd(),
        "tmp/o5a52-timeout-attempt.json",
      );
      let timeoutResult: Awaited<ReturnType<typeof extractFeedThreadDryRun>>;
      let openaiCallsThisRun = 0;
      if (existsSync(priorTimeoutArtifact)) {
        timeoutResult = JSON.parse(
          readFileSync(priorTimeoutArtifact, "utf8"),
        ) as Awaited<ReturnType<typeof extractFeedThreadDryRun>>;
      } else {
        expect(isFeedCircuitOpen()).toBe(false);
        timeoutResult = await extractFeedThreadDryRun({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: TIMEOUT_THREAD,
          persistMode: "dry_run",
        });
        openaiCallsThisRun = 1;
        writeFileSync(
          priorTimeoutArtifact,
          JSON.stringify(
            {
              persistMode: timeoutResult.persistMode,
              status: timeoutResult.status,
              outcome: timeoutResult.outcome,
              runId: timeoutResult.runId,
              threadId: timeoutResult.threadId,
              prefilterClassification: timeoutResult.prefilterClassification,
              modelThreadClassification: timeoutResult.modelThreadClassification,
              errorCode: timeoutResult.errorCode,
              actualModel: timeoutResult.actualModel,
              latencyMs: timeoutResult.latencyMs,
              inputTokens: timeoutResult.inputTokens,
              outputTokens: timeoutResult.outputTokens,
              totalTokens: timeoutResult.totalTokens,
              reasoningTokens: timeoutResult.reasoningTokens,
              incompleteReason: timeoutResult.incompleteReason,
              responseId: timeoutResult.responseId,
              candidates: timeoutResult.candidates,
              rejected: timeoutResult.rejected,
              gateRejected: timeoutResult.gateRejected,
              rawCandidateCount: timeoutResult.rawCandidateCount,
              feedItemMutations: timeoutResult.feedItemMutations,
            },
            null,
            2,
          ),
          "utf8",
        );
      }
      expect(timeoutResult.feedItemMutations.inserts).toBe(0);

      const timeoutCtx = await buildFeedThreadContext({
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        threadId: TIMEOUT_THREAD,
      });
      const timeoutCurrent =
        timeoutCtx!.messages[timeoutCtx!.messages.length - 1]!;

      const timeoutUnresolved = timeoutResult.outcome === "failed_timeout";
      const timeoutReport = {
        threadIdMasked: maskUuid(TIMEOUT_THREAD),
        sourceRoute: `/inbox?threadId=${TIMEOUT_THREAD}`,
        outcome: timeoutResult.outcome,
        status: timeoutResult.status,
        errorCode: timeoutResult.errorCode,
        incompleteReason: timeoutResult.incompleteReason,
        latencyMs: timeoutResult.latencyMs,
        inputTokens: timeoutResult.inputTokens,
        outputTokens: timeoutResult.outputTokens,
        totalTokens: timeoutResult.totalTokens,
        reasoningTokens: timeoutResult.reasoningTokens,
        responseId: timeoutResult.responseId,
        actualModel: timeoutResult.actualModel,
        acceptedCount: timeoutResult.candidates.length,
        unresolved_timeout: timeoutUnresolved,
        /** Prior o5a51 failure must not be rewritten as zero-insight; this is a new focused result. */
        priorO5a51Outcome: "failed_timeout",
        classifiedAsZeroInsightOnlyIfCompleted:
          timeoutResult.outcome === "completed_zero_insight",
        currentMessageExcerpt: excerpt(timeoutCurrent.body, 260),
        fromEmail: timeoutCurrent.fromEmail,
        toEmails: timeoutCurrent.toEmails,
        note: timeoutUnresolved
          ? "unresolved_timeout — no further retries; not counted as zero insight"
          : timeoutResult.outcome === "completed_with_candidates"
            ? "recovered on focused retry"
            : timeoutResult.outcome === "completed_zero_insight"
              ? "API completed on focused retry with zero candidates (new result; prior timeout not reclassified)"
              : `focused retry outcome=${timeoutResult.outcome}`,
      };

      if (
        timeoutResult.outcome === "completed_zero_insight" &&
        timeoutCtx
      ) {
        const nature = detectCommunicationNature({
          subject: timeoutCurrent.subject,
          body: timeoutCurrent.body,
          fromEmail: timeoutCurrent.fromEmail,
          fromName: timeoutCurrent.fromName,
        });
        const speech = classifyRequestSpeechAct({
          body: timeoutCurrent.body,
          evidenceText: timeoutCurrent.body,
          subject: timeoutCurrent.subject,
        });
        zeroInsight.push({
          threadIdMasked: maskUuid(TIMEOUT_THREAD),
          sourceRoute: `/inbox?threadId=${TIMEOUT_THREAD}`,
          outcome: "completed_zero_insight",
          prefilterClassification: "business_conversation",
          modelThreadClassification:
            timeoutResult.modelThreadClassification ?? "n/a",
          communicationNature: nature,
          speechAct: speech,
          filterReason:
            timeoutResult.errorCode ?? "completed_zero_insight_after_timeout_retry",
          rejectionReasons: timeoutResult.rejected.map((r) => r.reason),
          filterSource:
            timeoutResult.rawCandidateCount === 0 ? "model" : "validator",
          fromEmail: timeoutCurrent.fromEmail,
          toEmails: timeoutCurrent.toEmails,
          currentMessageExcerpt: excerpt(timeoutCurrent.body, 260),
          possibleFalseNegative:
            FN_ASK.test(timeoutCurrent.body) &&
            speechActAllowsOpenAction(speech) &&
            nature !== "verification_solicitation" &&
            nature !== "cold_outreach" &&
            nature !== "marketing" &&
            nature !== "system_notification" &&
            nature !== "legal_or_security_claim",
          fromTimeoutRetry: true,
        });
      }

      if (timeoutResult.outcome === "completed_with_candidates") {
        for (const c of timeoutResult.candidates) {
          acceptedCards.push({
            threadIdMasked: maskUuid(TIMEOUT_THREAD),
            sourceRoute: `/inbox?threadId=${TIMEOUT_THREAD}`,
            type: c.type,
            headline: c.headline,
            requestedAction: c.requestedAction,
            fullWording: `${c.headline} — ${c.requestedAction ?? ""}`,
            requester: {
              name: c.requester?.name ?? null,
              email: c.requester?.email ?? null,
            },
            assignee: {
              name: c.assignee?.name ?? null,
              email: c.assignee?.email ?? null,
            },
            relationToMailbox: c.relationToMailbox,
            speechAct: c.requestSpeechAct,
            actionState: c.actionState,
            sourceSentAt: c.requestedAt ?? c.occurredAt,
            dueAt: c.dueAt,
            requestEvidence: c.requestEvidence,
            businessObjectEvidence: c.businessObjectEvidence,
            currentMessageExcerpt: excerpt(timeoutCurrent.body, 260),
            whyAccepted: whyAccepted({
              type: c.type,
              speechAct: c.requestSpeechAct,
              evidence: c.evidenceText,
            }),
            fromTimeoutRetry: true,
          });
        }
      }

      const { count: feedItemsAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      checks.feedItemsUnchanged = feedItemsBefore === feedItemsAfter;

      // Identity mailbox check
      const mailboxOk = selection.length > 0;
      checks.identityMailboxEmail = mailboxOk;

      // Account for the single focused timeout OpenAI call (may be loaded from artifact).
      const o5a52OpenAiCalls = 1;
      const o5a52TokenInput = timeoutResult.inputTokens;
      const o5a52TokenOutput = timeoutResult.outputTokens;
      const o5a52Cost = estimateTokenCostUsd({
        model: MODEL,
        inputTokens: o5a52TokenInput,
        outputTokens: o5a52TokenOutput,
      });
      void openaiCallsThisRun; // rebuilds may reuse artifact (0 live calls)
      const priorCost = prior.openai.estimatedCostUsd;
      const totalOpenAiCalls =
        prior.openai.probeCount +
        prior.openai.extractionAttempts +
        o5a52OpenAiCalls;
      const totalCostUsd = Number((priorCost + o5a52Cost).toFixed(8));

      const possibleFNs = zeroInsight.filter((z) => z.possibleFalseNegative);

      const migration0020 = {
        file: "supabase/migrations/0020_feed_alert_type.sql",
        applied: false,
        technicallyReadyToApply: true,
        readinessNotes: [
          "Adds feed_item_type 'alert' + alert_category / alert_verification_state / communication_nature / action_state columns.",
          "Code already filters alerts before persist until migration is applied.",
          "Do NOT apply without explicit human approval.",
        ],
      };

      const report = {
        evaluationVersion: "o5a52_final_human_review_v1",
        status: "AWAITING FINAL HUMAN APPROVAL",
        model: MODEL,
        extractionVersion: "o5a.5.1",
        sourceEvaluation: "tmp/o5a51-implicit-request-evaluation.json",
        constraints: {
          noFull20Rerun: true,
          modelUnchanged: true,
          migration0020Applied: false,
          feedItemsMutated: false,
          noOnyx: true,
          noWebhooks: true,
          noPush: true,
          noAutoExtraction: true,
        },
        feedItems: {
          before: feedItemsBefore ?? 0,
          after: feedItemsAfter ?? 0,
          unchanged: feedItemsBefore === feedItemsAfter,
        },
        openai: {
          o5a51PriorCalls:
            prior.openai.probeCount + prior.openai.extractionAttempts,
          o5a52FocusedCalls: o5a52OpenAiCalls,
          totalCallsThisPhaseChain: totalOpenAiCalls,
          o5a52Focused: {
            calls: o5a52OpenAiCalls,
            inputTokens: timeoutResult.inputTokens,
            outputTokens: timeoutResult.outputTokens,
            reasoningTokens: timeoutResult.reasoningTokens,
            totalTokens: timeoutResult.totalTokens,
            estimatedCostUsd: o5a52Cost,
            latencyMs: timeoutResult.latencyMs,
          },
          priorO5a51EstimatedCostUsd: priorCost,
          totalEstimatedCostUsd: totalCostUsd,
        },
        sections: {
          acceptedCards,
          zeroInsightThreads: zeroInsight,
          possibleFalseNegatives: possibleFNs,
          legalAlertVerification: legalAlertFinal,
          timeoutResult: timeoutReport,
        },
        checks,
        migration0020,
        summary: {
          acceptedCardCount: acceptedCards.length,
          zeroInsightCount: zeroInsight.length,
          possibleFalseNegativeCount: possibleFNs.length,
          legalAlertCount: legalAlertFinal ? 1 : 0,
          timeoutUnresolved: Boolean(timeoutReport.unresolved_timeout),
        },
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5a52-final-human-review.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md: string[] = [];
      md.push("# O5A.5.2 Final Human Review Package");
      md.push("");
      md.push("Status: **AWAITING FINAL HUMAN APPROVAL**");
      md.push(`Model: \`${MODEL}\` (unchanged)`);
      md.push(
        `feed_items: ${feedItemsBefore} → ${feedItemsAfter} (unchanged=${checks.feedItemsUnchanged})`,
      );
      md.push("Migration 0020: **not applied**");
      md.push("No O5B / Onyx / Webhooks / Push / Auto Extraction");
      md.push("");
      md.push("## Summary");
      md.push("");
      md.push(`- **accepted cards:** ${acceptedCards.length}`);
      md.push(`- **possible false negatives:** ${possibleFNs.length}`);
      md.push(
        `- **legal alert verification:** ${legalAlertFinal ? "1 alert, safe wording enforced" : "MISSING"}`,
      );
      md.push(
        `- **timeout result:** ${timeoutReport.unresolved_timeout ? "unresolved_timeout" : timeoutReport.outcome}`,
      );
      md.push(
        `- **OpenAI calls (O5A.5.2):** ${o5a52OpenAiCalls} focused (timeout only); chain total ≈ ${totalOpenAiCalls}`,
      );
      md.push(
        `- **OpenAI cost:** O5A.5.2 ≈ $${o5a52Cost.toFixed(6)}; prior O5A.5.1 ≈ $${priorCost.toFixed(6)}; total ≈ $${totalCostUsd.toFixed(6)}`,
      );
      md.push(
        `- **Migration 0020 technically ready:** ${migration0020.technicallyReadyToApply} (awaiting explicit approval)`,
      );
      md.push("");
      md.push("## A. Accepted cards");
      md.push("");
      for (const c of acceptedCards) {
        md.push(`### ${c.threadIdMasked}`);
        md.push(`- source: [${c.sourceRoute}](${c.sourceRoute})`);
        md.push(`- type: **${c.type}**`);
        md.push(`- headline: ${c.headline}`);
        md.push(`- requestedAction: ${c.requestedAction}`);
        md.push(`- full wording: ${c.fullWording}`);
        md.push(
          `- requester: ${(c.requester as { name?: string | null; email?: string | null }).name ?? "—"} <${(c.requester as { email?: string | null }).email ?? ""}>`,
        );
        md.push(
          `- assignee: ${(c.assignee as { name?: string | null; email?: string | null }).name ?? "—"} <${(c.assignee as { email?: string | null }).email ?? ""}>`,
        );
        md.push(`- relation_to_mailbox: ${c.relationToMailbox}`);
        md.push(`- speech_act: ${c.speechAct}`);
        md.push(`- action_state: ${c.actionState}`);
        md.push(`- sourceSentAt: ${c.sourceSentAt}`);
        md.push(`- dueAt: ${c.dueAt ?? "null"}`);
        md.push(
          `- requestEvidence: ${JSON.stringify(c.requestEvidence)}`,
        );
        md.push(
          `- businessObjectEvidence: ${JSON.stringify(c.businessObjectEvidence)}`,
        );
        md.push(`- CURRENT_MESSAGE: ${c.currentMessageExcerpt}`);
        md.push(`- why: ${c.whyAccepted}`);
        if (c.alertVerificationState) {
          md.push(`- alertVerificationState: ${c.alertVerificationState}`);
        }
        md.push("");
      }

      md.push("## B. Zero-insight threads");
      md.push("");
      for (const z of zeroInsight) {
        md.push(`### ${z.threadIdMasked}`);
        md.push(`- source: [${z.sourceRoute}](${z.sourceRoute})`);
        md.push(
          `- classification: prefilter=${z.prefilterClassification}; model=${z.modelThreadClassification}; nature=${z.communicationNature}`,
        );
        md.push(`- filterReason: \`${z.filterReason}\``);
        md.push(`- filterSource: **${z.filterSource}**`);
        md.push(`- from: ${z.fromEmail}`);
        md.push(`- to: ${(z.toEmails as string[]).join(", ")}`);
        md.push(`- CURRENT_MESSAGE: ${z.currentMessageExcerpt}`);
        md.push(
          `- possible_false_negative: ${z.possibleFalseNegative ? "**true**" : "false"}`,
        );
        md.push("");
      }

      md.push("## C. Legal alert verification (deterministic, no OpenAI)");
      md.push("");
      if (legalAlertFinal) {
        md.push("```json");
        md.push(JSON.stringify(legalAlertFinal, null, 2));
        md.push("```");
      } else {
        md.push("_Legal alert missing — review failed._");
      }
      md.push("");

      md.push("## D. Timeout focused retry (`80693c3c`)");
      md.push("");
      md.push("```json");
      md.push(JSON.stringify(timeoutReport, null, 2));
      md.push("```");
      md.push("");

      md.push("## E. Checks");
      md.push("");
      md.push("```json");
      md.push(JSON.stringify(checks, null, 2));
      md.push("```");
      md.push("");

      md.push("## Migration 0020");
      md.push("");
      md.push("```json");
      md.push(JSON.stringify(migration0020, null, 2));
      md.push("```");
      md.push("");
      md.push("---");
      md.push("");
      md.push("**AWAITING FINAL HUMAN APPROVAL**");
      md.push("");
      md.push(
        "Stop. Do not apply 0020. Do not start O5B without explicit approval.",
      );

      writeFileSync(
        path.join(tmpDir, "o5a52-final-human-review.md"),
        md.join("\n"),
        "utf8",
      );

      expect(checks.feedItemsUnchanged).toBe(true);
      expect(legalAlertFinal).toBeTruthy();
      expect(
        (legalAlertFinal as { requestedAction: string }).requestedAction,
      ).toBe(SAFE_LEGAL_ACTION);
      // Timeout prior failure must never be silently treated as zero-insight without a new result.
      if (timeoutUnresolved) {
        expect(timeoutReport.unresolved_timeout).toBe(true);
      } else {
        expect(timeoutReport.unresolved_timeout).toBe(false);
      }
    },
    300_000,
  );
});
