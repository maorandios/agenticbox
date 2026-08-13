/**
 * O5A Feed Pilot (max 20 threads, 1 OpenAI call each).
 *   O5A_FEED_PILOT=1 npm run test -- src/server/feed/o5a-pilot.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { enqueueFeedPilot } from "@/server/feed/enqueue";
import { processFeedQueue } from "@/server/feed/worker";
import { processFeedExtractJob } from "@/server/feed/process";

const enabled = process.env.O5A_FEED_PILOT === "1";

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
  if (cleaned.length <= max) return cleaned.replace(/[^\u0590-\u05FF\w\s.,:\-]/g, "•");
  return `${cleaned.slice(0, max).replace(/[^\u0590-\u05FF\w\s.,:\-]/g, "•")}…`;
}

describe.runIf(enabled)("O5A feed pilot", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";

  it(
    "extracts up to 20 active-account threads with one OpenAI call each",
    async () => {
      expect(process.env.OPENAI_API_KEY?.length ?? 0).toBeGreaterThan(20);
      expect(process.env.FEED_AI_ENABLED).toBe("true");

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
      expect((accounts ?? []).length).toBe(1);

      const userId = active!.user_id as string;
      const mailAccountId = active!.id as string;

      const enqueue = await enqueueFeedPilot({
        userId,
        mailAccountId,
        limit: 20,
      });
      expect(enqueue.selected).toBeLessThanOrEqual(20);
      expect(enqueue.enqueued).toBeLessThanOrEqual(20);

      const started = Date.now();
      const totals = {
        read: 0,
        completed: 0,
        skipped: 0,
        failed: 0,
        locked: 0,
        disabled: 0,
        batches: 0,
      };

      for (let i = 0; i < 40; i += 1) {
        const c = await processFeedQueue({ maxJobs: 2, visibilityTimeoutSec: 180 });
        totals.batches += 1;
        totals.read += c.read;
        totals.completed += c.completed;
        totals.skipped += c.skipped;
        totals.failed += c.failed;
        totals.locked += c.locked;
        totals.disabled += c.disabled;
        if (c.read === 0 && c.locked === 0) break;
        await sleep(400);
      }

      const durationMs = Date.now() - started;

      const { data: runs } = await admin
        .from("feed_extraction_runs")
        .select(
          "id,thread_id,status,model,openai_response_id,input_tokens,output_tokens,total_tokens,candidate_count,accepted_count,rejected_count,context_coverage,latency_ms,error_code,source_content_hash",
        )
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .order("started_at", { ascending: false })
        .limit(80);

      const pilotRuns = (runs ?? []).slice(0, 40);
      // Count actual AI attempts: completed/failed with model set and not skipped
      const aiAttempts = pilotRuns.filter(
        (r) => r.model && r.status !== "skipped" && r.status !== "pending",
      );

      expect(aiAttempts.length).toBeLessThanOrEqual(20);

      const { data: items } = await admin
        .from("feed_items")
        .select(
          "id,type,headline,context,actor_name,actor_email,evidence_text,source_message_id,thread_id,confidence,status,occurred_at,due_at,dedupe_key",
        )
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .order("created_at", { ascending: false })
        .limit(200);

      const byType: Record<string, number> = {
        action: 0,
        change: 0,
        decision: 0,
        due: 0,
      };
      for (const item of items ?? []) {
        const t = String(item.type);
        if (t in byType) byType[t] += 1;
      }

      // Evidence validation sample
      let evidenceOk = 0;
      let evidenceFail = 0;
      const sample = (items ?? []).slice(0, 30);
      for (const item of sample) {
        const mid = item.source_message_id as string | null;
        if (!mid) {
          evidenceFail += 1;
          continue;
        }
        const { data: msg } = await admin
          .from("messages")
          .select("id,thread_id,plain_text,clean_conversation,user_id")
          .eq("user_id", userId)
          .eq("id", mid)
          .maybeSingle();
        if (!msg || msg.thread_id !== item.thread_id) {
          evidenceFail += 1;
          continue;
        }
        const body = `${msg.clean_conversation ?? ""} ${msg.plain_text ?? ""}`
          .replace(/\s+/g, " ")
          .toLowerCase();
        const evidence = String(item.evidence_text ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (evidence && body.includes(evidence)) evidenceOk += 1;
        else evidenceFail += 1;
      }

      // Idempotency: re-process first completed thread — expect skipped, no new AI
      const completed = pilotRuns.find((r) => r.status === "completed");
      let idempotency: Record<string, unknown> = { ran: false };
      if (completed) {
        const beforeCalls = aiAttempts.length;
        const result = await processFeedExtractJob({
          type: "feed_extract_thread",
          userId,
          mailAccountId,
          threadId: completed.thread_id as string,
          triggerMessageId: null,
        });
        const { data: afterRuns } = await admin
          .from("feed_extraction_runs")
          .select("id,status,model,openai_response_id")
          .eq("user_id", userId)
          .eq("thread_id", completed.thread_id)
          .order("started_at", { ascending: false })
          .limit(3);
        idempotency = {
          ran: true,
          result,
          latestStatus: afterRuns?.[0]?.status ?? null,
          noNewOpenAiId:
            result === "skipped" ||
            !(afterRuns?.[0]?.openai_response_id && afterRuns[0].status === "completed" && afterRuns[0].id !== completed.id && afterRuns[0].openai_response_id !== completed.openai_response_id),
          beforeAiAttempts: beforeCalls,
        };
        expect(result).toBe("skipped");
      }

      const inputTokens = aiAttempts.reduce(
        (s, r) => s + Number(r.input_tokens ?? 0),
        0,
      );
      const outputTokens = aiAttempts.reduce(
        (s, r) => s + Number(r.output_tokens ?? 0),
        0,
      );
      const totalTokens = aiAttempts.reduce(
        (s, r) => s + Number(r.total_tokens ?? 0),
        0,
      );
      const latencies = aiAttempts
        .map((r) => Number(r.latency_ms ?? 0))
        .filter((n) => n > 0);
      const avgLatency =
        latencies.length > 0
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0;

      // gpt-4o-mini approximate public rates (report only, not in product code)
      // input $0.15 / 1M, output $0.60 / 1M (as of commonly published pricing)
      const estimatedUsd =
        (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.6;

      const zeroInsightThreads = aiAttempts.filter(
        (r) => r.status === "completed" && Number(r.accepted_count ?? 0) === 0,
      ).length;

      const hashSkips = pilotRuns.filter((r) => r.status === "skipped").length;

      const rejectedTotal = aiAttempts.reduce(
        (s, r) => s + Number(r.rejected_count ?? 0),
        0,
      );
      const candidatesTotal = aiAttempts.reduce(
        (s, r) => s + Number(r.candidate_count ?? 0),
        0,
      );

      const examples = (items ?? []).slice(0, 10).map((item) => ({
        type: item.type,
        headline: censor(String(item.headline ?? ""), 60),
        context: censor(String(item.context ?? ""), 50),
        hasActor: Boolean(item.actor_name || item.actor_email),
        hasEvidence: Boolean(item.evidence_text),
        confidenceBand:
          Number(item.confidence) >= 0.9
            ? "high"
            : Number(item.confidence) >= 0.8
              ? "mid"
              : "low",
        status: item.status,
      }));

      // Duplicate dedupe_key check
      const keys = (items ?? []).map((i) => i.dedupe_key as string);
      const uniqueKeys = new Set(keys);

      const report = {
        account: "3083…150e",
        enqueue,
        worker: totals,
        durationMs,
        openaiCalls: aiAttempts.length,
        hashSkips,
        tokens: { inputTokens, outputTokens, totalTokens },
        estimatedUsd: Number(estimatedUsd.toFixed(4)),
        latencyMs: {
          avg: avgLatency,
          min: latencies.length ? Math.min(...latencies) : 0,
          max: latencies.length ? Math.max(...latencies) : 0,
        },
        itemsByType: byType,
        itemsTotal: (items ?? []).length,
        candidatesTotal,
        rejectedTotal,
        zeroInsightThreads,
        evidenceCheck: {
          sampled: sample.length,
          ok: evidenceOk,
          fail: evidenceFail,
        },
        dedupeKeysUnique: keys.length === uniqueKeys.size,
        idempotency,
        contextCoverage: {
          full: aiAttempts.filter((r) => r.context_coverage === "full").length,
          truncated: aiAttempts.filter((r) => r.context_coverage === "truncated")
            .length,
        },
        failures: aiAttempts
          .filter((r) => r.status === "failed")
          .map((r) => r.error_code),
        examples,
      };

      writeFileSync(
        path.resolve(process.cwd(), "tmp/o5a-feed-pilot-report.json"),
        JSON.stringify(report, null, 2),
      );

      expect(evidenceFail).toBe(0);
      expect(keys.length).toBe(uniqueKeys.size);
      expect(aiAttempts.length).toBeLessThanOrEqual(20);
    },
    900_000,
  );
});
