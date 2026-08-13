/**
 * O5A.6.2 — write zero-insight audit artifacts (no OpenAI).
 *   O5A62_AUDIT=1 npx vitest run src/server/feed/blind/o5a62-audit.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeO5a62AuditFiles } from "./o5a62-audit";

const enabled = process.env.O5A62_AUDIT === "1";

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
      key.startsWith("SUPABASE_") ||
      key.startsWith("NEXT_PUBLIC_SUPABASE_") ||
      !(key in process.env) ||
      process.env[key] === ""
    ) {
      process.env[key] = value;
    }
  }
}

describe.runIf(enabled)("O5A.6.2 zero-insight audit", () => {
  loadEnvLocal();

  it(
    "builds read-only audit for 20 zeros + failed timeout",
    async () => {
      const payload = await writeO5a62AuditFiles();
      expect(payload.zeroInsightCount).toBe(20);
      expect(payload.cards).toHaveLength(20);
      expect(payload.coverageAll30).toHaveLength(30);
      expect(payload.constraints.noOpenAI).toBe(true);
      expect(payload.constraints.noFeedWrites).toBe(true);
      expect(payload.status).toBe(
        "AWAITING HUMAN LABELING OF O5A.6 ZERO-INSIGHT THREADS",
      );
      expect(existsSync(path.resolve("tmp/o5a62-zero-insight-audit.json"))).toBe(
        true,
      );
      expect(existsSync(path.resolve("tmp/o5a62-zero-insight-audit.md"))).toBe(
        true,
      );
    },
    120_000,
  );
});
