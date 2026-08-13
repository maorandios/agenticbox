/**
 * O5A.6.6 — Professional titles from saved O5A.6.4/6.5 cards (no OpenAI, no persist).
 *   O5A66_TITLES=1 npx vitest run src/server/feed/blind/o5a66-professional-titles.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildFeedThreadContext } from "@/server/feed/context";
import { extractCurrentMessageLead } from "@/server/feed/evidence-match";
import { applyProfessionalTitleGate } from "@/server/feed/professional-title";
import type { RequestSpeechAct } from "@/server/feed/speech-act";

const enabled = process.env.O5A66_TITLES === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const EXTRACTION_VERSION = "o5a.6_real_inbox_review";

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

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

describe.runIf(enabled)("O5A.6.6 professional titles", () => {
  loadEnvLocal();

  it(
    "normalizes four saved cards; feed_items unchanged",
    async () => {
      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });

      const o5a65 = JSON.parse(
        readFileSync(path.join(tmpDir, "o5a65-title-quality-gate.json"), "utf8"),
      ) as {
        cards: Array<{
          threadId: string;
          finalTitle: string;
          modelOrFallbackTitle: string;
          requestEvidenceOriginal: string;
          businessObjectEvidence: string | null;
          contextEvidence: string | null;
          requesterEmail: string | null;
          assigneeEmail: string | null;
          relationToMailbox: string | null;
        }>;
      };

      const sb = adminClient();
      const { count: feedBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      const { data: pilotBefore } = await sb
        .from("feed_items")
        .select("id")
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      const cards: Array<Record<string, unknown>> = [];
      for (const saved of o5a65.cards) {
        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: saved.threadId,
        });
        expect(ctx).toBeTruthy();
        const current = ctx!.messages[ctx!.messages.length - 1]!;
        const prior =
          ctx!.messages.length > 1
            ? ctx!.messages[ctx!.messages.length - 2]
            : null;
        const from = current.fromName;

        const gate = applyProfessionalTitleGate({
          title: String(saved.finalTitle),
          speechAct: null as RequestSpeechAct | null,
          requestEvidence: String(saved.requestEvidenceOriginal),
          businessObjectEvidence: saved.businessObjectEvidence,
          contextEvidence:
            saved.contextEvidence ??
            (prior ? extractCurrentMessageLead(prior.body).slice(0, 200) : null),
          subject: current.subject ?? ctx!.subject,
          body: current.body,
          requesterCanonicalName: from,
        });

        cards.push({
          threadId: saved.threadId,
          requesterEmail: saved.requesterEmail,
          assigneeEmail: saved.assigneeEmail,
          relationToMailbox: saved.relationToMailbox,
          previousTitle: saved.finalTitle,
          finalTitle: gate.finalTitle,
          requestEvidenceOriginal: gate.requestEvidenceOriginal,
          requestEvidenceNormalized: gate.requestEvidenceNormalized,
          businessObjectEvidence: gate.businessObjectEvidence,
          contextEvidence: gate.contextEvidence,
          requesterCanonicalName: gate.requesterCanonicalName,
          checks: gate.checks,
          status: gate.status,
          ready_for_persist: gate.status === "ready_for_persist",
          needs_human_review: gate.status === "needs_human_review",
          currentLead: extractCurrentMessageLead(current.body).slice(0, 200),
        });
      }

      const { count: feedAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      const { data: pilotAfter } = await sb
        .from("feed_items")
        .select("id")
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      expect(feedAfter).toBe(feedBefore);
      expect(feedBefore).toBe(36);
      expect((pilotAfter ?? []).map((r) => r.id).sort()).toEqual(
        (pilotBefore ?? []).map((r) => r.id).sort(),
      );

      const report = {
        evaluationVersion: "o5a6.6_professional_titles",
        status: "AWAITING FINAL APPROVAL FOR CONTROLLED PERSIST",
        constraints: {
          noPersist: true,
          noOpenAi: true,
          noActionDetectionChange: true,
          noO5B: true,
          domainAgnostic: true,
        },
        cards,
        feedItems: {
          before: feedBefore ?? 0,
          after: feedAfter ?? 0,
          unchanged: feedBefore === feedAfter,
        },
        summary: {
          readyForPersist: cards.filter((c) => c.ready_for_persist).length,
          needsHumanReview: cards.filter((c) => c.needs_human_review).length,
        },
      };

      writeFileSync(
        path.join(tmpDir, "o5a66-professional-titles.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md: string[] = [];
      md.push("# O5A.6.6 — Standalone Professional Title Normalization");
      md.push("");
      md.push("Status: **AWAITING FINAL APPROVAL FOR CONTROLLED PERSIST**");
      md.push("");
      md.push("No OpenAI. No Persist. No O5B.");
      md.push("");
      md.push("## Four normalized titles");
      md.push("");
      for (const c of cards) {
        md.push(`### ${String(c.threadId).slice(0, 8)}…`);
        md.push(`- previous: ${c.previousTitle}`);
        md.push(`- finalTitle: **${c.finalTitle}**`);
        md.push(`- ${c.requesterEmail} → ${c.assigneeEmail}`);
        md.push(`- requestEvidence (unchanged quote): ${c.requestEvidenceOriginal}`);
        md.push(`- businessObjectEvidence: ${c.businessObjectEvidence}`);
        md.push(`- checks: ${JSON.stringify(c.checks)}`);
        md.push(`- status: \`${c.status}\``);
        md.push("");
      }
      md.push("## Regression");
      md.push("");
      md.push(`- feed_items: ${feedBefore} → ${feedAfter}`);
      md.push("- pilot cards unchanged");
      md.push("");
      md.push(
        `## Summary: ready=${report.summary.readyForPersist}, needs_human_review=${report.summary.needsHumanReview}`,
      );
      md.push("");
      md.push("**AWAITING FINAL APPROVAL FOR CONTROLLED PERSIST**");
      md.push("");

      writeFileSync(
        path.join(tmpDir, "o5a66-professional-titles.md"),
        md.join("\n"),
        "utf8",
      );

      expect(cards).toHaveLength(4);
      expect(
        cards.every((c) => c.requestEvidenceOriginal === c.requestEvidenceOriginal),
      ).toBe(true);
      for (const c of cards) {
        expect(String(c.finalTitle)).not.toMatch(/\b(בבקשה|נא|אשמח|היי|וכו)\b/u);
        expect(String(c.finalTitle)).not.toMatch(/איתי|לגבי זה|את זה/);
      }
    },
    120_000,
  );
});
