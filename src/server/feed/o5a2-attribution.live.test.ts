/**
 * O5A.2 single-thread attribution re-extract (Idit → Leonid).
 *   O5A2_LIVE=1 npx vitest run src/server/feed/o5a2-attribution.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { O5A2_SUPERSEDE_REASON } from "@/server/feed/config";
import { processFeedExtractJob } from "@/server/feed/process";
import { loadAccountIdentities } from "@/server/feed/identity";

const enabled = process.env.O5A2_LIVE === "1";
const THREAD_ID = "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2";
const BAD_ITEM_ID = "be766d22-a90c-4a48-842f-e045971cb822";
const SOURCE_MESSAGE_ID = "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0";

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

describe.runIf(enabled)("O5A.2 attribution single-thread live", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.2";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "supersedes bad card and re-extracts Idit/Leonid thread once",
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

      // Verify migration 0014 columns
      const { error: colErr } = await admin
        .from("feed_items")
        .select("id,responsibility_scope,due_evidence_text,requester_email")
        .limit(1);
      expect(colErr).toBeNull();

      const identities = loadAccountIdentities({
        primaryEmail: String(active!.email),
        aliases: active!.aliases,
      });

      // Supersede the known bad card only
      const { data: bad, error: badErr } = await admin
        .from("feed_items")
        .select("id,status,headline,due_at,action_owner,source_message_id")
        .eq("id", BAD_ITEM_ID)
        .eq("mail_account_id", mailAccountId)
        .maybeSingle();
      expect(badErr).toBeNull();
      expect(bad?.id).toBe(BAD_ITEM_ID);

      if (bad && bad.status !== "superseded") {
        const { error: upErr } = await admin
          .from("feed_items")
          .update({
            status: "superseded",
            status_reason: O5A2_SUPERSEDE_REASON,
            updated_at: new Date().toISOString(),
          })
          .eq("id", BAD_ITEM_ID)
          .eq("user_id", userId);
        expect(upErr).toBeNull();
      }

      const result = await processFeedExtractJob({
        type: "feed_extract_thread",
        userId,
        mailAccountId,
        threadId: THREAD_ID,
        triggerMessageId: SOURCE_MESSAGE_ID,
      });

      expect(["completed", "skipped", "prefilter_skipped"]).toContain(result);

      const { data: runs } = await admin
        .from("feed_extraction_runs")
        .select(
          "id,status,accepted_count,rejected_count,candidate_count,error_code,actual_model,extraction_version,input_tokens,output_tokens,total_tokens",
        )
        .eq("thread_id", THREAD_ID)
        .eq("extraction_version", "o5a.2")
        .order("started_at", { ascending: false })
        .limit(3);

      const { data: newItems } = await admin
        .from("feed_items")
        .select(
          "id,type,headline,context,due_at,due_evidence_text,action_owner,responsibility_scope,requester_name,requester_email,assignee_name,assignee_email,beneficiary_name,beneficiary_email,requested_action,request_modality,requested_at,attribution_confidence,source_message_id,status,extraction_version,status_reason,supersedes_feed_item_id",
        )
        .eq("thread_id", THREAD_ID)
        .eq("extraction_version", "o5a.2")
        .in("status", ["new", "open", "scheduled"]);

      const { data: oldStatus } = await admin
        .from("feed_items")
        .select("id,status,status_reason")
        .eq("id", BAD_ITEM_ID)
        .maybeSingle();

      const item = (newItems ?? [])[0] ?? null;
      const report = {
        phase: "O5A.2",
        account: {
          id: "3083…150e",
          primary: maskEmail(String(active!.email)),
          identities: identities.map((i) => ({
            email: maskEmail(i.email),
            type: i.type,
          })),
          leonidIsIdentity: identities.some(
            (i) => i.email === "leonid10588@gmail.com",
          ),
        },
        processResult: result,
        run: runs?.[0] ?? null,
        supersededBadCard: {
          id: BAD_ITEM_ID,
          status: oldStatus?.status,
          status_reason: oldStatus?.status_reason,
        },
        correctedItem: item
          ? {
              id: item.id,
              type: item.type,
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
              beneficiary: {
                name: item.beneficiary_name,
                email: maskEmail(item.beneficiary_email as string | null),
              },
              responsibilityScope: item.responsibility_scope ?? item.action_owner,
              requestModality: item.request_modality,
              requestedAt: item.requested_at,
              dueAt: item.due_at,
              dueEvidenceText: item.due_evidence_text,
              sourceMessageId: item.source_message_id,
              uiPreview: {
                typeLabel:
                  item.responsibility_scope === "external_person" ||
                  item.action_owner === "external_person"
                    ? "בקשה בין משתתפים"
                    : item.responsibility_scope === "account_owner"
                      ? "נדרשת ממך פעולה"
                      : "פעולה",
                headline: item.headline,
                meta: `${item.requester_name ?? "?"} → ${item.assignee_name ?? item.assignee_email ?? "?"} · ${item.requested_at ?? ""}`,
                dueLine: item.due_at ? `לביצוע עד: ${item.due_at}` : null,
                canMarkHandled: ["account_owner", "account_owner_team"].includes(
                  String(item.responsibility_scope ?? item.action_owner),
                ),
              },
            }
          : null,
        openaiCalls: 1,
      };

      const outDir = path.resolve(process.cwd(), "tmp");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, "o5a2-attribution-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      expect(oldStatus?.status).toBe("superseded");
      expect(oldStatus?.status_reason).toBe(O5A2_SUPERSEDE_REASON);
      expect(result).toBe("completed");
      expect(item).toBeTruthy();
      expect(item?.due_at).toBeNull();
      expect(item?.responsibility_scope ?? item?.action_owner).toBe(
        "external_person",
      );
    },
    180_000,
  );
});
