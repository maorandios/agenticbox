/**
 * Optional live contract test.
 * Does not run in default CI.
 *
 * Enable with:
 *   ONYX_LIVE_CONTRACT=1 npm run test -- src/server/onyx/contract.live.test.ts
 *
 * Uses .env.local keys. Synthetic document only. Never prints secrets.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  ask,
  deleteDocument,
  healthCheck,
  upsertDocument,
} from "@/server/onyx/adapter";

const enabled = process.env.ONYX_LIVE_CONTRACT === "1";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    // Live contract always prefers .env.local for ONYX_* (without printing).
    if (key.startsWith("ONYX_") || !(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe.runIf(enabled)("onyx live contract (synthetic)", () => {
  loadEnvLocal();
  process.env.ONYX_ENABLED = "true";

  const docId = `agenticbox-o2-synth-${Date.now()}`;
  const fact = `O2-TOKEN-${Date.now().toString(36).toUpperCase()}`;
  const city = "נמל־בדיקה";

  afterAll(async () => {
    try {
      await deleteDocument(docId);
    } catch {
      // best-effort cleanup
    }
  });

  it(
    "health + upsert + rag ask + follow-up + delete",
    async () => {
      const health = await healthCheck();
      expect(health.ok).toBe(true);

      const upsert = await upsertDocument({
        id: docId,
        semanticIdentifier: "AgenticBox O2 Synthetic",
        title: "AgenticBox O2 Synthetic",
        sections: [
          {
            text: `מסמך סינתטי O2. הקוד הוא ${fact}. העיר היא ${city}. אין PII.`,
            link: `https://agenticbox.local/o2/${docId}`,
          },
        ],
        metadata: { source_type: "email_thread_test", phase: "O2" },
      });
      expect(upsert.documentId).toBe(docId);

      let answered = null as Awaited<ReturnType<typeof ask>> | null;
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const result = await ask({
          question:
            "לפי מסמכי הבדיקה הסינתטיים של AgenticBox O2 בלבד: מהו הקוד ומהי העיר? ענה בעברית.",
        });
        if (
          result.status === "answered" &&
          result.sources.some((s) => s.documentId === docId) &&
          result.answer.includes(fact)
        ) {
          answered = result;
          break;
        }
        await sleep(2500);
      }

      expect(answered).not.toBeNull();
      expect(answered!.status).toBe("answered");
      expect(answered!.sources.some((s) => s.documentId === docId)).toBe(true);
      expect(answered!.chatSessionId).toBeTruthy();

      const follow = await ask({
        question: "מהי העיר הסינתטית באותו מסמך בדיקה של AgenticBox O2? ענה בעברית וציין מקור.",
        chatSessionId: answered!.chatSessionId,
      });
      expect(follow.chatSessionId).toBe(answered!.chatSessionId);
      // Policy: answered requires citations. If Onyx replies from session memory
      // without citation_info, adapter correctly returns insufficient_evidence.
      expect(["answered", "insufficient_evidence"]).toContain(follow.status);
      if (follow.status === "answered") {
        expect(follow.sources.some((s) => s.documentId === docId)).toBe(true);
      }

      const deleted = await deleteDocument(docId);
      expect(deleted.deleted).toBe(true);

      // idempotent delete
      const deletedAgain = await deleteDocument(docId);
      expect(deletedAgain.deleted).toBe(true);
    },
    180_000,
  );
});

describe.runIf(!enabled)("onyx live contract skipped by default", () => {
  it("does not run unless ONYX_LIVE_CONTRACT=1", () => {
    expect(enabled).toBe(false);
  });
});
