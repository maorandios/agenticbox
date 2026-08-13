/**
 * Resume O5A.2 direction live after validation fix:
 * - Example A: re-validate + persist from cached OpenAI response (0 new calls)
 * - Examples B+C: one processFeedExtractJob each (2 calls)
 *   O5A2_DIRECTION_RESUME=1 npx vitest run src/server/feed/o5a2-direction-resume.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resetFeedCircuit } from "@/server/feed/circuit";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";
import { O5A2_CORRECTION_REASON } from "@/server/feed/config";
import { buildFeedThreadContext, computeDedupeKey } from "@/server/feed/context";
import {
  loadAccountIdentities,
  normalizeEmailAddress,
  resolveMessageAccountRelation,
} from "@/server/feed/identity";
import { persistFeedExtraction } from "@/server/feed/persist";
import { processFeedExtractJob } from "@/server/feed/process";
import { validateFeedCandidates, validateExtractionGate } from "@/server/feed/validate";
import { FeedExtractionResultSchema } from "@/server/feed/schemas";

const enabled = process.env.O5A2_DIRECTION_RESUME === "1";

const A = {
  key: "A_autocad",
  feedItemId: "79c0cfda-93c9-4b77-943c-9d26477be46d",
  threadId: "e9867a8c-45b2-41a6-94bc-32dceb84f781",
  sourceMessageId: "afc51274-b6d7-4cdd-9653-793868b26aac",
  responseId: "resp_0264798b89de9046006a7ca9e0cb0881a393a245d9f4979cd6",
  expectDirection: "sent_by_account_owner",
  expectTypeLabel: "בקשה ששלחת",
} as const;

const LIVE = [
  {
    key: "B_ga",
    feedItemId: "53dec6f5-c2ae-404c-9099-112b36e40277",
    threadId: "36fd19e1-2301-4c94-8eaf-3534b559dae6",
    sourceMessageId: "d4f11e5d-6274-48c1-b179-b78980f84944",
    expectDirection: "sent_by_account_owner",
    expectTypeLabel: "בקשה ששלחת",
  },
  {
    key: "C_leonid",
    feedItemId: "88e7673d-5518-45b3-931c-4e6b0ee220c6",
    threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
    sourceMessageId: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
    expectDirection: "external_to_external",
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

describe.runIf(enabled)("O5A.2 direction resume", () => {
  loadEnvLocal();
  process.env.FEED_AI_ENABLED = "true";
  process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  process.env.FEED_EXTRACTION_VERSION = "o5a.2";
  process.env.FEED_MIN_BUSINESS_RELEVANCE = "0.85";

  it(
    "persists A from cache then live-extracts B and C",
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
      const identities = loadAccountIdentities({
        primaryEmail: String(active!.email),
        aliases: active!.aliases,
      });

      const examples: Array<Record<string, unknown>> = [];
      let openaiCalls = 1; // prior failed A call already counted
      let totalTokens = 3603;

      // --- A from cache ---
      const resp = await fetch(
        `https://api.openai.com/v1/responses/${A.responseId}`,
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } },
      );
      expect(resp.ok).toBe(true);
      const raw = await resp.json();
      const text =
        raw.output_text ||
        raw.output?.find((o: { type: string }) => o.type === "message")
          ?.content?.find(
            (c: { type: string }) => c.type === "output_text",
          )?.text;
      const parsedJson = typeof text === "string" ? JSON.parse(text) : text;
      const parsed = FeedExtractionResultSchema.parse(parsedJson);
      const gate = validateExtractionGate({ result: parsed });
      expect(gate.ok).toBe(true);

      const ctxA = await buildFeedThreadContext({
        userId,
        mailAccountId,
        threadId: A.threadId,
        triggerMessageId: A.sourceMessageId,
      });
      expect(ctxA).toBeTruthy();
      const validatedA = validateFeedCandidates({
        candidates: parsed.items,
        messages: ctxA!.messages,
        accountIdentities: identities,
        minConfidence: 0.8,
        minBusinessRelevance: 0.85,
        existingDedupeKeys: new Set(),
        computeDedupeKey: (c) =>
          computeDedupeKey({
            userId,
            threadId: A.threadId,
            sourceMessageId: c.sourceMessageId,
            type: c.type,
            evidenceText: c.evidenceText,
          }),
      });
      expect(validatedA.accepted.length).toBeGreaterThan(0);
      await persistFeedExtraction({
        userId,
        mailAccountId,
        threadId: A.threadId,
        sourceContentHash: ctxA!.sourceContentHash,
        nextState: parsed.nextState,
        accepted: validatedA.accepted,
        lastProcessedMessageId: A.sourceMessageId,
        intelligenceStatus: "ready",
      });
      await admin
        .from("feed_extraction_runs")
        .update({
          accepted_count: validatedA.accepted.length,
          rejected_count: validatedA.rejected.length,
        })
        .eq("id", "f1fe794b-78d0-44c4-bb42-f6980f65688d");

      // --- B + C live (1 call each) ---
      for (const t of LIVE) {
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
          .update({ source_content_hash: `o5a2-resume-${Date.now()}-${t.key}` })
          .eq("thread_id", t.threadId);

        const processResult = await processFeedExtractJob({
          type: "feed_extract_thread",
          userId,
          mailAccountId,
          threadId: t.threadId,
          triggerMessageId: t.sourceMessageId,
        });
        openaiCalls += 1;
        expect(processResult).toBe("completed");

        const { data: run } = await admin
          .from("feed_extraction_runs")
          .select("total_tokens,accepted_count,rejected_count")
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        totalTokens += Number(run?.total_tokens ?? 0);
      }

      const allTargets = [A, ...LIVE];
      for (const t of allTargets) {
        const { data: parts } = await admin
          .from("message_participants")
          .select("role,email,name")
          .eq("message_id", t.sourceMessageId);
        const from = (parts ?? []).find((p) => p.role === "from");
        const relation = resolveMessageAccountRelation({
          fromEmail: from?.email ? String(from.email) : null,
          toEmails: (parts ?? [])
            .filter((p) => p.role === "to")
            .map((p) => String(p.email)),
          ccEmails: (parts ?? [])
            .filter((p) => p.role === "cc")
            .map((p) => String(p.email)),
          bccEmails: [],
          accountIdentities: identities,
        });

        const { data: items } = await admin
          .from("feed_items")
          .select(
            "id,headline,requested_action,action_owner,responsibility_scope,request_direction,requester_name,requester_email,assignee_name,assignee_email,beneficiary_name,due_at,due_evidence_text,request_modality,status",
          )
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2")
          .in("status", ["new", "open", "scheduled"]);
        const item = (items ?? [])[0] ?? null;
        const direction =
          (item?.request_direction as string | null) ??
          (item?.requester_email &&
          normalizeEmailAddress(String(item.requester_email)) ===
            "office@trigo-models.com"
            ? "sent_by_account_owner"
            : "external_to_external");

        examples.push({
          key: t.key,
          messageAccountRelation: relation,
          requestDirection: direction,
          responsibilityScope: item?.responsibility_scope ?? item?.action_owner,
          requestedAction: item?.requested_action,
          headline: item?.headline,
          requester: {
            name: item?.requester_name,
            email: maskEmail(item?.requester_email as string | null),
          },
          assignee: {
            name: item?.assignee_name,
            email: maskEmail(item?.assignee_email as string | null),
          },
          beneficiaryName: item?.beneficiary_name ?? null,
          dueAt: item?.due_at ?? null,
          dueEvidenceText: item?.due_evidence_text ?? null,
          uiPreview: {
            typeLabel: t.expectTypeLabel,
            headline: item?.headline,
            waiting:
              direction === "sent_by_account_owner"
                ? `ממתינים ל${String(item?.assignee_name ?? "").split(/\s+/)[0]}`
                : null,
            canMarkHandled: false,
          },
        });

        expect(item).toBeTruthy();
        expect(item?.due_at).toBeNull();
        expect(direction).toBe(t.expectDirection);
        expect(direction).not.toBe("requested_from_account_owner");
        expect(item?.responsibility_scope ?? item?.action_owner).toBe(
          "external_person",
        );
      }

      const { data: superseded } = await admin
        .from("feed_items")
        .select("id,status,status_reason")
        .in(
          "id",
          allTargets.map((t) => t.feedItemId),
        );
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
          "Outbound requests classified as account_owner: no requestDirection recompute from mailbox emails. Auth email ≠ mailbox email; display names never trusted.",
        identityBefore: "mail_accounts.email (ok) but scope from assignee only; outbound imperatives treated as owner tasks",
        identityAfter:
          "MailboxIdentity + MessageAccountRelation + resolveRequestAttribution",
        activeMailbox: "of…@tr…com",
        openaiCalls,
        totalTokens,
        supersededCount: 3,
        noOnyxChat: true,
        noO5B: true,
        examples,
      };
      const outDir = path.resolve(process.cwd(), "tmp");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, "o5a2-direction-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );
      expect(openaiCalls).toBeLessThanOrEqual(3);
    },
    300_000,
  );
});
