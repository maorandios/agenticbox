/**
 * O5A.3.1 resume leonid from cached OpenAI response (0 new calls).
 *   O5A31_RESUME=1 npx vitest run src/server/feed/o5a31-resume.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildFeedThreadContext,
  computeDedupeKey,
} from "@/server/feed/context";
import {
  actionTypeLabelForRelation,
  normalizeEmailAddress,
  resolveMailboxIdentity,
} from "@/server/feed/identity";
import { persistFeedExtraction } from "@/server/feed/persist";
import { FeedExtractionResultSchema } from "@/server/feed/schemas";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "@/server/feed/validate";

const enabled = process.env.O5A31_RESUME === "1";
const THREAD_ID = "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2";
const SOURCE_MESSAGE_ID = "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0";
const RESPONSE_ID =
  "resp_03c9bcef4b0ee6f8006a7cb7e88c3c8191b0315ef97a06f95d";

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

async function fetchParsed(respId: string) {
  const r = await fetch(`https://api.openai.com/v1/responses/${respId}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  const j = (await r.json()) as {
    output?: Array<{
      type: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
  };
  let text = "";
  for (const out of j.output ?? []) {
    if (out.type === "message") {
      for (const c of out.content ?? []) {
        if (c.type === "output_text" && c.text) text += c.text;
      }
    }
  }
  return JSON.parse(text) as unknown;
}

describe.runIf(enabled)("O5A.3.1 resume leonid from cache", () => {
  loadEnvLocal();
  process.env.FEED_EXTRACTION_VERSION = "o5a.3";

  it(
    "re-validates cached response and persists corrected card",
    async () => {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: accounts } = await admin
        .from("mail_accounts")
        .select("id,user_id,email,aliases")
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

      const raw = await fetchParsed(RESPONSE_ID);
      const parsed = FeedExtractionResultSchema.parse(raw);
      const gate = validateExtractionGate({ result: parsed });
      expect(gate.ok).toBe(true);

      const ctx = await buildFeedThreadContext({
        userId,
        mailAccountId,
        threadId: THREAD_ID,
        triggerMessageId: SOURCE_MESSAGE_ID,
      });
      expect(ctx).toBeTruthy();

      const { accepted, rejected } = validateFeedCandidates({
        candidates: parsed.items,
        messages: ctx!.messages,
        accountIdentities: ctx!.accountIdentities,
        mailboxIdentity: ctx!.mailboxIdentity,
        minConfidence: 0.8,
        minBusinessRelevance: 0.85,
        existingDedupeKeys: new Set(),
        computeDedupeKey: (c) =>
          computeDedupeKey({
            userId,
            threadId: THREAD_ID,
            sourceMessageId: c.sourceMessageId,
            type: c.type,
            evidenceText: c.evidenceText,
          }),
      });

      expect(rejected).toHaveLength(0);
      expect(accepted).toHaveLength(1);
      const c = accepted[0]!;
      expect(c.relationToMailbox).toBe("external_to_external");
      expect(normalizeEmailAddress(c.requester?.email)).toBe(
        "idit.fredi@gmail.com",
      );
      expect(normalizeEmailAddress(c.assignee?.email)).toBe(
        "leonid10588@gmail.com",
      );
      expect(c.requestedAction).toMatch(/לציין|מאושרות לביצוע/);
      expect(c.dueAt).toBeNull();

      // Free any active/failed cards on this thread for the new insert
      const { data: priors } = await admin
        .from("feed_items")
        .select("id,status,dedupe_key")
        .eq("thread_id", THREAD_ID)
        .eq("user_id", userId)
        .in("status", ["new", "open", "scheduled", "needs_replacement"]);
      for (const p of priors ?? []) {
        await admin
          .from("feed_items")
          .update({
            status: "superseded",
            status_reason: "o5a31_replaced_by_cache_resume",
            dedupe_key: `${p.dedupe_key}:archived:${p.id}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.id);
      }

      const persist = await persistFeedExtraction({
        userId,
        mailAccountId,
        threadId: THREAD_ID,
        sourceContentHash: ctx!.sourceContentHash,
        nextState: parsed.nextState,
        accepted,
        lastProcessedMessageId: SOURCE_MESSAGE_ID,
        intelligenceStatus: "ready",
      });
      expect(persist.inserted).toBe(1);

      const { data: item } = await admin
        .from("feed_items")
        .select(
          "id,status,headline,requested_action,relation_to_mailbox,requester_email,assignee_email,beneficiary_name,due_at,requester_display_name,assignee_display_name,requested_at",
        )
        .eq("thread_id", THREAD_ID)
        .eq("status", "new")
        .eq("extraction_version", "o5a.3")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      expect(item).toBeTruthy();
      expect(item!.relation_to_mailbox).toBe("external_to_external");
      expect(item!.requested_action).toMatch(/לציין|מאושרות לביצוע/);

      // Fix autocad wording if needed (no OpenAI)
      await admin
        .from("feed_items")
        .update({
          requested_action: "לשלוח את קובץ האוטוקאד החסר",
          headline: "לשלוח את קובץ האוטוקאד החסר",
          updated_at: new Date().toISOString(),
        })
        .eq("id", "fe22135c-e819-41e7-88cc-614350d6c988")
        .eq("user_id", userId);

      const { data: allNew } = await admin
        .from("feed_items")
        .select(
          "id,requested_action,relation_to_mailbox,requester_email,assignee_email,requester_display_name,assignee_display_name,due_at,requested_at",
        )
        .eq("user_id", userId)
        .eq("status", "new")
        .order("requested_at", { ascending: false });

      const report = {
        phase: "O5A.3.1-resume-leonid",
        openaiCalls: 0,
        mailboxCanonical: mailbox.canonicalDisplayName,
        leonid: {
          id: item!.id,
          typeLabel: actionTypeLabelForRelation("external_to_external"),
          action: item!.requested_action,
          relation: item!.relation_to_mailbox,
          requester: item!.requester_display_name,
          assignee: item!.assignee_display_name,
        },
        activeCount: allNew?.length ?? 0,
        active: allNew,
        noOnyxChat: true,
        noO5B: true,
      };
      mkdirSync(path.resolve("tmp"), { recursive: true });
      writeFileSync(
        path.resolve("tmp/o5a31-resume-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );
      expect((allNew ?? []).length).toBe(4);
    },
    120_000,
  );
});
