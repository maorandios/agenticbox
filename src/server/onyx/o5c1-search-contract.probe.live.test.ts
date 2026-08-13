/**
 * O5C.1 — one-shot Search contract probe (no chat, no persist, redacted output).
 *   O5C1_PROBE=1 npx vitest run src/server/onyx/o5c1-search-contract.probe.live.test.ts
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const enabled = process.env.O5C1_PROBE === "1";

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

function redactValue(v: unknown): unknown {
  if (typeof v === "string") {
    if (v.length <= 24) return `[str:${v.length}]`;
    return `[str:${v.length}]`;
  }
  if (Array.isArray(v)) return v.slice(0, 3).map(redactValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = redactValue(val);
    }
    return out;
  }
  return v;
}

describe.runIf(enabled)("O5C.1 search contract probe", () => {
  loadEnvLocal();

  it(
    "POST /search once; record redacted shape",
    async () => {
      const baseUrl = (process.env.ONYX_BASE_URL ?? "https://cloud.onyx.app/api")
        .replace(/\/+$/, "");
      // Prefer ingestion (Basic) key for Document Search — not chat.
      const apiKey =
        process.env.ONYX_INGESTION_API_KEY?.trim() ||
        process.env.ONYX_CHAT_API_KEY?.trim() ||
        "";
      expect(apiKey.length).toBeGreaterThan(8);

      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let status = 0;
      let body: unknown = null;
      try {
        const res = await fetch(`${baseUrl}/search`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: "invoice",
            skip_query_expansion: true,
          }),
          signal: controller.signal,
        });
        status = res.status;
        const text = await res.text();
        try {
          body = JSON.parse(text);
        } catch {
          body = { parseError: true, textLength: text.length };
        }
      } finally {
        clearTimeout(timer);
      }
      const latencyMs = Date.now() - started;

      const topKeys =
        body && typeof body === "object" && !Array.isArray(body)
          ? Object.keys(body as object)
          : [];
      const first =
        body &&
        typeof body === "object" &&
        Array.isArray((body as { results?: unknown }).results)
          ? (body as { results: unknown[] }).results[0]
          : null;
      const firstKeys =
        first && typeof first === "object" ? Object.keys(first as object) : [];

      const report = {
        endpoint: "POST /search",
        httpStatus: status,
        latencyMs,
        topLevelKeys: topKeys,
        firstResultKeys: firstKeys,
        resultCount: Array.isArray((body as { results?: unknown })?.results)
          ? ((body as { results: unknown[] }).results.length)
          : null,
        redactedSample: redactValue(body),
        hasDocumentIdInFirstResult: firstKeys.includes("document_id"),
        openApiExpectedResultKeys: [
          "citation_id",
          "title",
          "content",
          "link",
          "source_type",
          "updated_at",
        ],
        desiredOnyxSearchHitKeys: [
          "documentId",
          "semanticIdentifier",
          "link",
          "blurb",
          "metadata",
          "score",
        ],
        mismatch:
          !firstKeys.includes("document_id")
            ? "runtime_SearchResult_lacks_document_id"
            : null,
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5c1-search-contract-probe.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );
      console.log(JSON.stringify(report, null, 2));
      expect(status).toBeGreaterThan(0);
    },
    60_000,
  );
});
