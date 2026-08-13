/**
 * O5A.3.1 audit replay — no DB writes.
 *   O5A31_AUDIT=1 npx vitest run src/server/feed/o5a31-audit.live.test.ts
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
import { FeedExtractionResultSchema } from "@/server/feed/schemas";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "@/server/feed/validate";
import { classifyFeedThreadEligibility } from "@/server/feed/eligibility";

const enabled = process.env.O5A31_AUDIT === "1";

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

describe.runIf(enabled)("O5A.3.1 audit replay", () => {
  loadEnvLocal();

  it(
    "replays failed golden runs without writes",
    async () => {
      const userId = "7b897ada-7b9d-4730-b662-028830e55259";
      const mailAccountId = "3083783b-1dc5-453f-924b-3c62f54e150e";
      const cases = [
        {
          key: "autocad",
          threadId: "e9867a8c-45b2-41a6-94bc-32dceb84f781",
          msg: "afc51274-b6d7-4cdd-9653-793868b26aac",
          resp: "resp_07422697503ffe65006a7cb3bdf0f081a3a0349378dce72799",
        },
        {
          key: "leonid",
          threadId: "0ef69e6c-4ce5-4349-a359-1cb4789c9bb2",
          msg: "79d8a2e0-0ccc-46fb-bf42-7e633eff41a0",
          resp: "resp_096d87d0e0803107006a7cb3da619081a3b794ef88fd29f685",
        },
      ] as const;

      const out: unknown[] = [];
      for (const c of cases) {
        const raw = await fetchParsed(c.resp);
        const parsed = FeedExtractionResultSchema.safeParse(raw);
        const ctx = await buildFeedThreadContext({
          userId,
          mailAccountId,
          threadId: c.threadId,
          triggerMessageId: c.msg,
        });
        expect(ctx).toBeTruthy();
        const eligibility = classifyFeedThreadEligibility({
          subject: ctx!.messages[0]?.subject ?? null,
          accountEmail: "office@trigo-models.com",
          messages: ctx!.messages.map((m) => ({
            subject: m.subject,
            fromEmail: m.fromEmail,
            fromName: m.fromName,
            toEmails: m.toEmails,
            direction: m.direction,
            body: m.body,
          })),
        });
        const gate = parsed.success
          ? validateExtractionGate({ result: parsed.data })
          : { ok: false as const, reason: "schema_invalid" as const };
        const items = parsed.success ? parsed.data.items : [];
        const { accepted, rejected } = validateFeedCandidates({
          candidates: items,
          messages: ctx!.messages,
          accountIdentities: ctx!.accountIdentities,
          mailboxIdentity: ctx!.mailboxIdentity,
          minConfidence: 0.8,
          minBusinessRelevance: 0.85,
          existingDedupeKeys: new Set(),
          computeDedupeKey: (x) =>
            computeDedupeKey({
              userId,
              threadId: c.threadId,
              sourceMessageId: x.sourceMessageId,
              type: x.type,
              evidenceText: x.evidenceText,
            }),
        });
        const first = items[0];
        out.push({
          key: c.key,
          threadClassification: parsed.success
            ? parsed.data.threadClassification
            : (raw as { threadClassification?: string }).threadClassification,
          schemaOk: parsed.success,
          schemaIssues: parsed.success
            ? null
            : parsed.error.issues.slice(0, 8).map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
          prefilter: eligibility.classification,
          gate,
          livePath: !gate.ok
            ? "process_clears_candidates_before_validate → no active card; old already superseded"
            : "candidates validated",
          item: first
            ? {
                requestedAction: first.requestedAction,
                headline: first.headline,
                requester: first.requester,
                assignee: first.assignee,
                beneficiary: first.beneficiary,
                semanticPrecisionConfidence:
                  first.semanticPrecisionConfidence,
                businessRelevanceConfidence:
                  first.businessRelevanceConfidence,
                confidence: first.confidence,
                evidenceText: first.evidenceText,
                responsibilityScope: first.responsibilityScope,
                relationToMailbox: first.relationToMailbox,
              }
            : null,
          accepted: accepted.length,
          rejected: rejected.map((r) => ({
            reason: r.reason,
            action: r.candidate.requestedAction,
            evidence: r.candidate.evidenceText?.slice(0, 120),
          })),
          failureSource: !parsed.success
            ? "schema_mapping"
            : !gate.ok
              ? "validator_gate(threadClassification)"
              : rejected.length
                ? `validator_candidate(${rejected[0]?.reason})`
                : "none",
        });
      }

      mkdirSync(path.resolve("tmp"), { recursive: true });
      writeFileSync(
        path.resolve("tmp/o5a31-reject-replay.json"),
        JSON.stringify(out, null, 2),
        "utf8",
      );
      console.log(JSON.stringify(out, null, 2));
    },
    120_000,
  );
});
