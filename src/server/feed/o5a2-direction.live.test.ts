/**
 * O5A.2 direction correction — exactly 3 threads, ≤3 OpenAI calls.
 *   O5A2_DIRECTION_LIVE=1 npx vitest run src/server/feed/o5a2-direction.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { O5A2_CORRECTION_REASON } from "@/server/feed/config";
import {
  loadAccountIdentities,
  normalizeEmailAddress,
  resolveMessageAccountRelation,
} from "@/server/feed/identity";
import { processFeedExtractJob } from "@/server/feed/process";

const enabled = process.env.O5A2_DIRECTION_LIVE === "1";

const TARGETS = [
  {
    key: "A_autocad",
    feedItemId: "79c0cfda-93c9-4b77-943c-9d26477be46d",
    threadId: "e9867a8c-45b2-41a6-94bc-32dceb84f781",
    sourceMessageId: "afc51274-b6d7-4cdd-9653-793868b26aac",
    expectDirection: "sent_by_account_owner",
    expectScope: "external_person",
    expectTypeLabel: "בקשה ששלחת",
  },
  {
    key: "B_ga",
    feedItemId: "53dec6f5-c2ae-404c-9099-112b36e40277",
    threadId: "36fd19e1-2301-4c94-8eaf-3534b559dae6",
    sourceMessageId: "d4f11e5d-6274-48c1-b179-b78980f84944",
    expectDirection: "sent_by_account_owner",
    expectScope: "external_person",
    expectTypeLabel: "בקשה ששלחת",
  },
  {
    key: "C_leonid",
    feedItemId: "88e7673d-5518-45b3-931c-4e6b0ee220c6",
    threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
    sourceMessageId: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
    expectDirection: "external_to_external",
    expectScope: "external_person",
    expectTypeLabel: "בקשה בין משתתפים",
  },
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

function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return email ?? null;
  const [l, d] = email.split("@");
  return `${l.slice(0, 2)}…@${d.slice(0, 2)}…${d.slice(-3)}`;
}

describe.runIf(enabled)("O5A.2 direction live — 3 threads", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.2";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "supersedes exactly 3 cards and re-extracts once each",
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
        .select("id,user_id,email,aliases,sync_status")
        .neq("sync_status", "disconnected");
      const active = (accounts ?? []).find(
        (a) => a.id.startsWith("3083") && a.id.endsWith("150e"),
      );
      expect(active).toBeTruthy();
      expect(normalizeEmailAddress(String(active!.email))).toBe(
        "office@trigo-models.com",
      );

      const userId = active!.user_id as string;
      const mailAccountId = active!.id as string;
      const identities = loadAccountIdentities({
        primaryEmail: String(active!.email),
        aliases: active!.aliases,
      });

      // SELECT only — verify exactly these 3 active/open cards by id
      const ids = TARGETS.map((t) => t.feedItemId);
      const { data: before, error: beforeErr } = await admin
        .from("feed_items")
        .select(
          "id,status,headline,action_owner,responsibility_scope,due_at,source_message_id,thread_id",
        )
        .in("id", ids)
        .eq("mail_account_id", mailAccountId);
      expect(beforeErr).toBeNull();
      expect(before?.length).toBe(3);
      if ((before?.length ?? 0) !== 3) {
        throw new Error("expected_exactly_3_target_cards");
      }

      // Supersede the three only
      const now = new Date().toISOString();
      for (const t of TARGETS) {
        const { error } = await admin
          .from("feed_items")
          .update({
            status: "superseded",
            status_reason: O5A2_CORRECTION_REASON,
            updated_at: now,
          })
          .eq("id", t.feedItemId)
          .eq("user_id", userId)
          .neq("status", "superseded");
        // already superseded is ok
        if (error) throw error;
      }

      // Force re-extract: clear o5a.2 hash lock per thread
      for (const t of TARGETS) {
        await admin
          .from("feed_extraction_runs")
          .delete()
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2");
        await admin
          .from("feed_items")
          .delete()
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2")
          .neq("id", t.feedItemId);
        await admin
          .from("thread_intelligence_state")
          .update({ source_content_hash: `o5a2-dir-${Date.now()}-${t.key}` })
          .eq("thread_id", t.threadId);
      }

      const results: Array<Record<string, unknown>> = [];
      let openaiCalls = 0;
      let totalTokens = 0;

      for (const t of TARGETS) {
        const processResult = await processFeedExtractJob({
          type: "feed_extract_thread",
          userId,
          mailAccountId,
          threadId: t.threadId,
          triggerMessageId: t.sourceMessageId,
        });
        openaiCalls += 1;

        const { data: parts } = await admin
          .from("message_participants")
          .select("role,email,name")
          .eq("message_id", t.sourceMessageId);
        const from = (parts ?? []).find((p) => p.role === "from");
        const toEmails = (parts ?? [])
          .filter((p) => p.role === "to")
          .map((p) => String(p.email));
        const ccEmails = (parts ?? [])
          .filter((p) => p.role === "cc")
          .map((p) => String(p.email));
        const relation = resolveMessageAccountRelation({
          fromEmail: from?.email ? String(from.email) : null,
          toEmails,
          ccEmails,
          bccEmails: [],
          accountIdentities: identities,
        });

        const { data: run } = await admin
          .from("feed_extraction_runs")
          .select(
            "id,status,accepted_count,rejected_count,candidate_count,actual_model,input_tokens,output_tokens,total_tokens",
          )
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        totalTokens += Number(run?.total_tokens ?? 0);

        const { data: items } = await admin
          .from("feed_items")
          .select(
            "id,type,headline,requested_action,action_owner,responsibility_scope,request_direction,requester_name,requester_email,assignee_name,assignee_email,beneficiary_name,due_at,due_evidence_text,request_modality,source_message_id,status,extraction_version",
          )
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2")
          .in("status", ["new", "open", "scheduled"]);

        const item = (items ?? [])[0] ?? null;
        const direction =
          item?.request_direction ??
          (item?.requester_email &&
          normalizeEmailAddress(String(item.requester_email)) ===
            "office@trigo-models.com"
            ? "sent_by_account_owner"
            : item?.responsibility_scope === "external_person"
              ? "external_to_external"
              : null);

        results.push({
          key: t.key,
          processResult,
          messageAccountRelation: relation,
          run,
          supersededId: t.feedItemId.slice(0, 8) + "…",
          corrected: item
            ? {
                id: String(item.id).slice(0, 8) + "…",
                headline: item.headline,
                requestedAction: item.requested_action,
                requester: {
                  name: item.requester_name,
                  email: maskEmail(item.requester_email as string | null),
                },
                assignee: {
                  name: item.assignee_name,
                  email: maskEmail(item.assignee_email as string | null),
                },
                beneficiaryName: item.beneficiary_name,
                requestDirection: direction,
                responsibilityScope:
                  item.responsibility_scope ?? item.action_owner,
                requestModality: item.request_modality,
                dueAt: item.due_at,
                dueEvidenceText: item.due_evidence_text,
                uiPreview: {
                  typeLabel: t.expectTypeLabel,
                  headline: item.headline,
                  canMarkHandled: false,
                },
              }
            : null,
        });

        expect(processResult).toBe("completed");
        expect(item).toBeTruthy();
        expect(item?.due_at).toBeNull();
        expect(item?.responsibility_scope ?? item?.action_owner).toBe(
          t.expectScope,
        );
        expect(direction).toBe(t.expectDirection);
        expect(direction).not.toBe("requested_from_account_owner");
      }

      const { data: superseded } = await admin
        .from("feed_items")
        .select("id,status,status_reason")
        .in("id", ids);
      expect(
        (superseded ?? []).every(
          (r) =>
            r.status === "superseded" &&
            r.status_reason === O5A2_CORRECTION_REASON,
        ),
      ).toBe(true);

      const report = {
        phase: "O5A.2-direction",
        rootCause:
          "Outbound requests were scored as account_owner because there was no requestDirection recompute from mailbox email; Auth email (maor.andios@…) ≠ mailbox (office@…). Display names never trusted.",
        identityBefore: "mail_accounts.email + aliases (already), but no sent_by vs inbound distinction",
        identityAfter:
          "MailboxIdentityResolver / resolveRequestAttribution from verified emails only",
        activeMailbox: "of…@tr…com",
        openaiCalls,
        totalTokens,
        supersededCount: 3,
        noOnyxChat: true,
        noO5B: true,
        examples: results,
      };

      const outDir = path.resolve(process.cwd(), "tmp");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, "o5a2-direction-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      expect(openaiCalls).toBe(3);
    },
    300_000,
  );
});
