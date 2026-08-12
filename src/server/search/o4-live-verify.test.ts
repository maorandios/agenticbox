/**
 * Slim O4 live smoke (3 asks + filter probe + quality sample).
 *   O4_LIVE_VERIFY=1 npm run test -- src/server/search/o4-live-verify.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ask } from "@/server/onyx/adapter";
import { askMailboxQuestion } from "@/server/search/ask";
import { buildNormalizedThreadDocument } from "@/server/onyx/index/load-thread";

const enabled = process.env.O4_LIVE_VERIFY === "1";

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

describe.runIf(enabled)("O4 live verify", () => {
  loadEnvLocal();
  process.env.ONYX_ENABLED = "true";
  process.env.ONYX_MAX_RETRIES = "1";
  process.env.ONYX_TIMEOUT_MS = "90000";

  it(
    "metadata filters + ownership + quality sample",
    async () => {
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

      const wrongAccountId = "00000000-0000-0000-0000-000000000000";
      let filterReport: Record<string, unknown>;
      try {
        const filtered = await ask({
          question: "מה דורש ממני טיפול?",
          metadataFilters: [
            { tag_key: "user_id", tag_value: userId },
            { tag_key: "mail_account_id", tag_value: wrongAccountId },
          ],
        });
        filterReport = {
          acceptedByApi: true,
          status: filtered.status,
          sourceCount: filtered.sources.length,
          anyWrongAccountLeak: filtered.sources.some((s) =>
            s.documentId.includes(wrongAccountId),
          ),
          note: "Tags accepted; not a Production multi-tenant boundary. Server ownership required.",
        };
      } catch (error) {
        filterReport = {
          acceptedByApi: false,
          error: error instanceof Error ? error.message.slice(0, 80) : "unknown",
          note: "Filter probe failed/timed out; ownership validation remains mandatory.",
        };
      }

      const questions = [
        "מה דורש ממני טיפול?",
        "What meeting time changed recently?",
        "מה לא קיים בתיבה לגבי נושא בדיוני-בדיקה-12345?",
      ];

      const askResults: Array<Record<string, unknown>> = [];
      const latencies: number[] = [];
      for (const q of questions) {
        const result = await askMailboxQuestion({ userId, question: q });
        latencies.push(result.latencyMs);
        askResults.push({
          categoryHint: q.includes("12345")
            ? "nonexistent"
            : /[A-Za-z]/.test(q) && !/[\u0590-\u05FF]/.test(q)
              ? "english"
              : "hebrew",
          status: result.status,
          sourceCount: result.sources.length,
          latencyMs: result.latencyMs,
          answeredWithoutSources:
            result.status === "answered" && result.sources.length === 0,
          allSourcesHaveThread: result.sources.every((s) => Boolean(s.threadId)),
        });
      }

      const { data: sampleStates } = await admin
        .from("onyx_index_state")
        .select("thread_id")
        .eq("mail_account_id", mailAccountId)
        .eq("status", "indexed")
        .limit(10);

      let quotedDupSignals = 0;
      let signatureDupSignals = 0;
      for (const row of sampleStates ?? []) {
        const doc = await buildNormalizedThreadDocument({
          userId,
          mailAccountId,
          threadId: row.thread_id as string,
        });
        if (!doc) continue;
        const text = doc.sections.map((s) => s.text).join("\n");
        if ((text.match(/^(On .* wrote:|ב־.*כתב:)/gim) ?? []).length >= 2) {
          quotedDupSignals += 1;
        }
        if (
          (text.match(/(בברכה|Best regards|Sent from my iPhone)/gi) ?? []).length >=
          2
        ) {
          signatureDupSignals += 1;
        }
      }

      const avg =
        latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length);
      const report = {
        filterReport,
        askSmoke: {
          count: askResults.length,
          answered: askResults.filter((r) => r.status === "answered").length,
          insufficient: askResults.filter(
            (r) => r.status === "insufficient_evidence",
          ).length,
          failed: askResults.filter((r) => r.status === "failed").length,
          answeredWithoutSources: askResults.filter((r) => r.answeredWithoutSources)
            .length,
          citationMappingOk: askResults.every((r) => r.allSourcesHaveThread),
          latencyMs: {
            avg: Math.round(avg),
            min: Math.min(...latencies),
            max: Math.max(...latencies),
          },
          results: askResults,
        },
        qualitySample: {
          sampled: sampleStates?.length ?? 0,
          threadsWithRepeatedQuoteMarkers: quotedDupSignals,
          threadsWithRepeatedSignatureMarkers: signatureDupSignals,
        },
      };
      writeFileSync(
        path.resolve(process.cwd(), "tmp/o4-live-verify-report.json"),
        JSON.stringify(report, null, 2),
      );

      expect(report.askSmoke.answeredWithoutSources).toBe(0);
      expect(report.askSmoke.citationMappingOk).toBe(true);
    },
    900_000,
  );
});
