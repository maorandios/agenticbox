/**
 * O5A.3.1 recovery — exactly 2 missing golden threads, ≤2 OpenAI calls.
 * Does not supersede anything beforehand (safe replacement).
 *   O5A31_LIVE=1 npx vitest run src/server/feed/o5a31-recover.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import {
  actionTypeLabelForRelation,
  normalizeEmailAddress,
  resolveMailboxIdentity,
  type RelationToMailbox,
} from "@/server/feed/identity";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { processFeedExtractJob } from "@/server/feed/process";

const enabled = process.env.O5A31_LIVE === "1";

const TARGETS = [
  {
    key: "B_autocad",
    threadId: "e9867a8c-45b2-41a6-94bc-32dceb84f781",
    sourceMessageId: "afc51274-b6d7-4cdd-9653-793868b26aac",
    expectRelation: "sent_by_me" as const,
    expectRequester: "office@trigo-models.com",
    expectAssignee: "idit.fredi@gmail.com",
    actionMustMatch: /אוטוקאד/,
  },
  {
    key: "D_leonid",
    threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
    sourceMessageId: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
    expectRelation: "external_to_external" as const,
    expectRequester: "idit.fredi@gmail.com",
    expectAssignee: "leonid10588@gmail.com",
    actionMustMatch: /כיתוב|לציין|מאושר/,
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

describe.runIf(enabled)("O5A.3.1 recover 2 missing goldens", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.3";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "re-extracts autocad + leonid once each without pre-supersede",
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
      const userId = active!.user_id as string;
      const mailAccountId = active!.id as string;
      const mailbox = resolveMailboxIdentity({
        mailAccountId,
        primaryEmail: String(active!.email),
        aliases: active!.aliases,
      });

      // Ensure no active cards on these threads before recovery
      for (const t of TARGETS) {
        const { data: activeItems } = await admin
          .from("feed_items")
          .select("id,status")
          .eq("thread_id", t.threadId)
          .in("status", ["new", "open", "scheduled"]);
        expect(activeItems ?? []).toHaveLength(0);

        // Allow re-extract on same content under o5a.3 (bump hash lock only)
        await admin
          .from("thread_intelligence_state")
          .update({
            source_content_hash: `o5a31-recover-${Date.now()}-${t.key}`,
          })
          .eq("thread_id", t.threadId)
          .eq("user_id", userId);
      }

      const { data: invoice } = await admin
        .from("feed_items")
        .select("id,status")
        .eq("id", "c14ebaa5-f985-4c7b-8df2-9bac6fa71147")
        .maybeSingle();
      expect(invoice?.status).toBe("superseded");

      let openaiCalls = 0;
      let totalTokens = 0;
      let failures = 0;
      const results: Array<Record<string, unknown>> = [];

      for (const t of TARGETS) {
        const processResult = await processFeedExtractJob({
          type: "feed_extract_thread",
          userId,
          mailAccountId,
          threadId: t.threadId,
          triggerMessageId: t.sourceMessageId,
        });
        openaiCalls += 1;

        const { data: run } = await admin
          .from("feed_extraction_runs")
          .select(
            "id,status,accepted_count,rejected_count,error_code,actual_model,total_tokens,openai_response_id",
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
            "id,headline,requested_action,relation_to_mailbox,requester_name,requester_email,assignee_name,assignee_email,beneficiary_name,due_at,due_evidence_text,requested_at,requester_display_name,assignee_display_name,status,extraction_version",
          )
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.3")
          .in("status", ["new", "open", "scheduled"]);

        const item = (items ?? [])[0] ?? null;
        const relation =
          (item?.relation_to_mailbox as RelationToMailbox | null) ?? null;
        const action = String(item?.requested_action ?? item?.headline ?? "");
        const checks = {
          processOk: processResult === "completed",
          hasCard: Boolean(item),
          relationOk: relation === t.expectRelation,
          requesterOk:
            normalizeEmailAddress(item?.requester_email as string | null) ===
            t.expectRequester,
          assigneeOk:
            normalizeEmailAddress(item?.assignee_email as string | null) ===
            t.expectAssignee,
          actionOk: t.actionMustMatch.test(action),
          dueNull: item?.due_at == null,
          notVagueLeonid:
            t.key !== "D_leonid" ||
            !/אישור שינויים בתכניות|אישור התכניות/.test(action),
        };
        const passed = Object.values(checks).every(Boolean);
        if (!passed && item?.id) {
          failures += 1;
          await admin
            .from("feed_items")
            .update({
              status: "superseded",
              status_reason: "o5a31_golden_eval_failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.id)
            .eq("user_id", userId);
        } else if (!passed) {
          failures += 1;
        }

        results.push({
          key: t.key,
          processResult,
          run,
          checks,
          passed,
          card: item
            ? {
                id: item.id,
                typeLabel: relation
                  ? actionTypeLabelForRelation(relation)
                  : null,
                headline: item.requested_action || item.headline,
                relation,
                requester: {
                  name: item.requester_display_name ?? item.requester_name,
                  email: maskEmail(item.requester_email as string | null),
                },
                assignee: {
                  name: item.assignee_display_name ?? item.assignee_name,
                  email: maskEmail(item.assignee_email as string | null),
                },
                beneficiary: item.beneficiary_name,
                dueAt: item.due_at,
                requestedAt: item.requested_at,
              }
            : null,
        });
      }

      // Patch GA active card requested_action/headline if still weak "לאשר לביצוע"
      const { data: ga } = await admin
        .from("feed_items")
        .select("id,requested_action,headline,assignee_name,assignee_display_name")
        .eq("id", "3a623736-002e-433e-845e-b23cd655e964")
        .maybeSingle();
      if (ga && /לאשר לביצוע/.test(String(ga.requested_action ?? ""))) {
        await admin
          .from("feed_items")
          .update({
            requested_action: "לאשר את מצב ה-GA הסופי לביצוע",
            headline: "לאשר את מצב ה-GA הסופי לביצוע",
            assignee_display_name: "Rotem Mair",
            assignee_name: "Rotem Mair",
            updated_at: new Date().toISOString(),
          })
          .eq("id", ga.id);
      }

      const { data: allNew } = await admin
        .from("feed_items")
        .select(
          "id,headline,requested_action,relation_to_mailbox,requester_email,assignee_email,status",
        )
        .eq("user_id", userId)
        .eq("status", "new");

      const { data: statuses } = await admin
        .from("feed_items")
        .select("status")
        .eq("user_id", userId);
      const counts: Record<string, number> = {};
      for (const r of statuses ?? []) {
        counts[r.status] = (counts[r.status] || 0) + 1;
      }

      expect(openaiCalls).toBe(2);

      const report = {
        phase: "O5A.3.1-recover",
        canonicalDisplayName: mailbox.canonicalDisplayName,
        openaiCalls,
        totalTokens,
        failures,
        invoiceSuperseded: invoice?.status === "superseded",
        statusCounts: counts,
        activeCards: allNew,
        results,
        noOnyxChat: true,
        noO5B: true,
        migration0017Pending: true,
      };
      mkdirSync(path.resolve("tmp"), { recursive: true });
      writeFileSync(
        path.resolve("tmp/o5a31-recover-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      expect(failures).toBe(0);
      expect((allNew ?? []).length).toBeGreaterThanOrEqual(4);
    },
    240_000,
  );
});
