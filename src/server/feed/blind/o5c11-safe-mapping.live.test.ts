/**
 * O5C.1.1 — Single live Search + safe link mapping probe (no Chat/OpenAI/Persist).
 *   O5C11_PROBE=1 npx vitest run src/server/feed/blind/o5c11-safe-mapping.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { searchDocuments } from "@/server/onyx/search";
import { mapSearchHitsToOwnedThreads } from "@/server/feed/map-search-hits";
import { parseInternalThreadSourceLink } from "@/server/feed/internal-source-link";

const enabled = process.env.O5C11_PROBE === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";

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

describe.runIf(enabled)("O5C.1.1 safe mapping live probe", () => {
  loadEnvLocal();

  it(
    "one Search; map via internal links + ownership",
    async () => {
      process.env.ONYX_ENABLED = "true";
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );

      const { data: indexed } = await admin
        .from("onyx_index_state")
        .select("thread_id,onyx_document_id,status")
        .eq("user_id", USER_ID)
        .eq("mail_account_id", MAIL_ACCOUNT_ID)
        .eq("status", "indexed")
        .limit(1);

      expect(indexed?.length).toBeGreaterThan(0);
      const seedThread = indexed![0]!.thread_id as string;

      const search = await searchDocuments({
        query: "email",
        maxResults: 10,
        skipQueryExpansion: true,
      });

      const validInternalLinks = search.hits.filter((h) =>
        Boolean(parseInternalThreadSourceLink(h.link)),
      ).length;

      const mapped = await mapSearchHitsToOwnedThreads({
        hits: search.hits,
        userId: USER_ID,
        mailAccountId: MAIL_ACCOUNT_ID,
        currentThreadId: "00000000-0000-4000-8000-000000000099",
        requireIngestionSourceType: true,
      });

      const report = {
        evaluationVersion: "o5c.1.1_safe_search_mapping",
        status:
          mapped.stats.mappedHits >= 1
            ? "O5C.1.1 SAFE CONTEXT MAPPING READY"
            : validInternalLinks === 0
              ? "BLOCKED_NO_VALID_INTERNAL_LINKS"
              : "BLOCKED_NO_OWNERSHIP_MATCH",
        audit: {
          indexerLinkFormat: "/source/thread/{threadId}?message={messageId}",
          linkFromEmailBody: false,
        },
        live: {
          latencyMs: search.latencyMs,
          totalHits: mapped.stats.totalHits,
          validInternalLinks: mapped.stats.validInternalLinks,
          ownershipVerified: mapped.stats.ownershipVerified,
          mappedHits: mapped.stats.mappedHits,
          filteredReasons: mapped.stats.filtered,
          seedThreadPresentInIndex: Boolean(seedThread),
          openaiCalls: 0,
          onyxChatCalls: 0,
          dbWrites: 0,
        },
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5c11-safe-search-mapping.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md = [
        "# O5C.1.1 — Safe Link-Based Search Mapping",
        "",
        `Status: **${report.status}**`,
        "",
        "## Audit",
        "- Indexer link: `/source/thread/{threadId}?message={messageId}` (canonical, not from email body)",
        "",
        "## Live probe (redacted)",
        `- latencyMs: ${report.live.latencyMs}`,
        `- totalHits: ${report.live.totalHits}`,
        `- validInternalLinks: ${report.live.validInternalLinks}`,
        `- ownershipVerified: ${report.live.ownershipVerified}`,
        `- mappedHits: ${report.live.mappedHits}`,
        `- filtered: ${JSON.stringify(report.live.filteredReasons)}`,
        `- OpenAI: 0`,
        `- Onyx Chat: 0`,
        `- DB writes: 0`,
        "",
        "**STOP — do not start O5C.2.**",
        "",
      ].join("\n");
      writeFileSync(path.join(tmpDir, "o5c11-safe-search-mapping.md"), md, "utf8");

      if (validInternalLinks === 0) {
        expect(mapped.stats.mappedHits).toBe(0);
        return;
      }
      expect(mapped.stats.mappedHits).toBeGreaterThanOrEqual(1);
      expect(
        mapped.mapped.every((m) => m.onyxDocumentId.startsWith("user:")),
      ).toBe(true);
    },
    90_000,
  );
});
