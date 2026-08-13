/**
 * O5A.6.5 — Title quality gate on four recovered actions (no OpenAI, no persist).
 *   O5A65_TITLE=1 npx vitest run src/server/feed/blind/o5a65-title-quality.live.test.ts
 *
 * Reuses saved O5A.6.4 dry-run fields + live CURRENT_MESSAGE bodies.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildFeedThreadContext } from "@/server/feed/context";
import { extractCurrentMessageLead } from "@/server/feed/evidence-match";
import { applyTitleQualityGate } from "@/server/feed/title-quality";
import type { RequestSpeechAct } from "@/server/feed/speech-act";

const enabled = process.env.O5A65_TITLE === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const EXTRACTION_VERSION = "o5a.6_real_inbox_review";

const TN_THREADS = [
  "b32e7bcd-cf6e-4e9d-aa8a-02c28f5930c6",
  "e5603e07-3844-4bd9-94e6-159a093fba3d",
  "0ad49de6-ff0a-408f-8793-24e437106d08",
  "48b98bf4-cbeb-4149-8d4e-860b1d05fd11",
] as const;

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

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

describe.runIf(enabled)("O5A.6.5 title quality gate", () => {
  loadEnvLocal();

  it(
    "rewrites generic titles from saved O5A.6.4 cards; TNs/feed unchanged",
    async () => {
      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const o5a64 = JSON.parse(
        readFileSync(
          path.join(tmpDir, "o5a64-general-recall-fix.json"),
          "utf8",
        ),
      ) as {
        recoveredActions: Array<{
          threadId: string;
          acceptedActions: Array<{
            title: string;
            speechAct: string | null;
            requestEvidence: string | null;
            businessObjectEvidence: string | null;
            requesterEmail: string | null;
            assigneeEmail: string | null;
            relationToMailbox: string | null;
          }>;
        }>;
        codeChanges: string[];
      };

      const sb = adminClient();
      const { count: feedBefore } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      const { data: pilotBefore } = await sb
        .from("feed_items")
        .select("id,thread_id,dedupe_key,headline,status")
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      const cards: Array<Record<string, unknown>> = [];
      const auditHardcodes = [
        {
          found:
            "validate empty-recovery requestedAction placeholders ('לבצע את הבקשה', 'להתייחס להבקשה', 'המצורף')",
          replacedWith:
            "composeSpecificTitle from CURRENT lead/subject spans; skip recovery when no concrete title",
        },
        {
          found:
            "extractBusinessObjectSpan junk filter hardcoding 'טריגו מודל' / #מידול",
          replacedWith:
            "generic signature/hashtag/phone junk patterns; subject ask detection for REVIEW/RESPONSE",
        },
        {
          found:
            "EXPLICIT_ASK recovery markers Hebrew-only without English parallels",
          replacedWith:
            "language-aware HE+EN structural ask markers (no domain nouns)",
        },
        {
          found:
            "o5a64 fixtures used engineering nouns as production expectations (דיטלינג) — fixtures only, OK",
          replacedWith:
            "kept as fixtures; production rules remain structural",
        },
      ];

      for (const recovered of o5a64.recoveredActions) {
        const action = recovered.acceptedActions[0];
        if (!action) continue;
        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId: recovered.threadId,
        });
        expect(ctx).toBeTruthy();
        const current = ctx!.messages[ctx!.messages.length - 1]!;
        const lead = extractCurrentMessageLead(current.body);
        const prior =
          ctx!.messages.length > 1
            ? ctx!.messages[ctx!.messages.length - 2]
            : null;

        const gate = applyTitleQualityGate({
          title: action.title,
          speechAct: (action.speechAct as RequestSpeechAct) ?? null,
          requestEvidence: action.requestEvidence ?? "",
          businessObjectEvidence: action.businessObjectEvidence,
          contextEvidence: prior
            ? extractCurrentMessageLead(prior.body).slice(0, 200)
            : null,
          subject: current.subject ?? ctx!.subject,
          body: current.body,
          titleSourceHint: /לבצע את הבקשה|להתייחס להבקשה/i.test(action.title)
            ? "downstream_fallback"
            : "model",
        });

        cards.push({
          threadId: recovered.threadId,
          requesterEmail: action.requesterEmail,
          assigneeEmail: action.assigneeEmail,
          relationToMailbox: action.relationToMailbox,
          modelOrFallbackTitle: gate.modelOrFallbackTitle,
          finalTitle: gate.finalTitle,
          titleSource: gate.titleSource,
          rewritten: gate.rewritten,
          requestEvidenceOriginal:
            gate.evidenceIntegrity.originalRequestEvidence,
          requestEvidenceNormalized:
            gate.evidenceIntegrity.normalizedRequestEvidence,
          businessObjectEvidence: gate.businessObjectEvidence,
          contextEvidence: gate.contextEvidence,
          titleSpecificity: gate.checks,
          evidenceIntegrityOk: gate.evidenceIntegrity.ok,
          status: gate.status,
          ready_for_persist: gate.status === "ready_for_persist",
          needs_human_review: gate.status === "needs_human_review",
          currentLeadPreview: lead.slice(0, 180),
          notes: {
            michtavGamAtchem:
              recovered.threadId.startsWith("bbcd32db")
                ? "מכתב גם אתכם appears verbatim in stored plain_text/clean_conversation — sender typo, not cleaning corruption"
                : null,
            businessObjectNullReason:
              !action.businessObjectEvidence
                ? "O5A.6.4 empty-recovery/extractBusinessObjectSpan missed subject/lead object; gate re-extracts"
                : null,
          },
        });
      }

      const { count: feedAfter } = await sb
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      const { data: pilotAfter } = await sb
        .from("feed_items")
        .select("id,thread_id,dedupe_key,headline,status")
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      expect(feedAfter).toBe(feedBefore);
      expect((pilotAfter ?? []).map((r) => r.id).sort()).toEqual(
        (pilotBefore ?? []).map((r) => r.id).sort(),
      );

      const tnNote = TN_THREADS.map((id) => ({
        threadId: id,
        stayedEmptyAssumption:
          "O5A.6.4 regression already empty; no OpenAI re-run in O5A.6.5 title gate",
      }));

      const report = {
        evaluationVersion: "o5a6.5_title_quality_gate",
        status: "AWAITING HUMAN REVIEW OF ACTION TITLES",
        constraints: {
          noPersist: true,
          noOpenAiInThisPhase: true,
          reusedSavedO5a64Output: true,
          noO5B: true,
          domainAgnostic: true,
        },
        auditHardcodes,
        cardAudit: {
          titleSources: cards.map((c) => ({
            threadId: c.threadId,
            modelOrFallbackTitle: c.modelOrFallbackTitle,
            titleSource: c.titleSource,
          })),
          evidenceIntegrityNotes: cards.map((c) => ({
            threadId: c.threadId,
            notes: c.notes,
          })),
        },
        cards,
        regression: {
          feedItems: {
            before: feedBefore ?? 0,
            after: feedAfter ?? 0,
            unchanged: feedBefore === feedAfter,
          },
          pilotCardsUnchanged: true,
          trueNegatives: tnNote,
        },
        summary: {
          readyForPersist: cards.filter((c) => c.ready_for_persist).length,
          needsHumanReview: cards.filter((c) => c.needs_human_review).length,
        },
      };

      writeFileSync(
        path.join(tmpDir, "o5a65-title-quality-gate.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md: string[] = [];
      md.push("# O5A.6.5 — Generic Action Title Quality Gate");
      md.push("");
      md.push("Status: **AWAITING HUMAN REVIEW OF ACTION TITLES**");
      md.push("");
      md.push("No Persist. No OpenAI. No O5B / Webhooks / Push / Onyx.");
      md.push("");
      md.push("## Audit — O5A.6.4 hardcodes / domain coupling");
      md.push("");
      for (const a of auditHardcodes) {
        md.push(`- **Found:** ${a.found}`);
        md.push(`  - **Replaced with:** ${a.replacedWith}`);
      }
      md.push("");
      md.push("## Card audit (pre-gate)");
      md.push("");
      md.push(
        "| Thread | Saved title | Source | businessObjectEvidence | Evidence note |",
      );
      md.push("|---|---|---|---|---|");
      for (const c of cards) {
        md.push(
          `| ${String(c.threadId).slice(0, 8)}… | ${c.modelOrFallbackTitle} | ${c.titleSource} | ${c.businessObjectEvidence ?? "null→re-extracted"} | ${JSON.stringify(c.notes)} |`,
        );
      }
      md.push("");
      md.push("## Four cards after title gate");
      md.push("");
      for (const c of cards) {
        md.push(`### ${String(c.threadId).slice(0, 8)}…`);
        md.push(`- finalTitle: **${c.finalTitle}**`);
        md.push(
          `- ${c.requesterEmail} → ${c.assigneeEmail} (${c.relationToMailbox})`,
        );
        md.push(
          `- requestEvidence original: ${c.requestEvidenceOriginal}`,
        );
        md.push(
          `- requestEvidence normalized: ${c.requestEvidenceNormalized}`,
        );
        md.push(`- businessObjectEvidence: ${c.businessObjectEvidence}`);
        md.push(`- contextEvidence: ${c.contextEvidence}`);
        md.push(`- titleSpecificity: ${JSON.stringify(c.titleSpecificity)}`);
        md.push(
          `- status: \`${c.status}\` (ready_for_persist=${c.ready_for_persist})`,
        );
        md.push("");
      }
      md.push("## Regression");
      md.push("");
      md.push(
        `- feed_items: ${feedBefore} → ${feedAfter} (unchanged=${feedBefore === feedAfter})`,
      );
      md.push("- pilot O5A.6 cards unchanged");
      md.push(
        "- true negatives: not re-called; O5A.6.4 confirmed empty (title gate is accept-path only)",
      );
      md.push("");
      md.push(
        `## Summary: ready=${report.summary.readyForPersist}, needs_human_review=${report.summary.needsHumanReview}`,
      );
      md.push("");
      md.push("**AWAITING HUMAN REVIEW OF ACTION TITLES**");
      md.push("");

      writeFileSync(
        path.join(tmpDir, "o5a65-title-quality-gate.md"),
        md.join("\n"),
        "utf8",
      );

      expect(cards).toHaveLength(4);
      expect(cards.every((c) => c.evidenceIntegrityOk === true)).toBe(true);
      // Prefer ready; allow needs_human_review when still insufficient — never drop to zero.
      expect(
        cards.every(
          (c) =>
            c.status === "ready_for_persist" ||
            c.status === "needs_human_review",
        ),
      ).toBe(true);
      expect(
        cards.every(
          (c) =>
            typeof c.finalTitle === "string" &&
            !/^לבצע את הבקשה$|^להתייחס להבקשה$|^please handle this$/i.test(
              String(c.finalTitle),
            ),
        ),
      ).toBe(true);
    },
    120_000,
  );
});
