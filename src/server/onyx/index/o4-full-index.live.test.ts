/**
 * O4 full-account index (active business account only).
 *   O4_FULL_INDEX=1 npm run test -- src/server/onyx/index/o4-full-index.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { enqueueAllAccountThreads } from "@/server/onyx/index/enqueue";
import { processOnyxQueue } from "@/server/onyx/index/worker";
import { getIndexProgress } from "@/server/onyx/index/progress";

const enabled = process.env.O4_FULL_INDEX === "1";

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
      key.startsWith("ONYX_") ||
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

function censorId(id: string) {
  return id.length < 10 ? "***" : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

describe.runIf(enabled)("O4 full account index", () => {
  loadEnvLocal();
  process.env.ONYX_ENABLED = "true";

  it(
    "indexes remaining threads to 100 for active business account",
    async () => {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      const { data: accounts } = await admin
        .from("mail_accounts")
        .select("id,user_id,sync_status")
        .neq("sync_status", "disconnected")
        .order("updated_at", { ascending: false });
      const active = (accounts ?? []).find(
        (a) => a.id.startsWith("3083") && a.id.endsWith("150e"),
      );
      expect(active).toBeTruthy();
      expect((accounts ?? []).length).toBe(1);

      const userId = active!.user_id as string;
      const mailAccountId = active!.id as string;

      const { data: threads } = await admin
        .from("threads")
        .select("id")
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId);
      expect((threads ?? []).length).toBe(100);

      const enqueueResult = await enqueueAllAccountThreads({
        userId,
        mailAccountId,
        includeExcludedFolders: true,
      });
      const enqueued = enqueueResult.enqueued;
      const skippedQueued = enqueueResult.skippedQueued;
      const skippedExcluded = enqueueResult.skippedExcluded;

      const started = Date.now();
      const totals = {
        read: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        retried: 0,
        batches: 0,
      };

      for (let i = 0; i < 80; i += 1) {
        const c = await processOnyxQueue({ maxJobs: 3, visibilityTimeoutSec: 180 });
        totals.batches += 1;
        totals.read += c.read;
        totals.indexed += c.indexed;
        totals.skipped += c.skipped;
        totals.failed += c.failed;
        totals.retried += c.retried;
        if (c.read === 0 && c.retried === 0) {
          const progress = await getIndexProgress({ userId, mailAccountId });
          if (progress.pending === 0 && progress.processing === 0) break;
        }
        await sleep(500);
      }

      // Drain retries if any
      if (totals.retried > 0 || totals.failed > 0) {
        await sleep(3000);
        for (let i = 0; i < 40; i += 1) {
          const c = await processOnyxQueue({ maxJobs: 3 });
          totals.batches += 1;
          totals.read += c.read;
          totals.indexed += c.indexed;
          totals.skipped += c.skipped;
          totals.failed += c.failed;
          totals.retried += c.retried;
          if (c.read === 0) break;
          await sleep(500);
        }
      }

      const durationMs = Date.now() - started;
      const progress = await getIndexProgress({ userId, mailAccountId });

      const report = {
        mailAccountId: censorId(mailAccountId),
        enqueued,
        skippedQueued,
        skippedExcluded,
        worker: totals,
        durationMs,
        progress,
      };
      writeFileSync(
        path.resolve(process.cwd(), "tmp/o4-full-index-report.json"),
        JSON.stringify(report, null, 2),
      );

      expect(progress.total).toBe(100);
      expect(progress.pending).toBe(0);
      expect(progress.processing).toBe(0);
      // Allow empty-body threads as failed with documentation
      expect(progress.indexed + progress.failed).toBe(100);
      expect(progress.indexed).toBeGreaterThanOrEqual(95);
    },
    900_000,
  );
});
