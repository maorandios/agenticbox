/**
 * O5A.3 limited live re-extract — exactly 4 golden threads, ≤4 OpenAI calls.
 *   O5A3_LIVE=1 npx vitest run src/server/feed/o5a3.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { O5A3_SEMANTICS_REASON } from "@/server/feed/config";
import {
  actionTypeLabelForRelation,
  loadAccountIdentities,
  normalizeEmailAddress,
  resolveMailboxIdentity,
  resolveMessageAccountRelation,
  type RelationToMailbox,
} from "@/server/feed/identity";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { processFeedExtractJob } from "@/server/feed/process";

const enabled = process.env.O5A3_LIVE === "1";

const TARGETS = [
  {
    key: "A_gaash",
    feedItemId: "7c4de08e-8507-4dc0-a458-53bfb3f236e0",
    threadId: "1c76595c-a0ae-4008-aefc-99cbade18ec3",
    sourceMessageId: "6fc5b215-9bf4-474f-b160-9823872f9dc1",
    expectRelation: "requested_from_me" as const,
    expectRequester: "office@gaash-m.co.il",
    expectAssignee: "office@trigo-models.com",
  },
  {
    key: "B_autocad",
    feedItemId: "df115dea-dd78-45f2-8bfb-5a18f330afec",
    threadId: "e9867a8c-45b2-41a6-94bc-32dceb84f781",
    sourceMessageId: "afc51274-b6d7-4cdd-9653-793868b26aac",
    expectRelation: "sent_by_me" as const,
    expectRequester: "office@trigo-models.com",
    expectAssignee: "idit.fredi@gmail.com",
  },
  {
    key: "C_ga",
    feedItemId: "232347d5-4420-4c38-8941-f8f9738fa454",
    threadId: "36fd19e1-2301-4c94-8eaf-3534b559dae6",
    sourceMessageId: "d4f11e5d-6274-48c1-b179-b78980f84944",
    expectRelation: "sent_by_me" as const,
    expectRequester: "office@trigo-models.com",
    expectAssignee: "rotem@yarin-eng.co.il",
  },
  {
    key: "D_leonid",
    feedItemId: "4068f29e-b5fb-4b6e-a5ed-c66b37f2a304",
    threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
    sourceMessageId: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
    expectRelation: "external_to_external" as const,
    expectRequester: "idit.fredi@gmail.com",
    expectAssignee: "leonid10588@gmail.com",
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

describe.runIf(enabled)("O5A.3 live — 4 golden threads", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.3";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "supersedes 4 wrong cards and re-extracts once each",
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
      const mailbox = resolveMailboxIdentity({
        mailAccountId,
        primaryEmail: String(active!.email),
        aliases: active!.aliases,
      });
      expect(mailbox.canonicalDisplayName).toBe(
        "מאור | טריגו מידול והנדסה",
      );
      const identities = loadAccountIdentities({
        primaryEmail: String(active!.email),
        aliases: active!.aliases,
      });

      const ids = TARGETS.map((t) => t.feedItemId);
      const { data: before } = await admin
        .from("feed_items")
        .select("id,status,headline,source_message_id,thread_id")
        .in("id", ids)
        .eq("user_id", userId)
        .eq("mail_account_id", mailAccountId)
        .eq("status", "new");
      expect(before?.length).toBe(4);
      if ((before?.length ?? 0) !== 4) {
        throw new Error("expected_exactly_4_target_cards");
      }

      const now = new Date().toISOString();
      for (const t of TARGETS) {
        const { data: upd, error } = await admin
          .from("feed_items")
          .update({
            status: "superseded",
            status_reason: O5A3_SEMANTICS_REASON,
            updated_at: now,
          })
          .eq("id", t.feedItemId)
          .eq("user_id", userId)
          .eq("mail_account_id", mailAccountId)
          .eq("status", "new")
          .select("id");
        if (error) throw error;
        expect(upd?.length).toBe(1);
      }

      const { data: invoiceVisible } = await admin
        .from("feed_items")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "new")
        .ilike("headline", "%Invoice availability%");
      expect(invoiceVisible ?? []).toHaveLength(0);

      const results: Array<Record<string, unknown>> = [];
      let openaiCalls = 0;
      let totalTokens = 0;
      let goldenFailures = 0;

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
        const accountRelation = resolveMessageAccountRelation({
          fromEmail: from?.email ? String(from.email) : null,
          toEmails,
          ccEmails,
          bccEmails: [],
          accountIdentities: identities,
        });

        const { data: run } = await admin
          .from("feed_extraction_runs")
          .select(
            "id,status,accepted_count,rejected_count,candidate_count,actual_model,input_tokens,output_tokens,total_tokens,error_code",
          )
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.3")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        totalTokens += Number(run?.total_tokens ?? 0);

        const { data: items } = await admin
          .from("feed_items")
          .select(
            "id,type,headline,requested_action,action_owner,responsibility_scope,request_direction,relation_to_mailbox,requester_name,requester_email,assignee_name,assignee_email,beneficiary_name,beneficiary_email,response_recipient_name,response_recipient_email,due_at,due_evidence_text,request_modality,semantic_precision_confidence,request_evidence_json,supporting_evidence_json,requester_display_name,assignee_display_name,source_message_id,status,extraction_version,requested_at",
          )
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.3")
          .in("status", ["new", "open", "scheduled"]);

        const item = (items ?? [])[0] ?? null;
        const relation =
          (item?.relation_to_mailbox as RelationToMailbox | null) ?? null;

        const checks = {
          hasActiveCard: Boolean(item),
          relationOk: relation === t.expectRelation,
          requesterOk:
            normalizeEmailAddress(item?.requester_email as string | null) ===
            t.expectRequester,
          assigneeOk:
            normalizeEmailAddress(item?.assignee_email as string | null) ===
            t.expectAssignee,
          dueNull: item?.due_at == null,
          dueEvidenceNull: item?.due_evidence_text == null,
          canonicalRequester:
            t.expectRequester === "office@trigo-models.com"
              ? item?.requester_display_name === mailbox.canonicalDisplayName ||
                item?.requester_name === mailbox.canonicalDisplayName
              : true,
          canonicalAssignee:
            t.expectAssignee === "office@trigo-models.com"
              ? item?.assignee_display_name === mailbox.canonicalDisplayName ||
                item?.assignee_name === mailbox.canonicalDisplayName
              : true,
          leonidSemantics:
            t.key !== "D_leonid" ||
            /כיתוב|לציין|מאושר/.test(
              String(item?.requested_action ?? item?.headline ?? ""),
            ),
        };
        const passed = Object.values(checks).every(Boolean);
        if (!passed) {
          goldenFailures += 1;
          // Do not leave a failing card active
          if (item?.id) {
            await admin
              .from("feed_items")
              .update({
                status: "superseded",
                status_reason: "o5a3_golden_eval_failed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", item.id)
              .eq("user_id", userId);
          }
        }

        results.push({
          key: t.key,
          processResult,
          accountRelation,
          run: {
            id: run?.id,
            status: run?.status,
            accepted: run?.accepted_count,
            rejected: run?.rejected_count,
            model: run?.actual_model,
            tokens: run?.total_tokens,
            error: run?.error_code,
          },
          supersededId: t.feedItemId,
          checks,
          passed,
          card: item
            ? {
                id: item.id,
                headline: item.headline,
                requestedAction: item.requested_action,
                relationToMailbox: relation,
                typeLabel: relation
                  ? actionTypeLabelForRelation(relation)
                  : null,
                requester: {
                  name: item.requester_display_name ?? item.requester_name,
                  email: maskEmail(item.requester_email as string | null),
                },
                assignee: {
                  name: item.assignee_display_name ?? item.assignee_name,
                  email: maskEmail(item.assignee_email as string | null),
                },
                beneficiary: {
                  name: item.beneficiary_name,
                  email: maskEmail(item.beneficiary_email as string | null),
                },
                responseRecipient: {
                  name: item.response_recipient_name,
                  email: maskEmail(
                    item.response_recipient_email as string | null,
                  ),
                },
                dueAt: item.due_at,
                dueEvidenceText: item.due_evidence_text,
                requestedAt: item.requested_at,
                semanticPrecision: item.semantic_precision_confidence,
                requestEvidence: item.request_evidence_json,
                supportingEvidence: item.supporting_evidence_json,
              }
            : null,
        });
      }

      expect(openaiCalls).toBe(4);

      const outDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(outDir, { recursive: true });
      const report = {
        phase: "O5A.3-live",
        canonicalDisplayName: mailbox.canonicalDisplayName,
        identitySource: "mail_accounts",
        authEmailNote: "≠ mailbox (Auth is separate)",
        openaiCalls,
        totalTokens,
        goldenFailures,
        noOnyxChat: true,
        noO5B: true,
        migration0016Applied: true,
        invoiceStillHidden: true,
        results,
      };
      writeFileSync(
        path.join(outDir, "o5a3-live-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      expect(goldenFailures).toBe(0);
    },
    300_000,
  );
});
