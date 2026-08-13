/**
 * Debug helper — dump reject reason for Idit/Leonid thread.
 *   O5A2_DEBUG=1 npx vitest run src/server/feed/o5a2-debug.live.test.ts
 */
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import {
  buildFeedThreadContext,
  computeDedupeKey,
} from "@/server/feed/context";
import { extractFeedFromContext } from "@/server/feed/extract";
import { getFeedConfig } from "@/server/feed/config";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "@/server/feed/validate";

const enabled = process.env.O5A2_DEBUG === "1";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

describe.runIf(enabled)("O5A.2 debug reject", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.2";

  it(
    "dumps validation reject",
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
        .select("id,user_id")
        .neq("sync_status", "disconnected");
      const active = (accounts ?? []).find(
        (a) => a.id.startsWith("3083") && a.id.endsWith("150e"),
      )!;

      const ctx = await buildFeedThreadContext({
        userId: active.user_id as string,
        mailAccountId: active.id as string,
        threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
        triggerMessageId: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
      });
      if (!ctx) throw new Error("no_ctx");

      const src = ctx.messages.find(
        (m) => m.id === "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
      );
      const ai = await extractFeedFromContext(ctx);
      if (!ai.ok) throw new Error(ai.errorCode);
      const gate = validateExtractionGate({ result: ai.parsed });
      const config = getFeedConfig();
      const { accepted, rejected } = validateFeedCandidates({
        candidates: gate.ok ? ai.parsed.items : [],
        messages: ctx.messages,
        accountIdentities: ctx.accountIdentities,
        minConfidence: config.minConfidence,
        minBusinessRelevance: config.minBusinessRelevance,
        existingDedupeKeys: new Set(),
        computeDedupeKey: (c) =>
          computeDedupeKey({
            userId: active.user_id as string,
            threadId: ctx.threadId,
            sourceMessageId: c.sourceMessageId,
            type: c.type,
            evidenceText: c.evidenceText,
          }),
      });

      const out = {
        gate,
        sourceBody: src?.body ?? null,
        sourceFrom: src?.fromEmail ?? null,
        sourceTo: src?.toEmails ?? null,
        parsed: ai.parsed,
        accepted,
        rejected: rejected.map((r) => ({
          reason: r.reason,
          candidate: r.candidate,
        })),
      };
      const dir = path.resolve(process.cwd(), "tmp");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "o5a2-debug-reject.json"),
        JSON.stringify(out, null, 2),
        "utf8",
      );
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        gateOk: gate.ok,
        rejected: rejected.map((r) => r.reason),
        accepted: accepted.length,
        headline: ai.parsed.items[0]?.headline,
        dueAt: ai.parsed.items[0]?.dueAt,
        assignee: ai.parsed.items[0]?.assignee,
        requester: ai.parsed.items[0]?.requester,
      }, null, 2));
    },
    120_000,
  );
});
