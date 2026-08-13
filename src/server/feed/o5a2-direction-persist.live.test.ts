/**
 * Persist A/B/C from already-fetched OpenAI responses (0 new calls).
 *   O5A2_DIRECTION_PERSIST=1 npx vitest run src/server/feed/o5a2-direction-persist.live.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { O5A2_CORRECTION_REASON } from "@/server/feed/config";
import { buildFeedThreadContext, computeDedupeKey } from "@/server/feed/context";
import {
  loadAccountIdentities,
  normalizeEmailAddress,
  resolveMessageAccountRelation,
} from "@/server/feed/identity";
import { persistFeedExtraction } from "@/server/feed/persist";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "@/server/feed/validate";
import { FeedExtractionResultSchema } from "@/server/feed/schemas";

const enabled = process.env.O5A2_DIRECTION_PERSIST === "1";

const TARGETS = [
  {
    key: "A_autocad",
    feedItemId: "79c0cfda-93c9-4b77-943c-9d26477be46d",
    threadId: "e9867a8c-45b2-41a6-94bc-32dceb84f781",
    sourceMessageId: "afc51274-b6d7-4cdd-9653-793868b26aac",
    responseId: "resp_0264798b89de9046006a7ca9e0cb0881a393a245d9f4979cd6",
    expectDirection: "sent_by_account_owner",
    expectTypeLabel: "בקשה ששלחת",
    tokens: 3603,
  },
  {
    key: "B_ga",
    feedItemId: "53dec6f5-c2ae-404c-9099-112b36e40277",
    threadId: "36fd19e1-2301-4c94-8eaf-3534b559dae6",
    sourceMessageId: "d4f11e5d-6274-48c1-b179-b78980f84944",
    responseId: "resp_03a8c3a85f6143b4006a7caacd0c2481a2adeb6b7c9612bb7b",
    expectDirection: "sent_by_account_owner",
    expectTypeLabel: "בקשה ששלחת",
    tokens: 4168,
  },
  {
    key: "C_leonid",
    feedItemId: "88e7673d-5518-45b3-931c-4e6b0ee220c6",
    threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
    sourceMessageId: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
    responseId: "resp_02faa9a4b90da479006a7caadaa0e4819ca1debdc58d0f4d45",
    expectDirection: "external_to_external",
    expectTypeLabel: "בקשה בין משתתפים",
    tokens: 4398,
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

describe.runIf(enabled)("O5A.2 direction persist from cached responses", () => {
  loadEnvLocal();
  process.env.FEED_EXTRACTION_VERSION = "o5a.2";

  it(
    "validates and persists all three without new OpenAI calls",
    async () => {
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

      // Ensure superseded
      for (const t of TARGETS) {
        await admin
          .from("feed_items")
          .update({
            status: "superseded",
            status_reason: O5A2_CORRECTION_REASON,
            updated_at: new Date().toISOString(),
          })
          .eq("id", t.feedItemId)
          .eq("user_id", userId);
        await admin
          .from("feed_items")
          .delete()
          .eq("thread_id", t.threadId)
          .eq("extraction_version", "o5a.2")
          .neq("id", t.feedItemId)
          .neq("status", "superseded");
      }

      const examples: Array<Record<string, unknown>> = [];

      for (const t of TARGETS) {
        const resp = await fetch(
          `https://api.openai.com/v1/responses/${t.responseId}`,
          {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          },
        );
        expect(resp.ok).toBe(true);
        const raw = await resp.json();
        const text =
          raw.output_text ||
          raw.output?.find((o: { type: string }) => o.type === "message")
            ?.content?.find(
              (c: { type: string }) => c.type === "output_text",
            )?.text;
        const parsed = FeedExtractionResultSchema.parse(
          typeof text === "string" ? JSON.parse(text) : text,
        );
        expect(validateExtractionGate({ result: parsed }).ok).toBe(true);

        const ctx = await buildFeedThreadContext({
          userId,
          mailAccountId,
          threadId: t.threadId,
          triggerMessageId: t.sourceMessageId,
        });
        expect(ctx).toBeTruthy();

        const validated = validateFeedCandidates({
          candidates: parsed.items,
          messages: ctx!.messages,
          accountIdentities: identities,
          minConfidence: 0.8,
          minBusinessRelevance: 0.85,
          existingDedupeKeys: new Set(),
          computeDedupeKey: (c) =>
            computeDedupeKey({
              userId,
              threadId: t.threadId,
              sourceMessageId: c.sourceMessageId,
              type: c.type,
              evidenceText: c.evidenceText,
            }),
        });

        expect(
          validated.accepted.length,
          `${t.key} rejected=${JSON.stringify(validated.rejected.map((r) => r.reason))}`,
        ).toBeGreaterThan(0);

        const persisted = await persistFeedExtraction({
          userId,
          mailAccountId,
          threadId: t.threadId,
          sourceContentHash: ctx!.sourceContentHash,
          nextState: parsed.nextState,
          accepted: validated.accepted,
          lastProcessedMessageId: t.sourceMessageId,
          intelligenceStatus: "ready",
        });
        expect(persisted.inserted).toBeGreaterThan(0);

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

        const item = validated.accepted[0]!;
        const direction = item.requestDirection;
        examples.push({
          key: t.key,
          messageAccountRelation: relation,
          requestDirection: direction,
          responsibilityScope: item.responsibilityScope,
          requestedAction: item.requestedAction,
          headline: item.headline,
          requester: {
            name: item.requester?.name ?? null,
            email: maskEmail(item.requester?.email),
          },
          assignee: {
            name: item.assignee?.name ?? null,
            email: maskEmail(item.assignee?.email),
          },
          beneficiaryName: item.beneficiary?.name ?? null,
          dueAt: item.dueAt,
          dueEvidenceText: item.dueEvidenceText,
          uiPreview: {
            typeLabel: t.expectTypeLabel,
            headline: item.headline,
            attribution: `${item.requester?.name ?? "?"} → ${item.assignee?.name ?? "?"}`,
            waiting:
              direction === "sent_by_account_owner"
                ? `ממתינים ל${String(item.assignee?.name ?? "").split(/\s+/)[0]}`
                : null,
            canMarkHandled: false,
          },
        });

        expect(item.dueAt).toBeNull();
        expect(direction).toBe(t.expectDirection);
        expect(normalizeEmailAddress(String(active!.email))).toBe(
          "office@trigo-models.com",
        );
      }

      const report = {
        phase: "O5A.2-direction",
        rootCause:
          "Outbound requests classified as account_owner because responsibility came only from assignee email / model guess; no sent_by_account_owner path. Auth (maor.andios@…) ≠ mailbox (office@…). Also invented dueAt and quoted assignee evidence caused rejects; persist skipped on superseded dedupe keys.",
        identityBefore: "mail_accounts.email + aliases (ok) without requestDirection",
        identityAfter:
          "MailboxIdentity + MessageAccountRelation + resolveRequestAttribution; due cleared if invalid; persist ignores superseded dedupe",
        activeMailbox: "of…@tr…com",
        openaiCalls: 3,
        totalTokens: TARGETS.reduce((s, t) => s + t.tokens, 0),
        supersededCount: 3,
        noOnyxChat: true,
        noO5B: true,
        migration0015Pending: true,
        examples,
      };

      const outDir = path.resolve(process.cwd(), "tmp");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(
        path.join(outDir, "o5a2-direction-report.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );
    },
    180_000,
  );
});
