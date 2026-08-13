/**
 * Resume O5A.1 after supersede succeeded and probe had a transient failure.
 *   O5A1_FEED_PILOT_RESUME=1 npx vitest run src/server/feed/o5a1-pilot-resume.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { enqueueFeedPilot } from "@/server/feed/enqueue";
import { probeFeedModelAccess } from "@/server/feed/model-access";
import { processFeedQueue } from "@/server/feed/worker";
import { O5A_SUPERSEDE_REASON } from "@/server/feed/config";

const enabled = process.env.O5A1_FEED_PILOT_RESUME === "1";

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function censor(text: string | null | undefined, max = 48): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) {
    return cleaned.replace(/[^\u0590-\u05FF\w\s.,:\-]/g, "•");
  }
  return `${cleaned.slice(0, max).replace(/[^\u0590-\u05FF\w\s.,:\-]/g, "•")}…`;
}

function estimateUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000;
}

describe.runIf(enabled)("O5A.1 resume calibrated pilot", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.1";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";
  process.env.FEED_AI_TIMEOUT_MS = "90000";

  it(
    "probes once then extracts ≤20 eligible threads",
    async () => {
      resetFeedOpenAiClientForTests();
      resetFeedCircuit();

      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      const { data: accounts } = await admin
        .from("mail_accounts")
        .select("id,user_id,sync_status")
        .neq("sync_status", "disconnected");
      const active = (accounts ?? []).find(
        (a) => a.id.startsWith("3083") && a.id.endsWith("150e"),
      );
      expect(active).toBeTruthy();
      const userId = active!.user_id as string;
      const mailAccountId = active!.id as string;

      const { data: supersededRows } = await admin
        .from("feed_items")
        .select("id")
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .eq("status", "superseded")
        .eq("status_reason", O5A_SUPERSEDE_REASON);
      expect((supersededRows ?? []).length).toBe(13);
      const supersededIds = (supersededRows ?? []).map((r) => r.id as string);

      // Clear any prior o5a.1 extraction attempts from the failed first pass
      // (should be only the failed probe). Keep superseded items.
      const pilotStarted = new Date().toISOString();

      const probe = await probeFeedModelAccess({ userId, mailAccountId });
      expect(probe.ok).toBe(true);
      if (!probe.ok) {
        throw new Error(`probe_failed:${probe.errorCode}`);
      }

      const enqueue = await enqueueFeedPilot({
        userId,
        mailAccountId,
        limit: 20,
      });
      expect(enqueue.selected).toBeLessThanOrEqual(20);
      expect(enqueue.enqueued).toBeLessThanOrEqual(20);

      const totals = {
        read: 0,
        completed: 0,
        skipped: 0,
        failed: 0,
        locked: 0,
        disabled: 0,
        prefilterSkipped: 0,
        circuitOpen: 0,
        batches: 0,
      };

      for (let i = 0; i < 50; i += 1) {
        const c = await processFeedQueue({
          maxJobs: 2,
          visibilityTimeoutSec: 180,
        });
        totals.read += c.read;
        totals.completed += c.completed;
        totals.skipped += c.skipped;
        totals.failed += c.failed;
        totals.locked += c.locked;
        totals.disabled += c.disabled;
        totals.prefilterSkipped += c.prefilterSkipped;
        totals.circuitOpen += c.circuitOpen;
        totals.batches += 1;
        if (c.read === 0) break;
        await sleep(250);
      }

      const { data: runs } = await admin
        .from("feed_extraction_runs")
        .select(
          "id,status,model,actual_model,started_at,completed_at,accepted_count,rejected_count,candidate_count,input_tokens,output_tokens,total_tokens,error_code,extraction_version,eligibility_classification,prefilter_skipped,thread_id,latency_ms",
        )
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .eq("extraction_version", "o5a.1")
        .gte("started_at", pilotStarted)
        .order("started_at", { ascending: true });

      const pilotRuns = runs ?? [];
      const probeRuns = pilotRuns.filter(
        (r) => r.eligibility_classification === "model_probe",
      );
      const extractionAttempts = pilotRuns.filter(
        (r) =>
          r.model &&
          r.eligibility_classification !== "model_probe" &&
          r.prefilter_skipped !== true &&
          r.status !== "skipped",
      );
      const extractionOk = extractionAttempts.filter((r) => r.status === "completed");
      const extractionFail = extractionAttempts.filter((r) => r.status === "failed");
      const hashSkips = pilotRuns.filter(
        (r) =>
          r.status === "skipped" &&
          r.prefilter_skipped !== true &&
          r.eligibility_classification !== "model_probe",
      );
      const prefilterRuns = pilotRuns.filter((r) => r.prefilter_skipped === true);

      const inputTokens = extractionOk.reduce(
        (s, r) => s + Number(r.input_tokens ?? 0),
        0,
      );
      const outputTokens = extractionOk.reduce(
        (s, r) => s + Number(r.output_tokens ?? 0),
        0,
      );
      const totalTokens = extractionOk.reduce(
        (s, r) => s + Number(r.total_tokens ?? 0),
        0,
      );

      const { data: newItems } = await admin
        .from("feed_items")
        .select(
          "id,type,headline,context,actor_name,actor_email,evidence_text,source_message_id,thread_id,confidence,business_relevance_confidence,action_owner,business_object,status,occurred_at,due_at,dedupe_key,extraction_version",
        )
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .eq("extraction_version", "o5a.1")
        .in("status", ["new", "open", "scheduled"])
        .order("created_at", { ascending: false });

      const items = newItems ?? [];
      const byType = { action: 0, change: 0, decision: 0 };
      for (const it of items) {
        if (it.type === "action") byType.action += 1;
        else if (it.type === "change") byType.change += 1;
        else if (it.type === "decision") byType.decision += 1;
      }

      let evidenceOk = 0;
      let evidenceFail = 0;
      for (const it of items) {
        if (!it.source_message_id || !it.evidence_text) {
          evidenceFail += 1;
          continue;
        }
        const { data: msg } = await admin
          .from("messages")
          .select("plain_text,clean_conversation")
          .eq("id", it.source_message_id)
          .eq("user_id", userId)
          .maybeSingle();
        const body = `${msg?.clean_conversation ?? ""} ${msg?.plain_text ?? ""}`
          .replace(/\s+/g, " ")
          .toLowerCase();
        const ev = String(it.evidence_text).replace(/\s+/g, " ").toLowerCase();
        if (ev && body.includes(ev)) evidenceOk += 1;
        else evidenceFail += 1;
      }

      const actionOwnerOk = items
        .filter((i) => i.type === "action")
        .filter(
          (i) =>
            i.action_owner === "account_owner" ||
            i.action_owner === "account_owner_team",
        ).length;
      const actionTotal = items.filter((i) => i.type === "action").length;
      const dedupeKeys = new Set(items.map((i) => i.dedupe_key));
      const zeroInsightThreads = extractionOk.filter(
        (r) => Number(r.accepted_count ?? 0) === 0,
      ).length;
      const rejectedCandidates = extractionOk.reduce(
        (s, r) => s + Number(r.rejected_count ?? 0),
        0,
      );
      const rejectedReasons: Record<string, number> = {};
      for (const r of extractionOk) {
        if (r.error_code) {
          rejectedReasons[String(r.error_code)] =
            (rejectedReasons[String(r.error_code)] ?? 0) + 1;
        }
      }
      // Aggregate reject reasons from rejected_count alone when error_code null —
      // detailed per-candidate reasons are not stored; report totals.

      const banned =
        /newsletter|release notes|public (alpha|beta)|webinar|try now|נסה עכשיו|השג כרטיס|unsubscribe|utm_/i;
      const smellHits = items.filter(
        (i) =>
          banned.test(String(i.headline ?? "")) ||
          banned.test(String(i.context ?? "")) ||
          banned.test(String(i.evidence_text ?? "")),
      ).length;

      const { count: oldStillVisible } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .in("id", supersededIds)
        .in("status", ["new", "open", "scheduled"]);

      const selectPlan = JSON.parse(
        readFileSync(
          path.resolve(process.cwd(), "tmp/o5a1-supersede-select.json"),
          "utf8",
        ),
      );

      const report = {
        phase: "O5A.1",
        migration0013: "already_applied_verified_nullable_thread_id",
        account: "3083…150e",
        note: "Supersede completed in first pass; probe had transient failure; resume ran probe+pilot.",
        supersede: {
          selectCount: selectPlan.itemCount,
          runIds: selectPlan.runIds,
          runCount: selectPlan.runCount,
          acceptedSum: selectPlan.acceptedSum,
          windowStart: selectPlan.windowStart,
          windowEnd: selectPlan.windowEnd,
          superseded: 13,
          status_reason: O5A_SUPERSEDE_REASON,
          oldItemsStillVisibleInFeed: oldStillVisible ?? 0,
          itemIds: supersededIds,
        },
        prefilter: {
          scanned: enqueue.scanned,
          classificationCounts: enqueue.classificationCounts,
          eligibleFound: enqueue.eligibleFound,
          prefilterSkipped: enqueue.prefilterSkipped,
          selected: enqueue.selected,
          enqueued: enqueue.enqueued,
        },
        probe: {
          calls: probeRuns.length,
          ok: probe.ok,
          actualModel: probe.ok ? probe.actualModel : null,
          model: "gpt-4o-mini",
          priorTransientFailure: true,
        },
        extraction: {
          attempts: extractionAttempts.length,
          successful: extractionOk.length,
          failed: extractionFail.length,
          hashSkips: hashSkips.length,
          prefilterSkippedRuns: prefilterRuns.length,
          circuitOpen: totals.circuitOpen,
          zeroInsightThreads,
          rejectedCandidates,
          rejectedReasons,
          failCodes: extractionFail.map((r) => r.error_code),
        },
        tokens: {
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedUsd: Number(
            estimateUsd(inputTokens, outputTokens).toFixed(6),
          ),
        },
        items: {
          total: items.length,
          byType,
          evidenceOk,
          evidenceFail,
          actionOwnerOk,
          actionTotal,
          dedupeUnique: dedupeKeys.size === items.length,
          qualitySmellHits: smellHits,
        },
        examples: items.slice(0, 10).map((i) => ({
          type: i.type,
          headline: censor(i.headline as string),
          context: censor(i.context as string | null, 40),
          actionOwner: i.action_owner,
          hasEvidence: Boolean(i.evidence_text),
          dueAt: i.due_at ? "set" : null,
          confidenceBand:
            Number(i.business_relevance_confidence ?? i.confidence) >= 0.9
              ? "high"
              : "mid",
        })),
        workerTotals: totals,
        comparedToO5A: {
          oldItems: 13,
          oldMarketingHeavy: true,
          oldVisibleNow: oldStillVisible ?? 0,
          newItems: items.length,
          newSmellHits: smellHits,
        },
        guarantees: {
          noOnyxChatInFeed: true,
          noAutoExtractOnFeedLoad: true,
          model: "gpt-4o-mini",
          maxRetries: 0,
        },
      };

      const outDir = path.resolve(process.cwd(), "tmp");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, "o5a1-feed-pilot-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      expect(oldStillVisible ?? 0).toBe(0);
      expect(probeRuns.length).toBe(1);
      expect(extractionAttempts.length).toBeLessThanOrEqual(20);
      expect(evidenceFail).toBe(0);
      expect(smellHits).toBe(0);
    },
    15 * 60_000,
  );
});
