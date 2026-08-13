/**
 * O5A.6.6 Controlled Persist — four approved professional titles only.
 *   O5A66_PERSIST=1 npx vitest run src/server/feed/blind/o5a66-controlled-persist.live.test.ts
 *
 * No OpenAI. No re-extraction. No engine changes. No supersede of existing rows.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildFeedThreadContext, computeDedupeKey } from "@/server/feed/context";
import { listFeedForUser } from "@/server/feed/list";
import { persistFeedExtraction } from "@/server/feed/persist";
import type { FeedCandidate } from "@/server/feed/schemas";
import { emptyIntelligenceState } from "@/server/feed/schemas";

const enabled = process.env.O5A66_PERSIST === "1";
const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";
const MAIL_ACCOUNT_ID = "3083783b-1dc5-453f-924b-3c62f54e150e";
const EXTRACTION_VERSION = "o5a.6_general_recall_recovery";
const CANONICAL = "מאור | טריגו מידול והנדסה";

/** Speech acts from O5A.6.4 recovered accepted actions (same four cards). */
const SPEECH_BY_THREAD: Record<string, FeedCandidate["requestSpeechAct"]> = {
  "5f1d5b33-6147-4f45-a4d3-3e9c30fd7703": "directive",
  "f8c6e04a-d698-4456-a4a3-18055e8e007f": "response_request",
  "3771e547-2ce8-4098-a939-e96203b2f306": "directive",
  "bbcd32db-4f9b-47b5-9377-39ac20d6fa6d": "approval_request",
};

const ASSIGNEE_NAME_BY_EMAIL: Record<string, string> = {
  "office@trigo-models.com": CANONICAL,
  "almogbar@electra.co.il": "Almog Barashi",
};

const TRUE_ZERO_THREADS = [
  "507fa5eb-a63b-4444-9330-fc6bb97bbe58",
  "48b98bf4-cbeb-4149-8d4e-860b1d05fd11",
  "bbdd5eb4-247f-4b5a-8ebb-8caae25fd661",
  "c72fe5c3-5942-4c3f-b02d-174f948bce2d",
  "91083528-fea5-4c16-a8a7-f218f906d7e2",
  "53f03f8d-64ee-4a40-b049-91529c218138",
  "71b2ec96-cab0-4d09-b2b6-63db7297ed46",
  "e5603e07-3844-4bd9-94e6-159a093fba3d",
  "44af6be9-7719-4a40-b4e8-61dd6bac3b99",
  "0ad49de6-ff0a-408f-8793-24e437106d08",
  "b44390f9-31e4-4359-972d-4c5072d76129",
  "52ca2fe9-e3e5-43bd-a65b-1d738f47dac9",
  "567e0317-3fb6-4e6e-a355-3eaee9da7399",
  "b5dac5b6-eca2-4f18-93be-cd70e00efac1",
  "b32e7bcd-cf6e-4e9d-aa8a-02c28f5930c6",
  "db8de132-8c6e-490e-b4a6-30f98b39d2ab",
] as const;

type ApprovedCard = {
  threadId: string;
  requesterEmail: string | null;
  assigneeEmail: string | null;
  relationToMailbox: string | null;
  finalTitle: string;
  requestEvidenceOriginal: string;
  businessObjectEvidence: string | null;
  contextEvidence: string | null;
  requesterCanonicalName: string | null;
  ready_for_persist: boolean;
};

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

function directionFromRelation(
  relation: string | null,
): FeedCandidate["requestDirection"] {
  if (relation === "sent_by_me") return "sent_by_account_owner";
  if (relation === "requested_from_me") return "requested_from_account_owner";
  if (relation === "my_commitment") return "self_commitment";
  if (relation === "external_to_external") return "external_to_external";
  return "unknown";
}

function scopeFromRelation(
  relation: string | null,
): FeedCandidate["responsibilityScope"] {
  if (relation === "sent_by_me") return "external_person";
  if (relation === "requested_from_me") return "account_owner";
  return "unknown";
}

describe.runIf(enabled)("O5A.6.6 controlled persist", () => {
  loadEnvLocal();
  process.env.FEED_EXTRACTION_VERSION = EXTRACTION_VERSION;
  process.env.FEED_AI_ENABLED = "false";

  it(
    "persists four approved cards; feed_items 36→40; no supersede",
    async () => {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );

      const approved = JSON.parse(
        readFileSync(
          path.resolve(process.cwd(), "tmp/o5a66-professional-titles.json"),
          "utf8",
        ),
      ) as { cards: ApprovedCard[] };

      const cards = approved.cards.filter((c) => c.ready_for_persist);
      expect(cards).toHaveLength(4);

      const { count: beforeCount } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true });

      const { data: alreadyPersisted } = await admin
        .from("feed_items")
        .select(
          "id,type,headline,requested_action,evidence_text,status,dedupe_key,action_state,communication_nature,requester_email,assignee_email,relation_to_mailbox,thread_id,extraction_version,due_at,source_message_id,request_evidence_json,business_object,updated_at",
        )
        .eq("user_id", USER_ID)
        .eq("extraction_version", EXTRACTION_VERSION)
        .eq("status", "new");

      const resumeMode = (alreadyPersisted ?? []).length === 4;
      if (!resumeMode) {
        expect(beforeCount).toBe(36);
      } else {
        expect(beforeCount).toBe(40);
      }

      const { data: beforeRows } = await admin
        .from("feed_items")
        .select(
          "id,status,updated_at,extraction_version,headline,dedupe_key,thread_id",
        )
        .eq("user_id", USER_ID);
      const beforeById = new Map(
        (beforeRows ?? []).map((r) => [r.id as string, r]),
      );

      const { data: trueZeroBefore } = await admin
        .from("feed_items")
        .select("id,status,updated_at,dedupe_key,headline")
        .eq("user_id", USER_ID)
        .in("thread_id", [...TRUE_ZERO_THREADS]);

      const persistResults: Array<Record<string, unknown>> = [];
      const insertedIds: string[] = [];
      let totalInserted = 0;
      let totalSkipped = 0;
      let totalSuperseded = 0;

      for (const card of cards) {
        const threadId = card.threadId;
        const ctx = await buildFeedThreadContext({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId,
        });
        expect(ctx, `ctx missing for ${threadId}`).toBeTruthy();

        const sourceMsg = ctx!.messages[ctx!.messages.length - 1]!;
        const sourceMessageId = sourceMsg.id;
        const evidenceText = card.requestEvidenceOriginal.slice(0, 500);
        const relation = (card.relationToMailbox ??
          "unknown") as FeedCandidate["relationToMailbox"];
        const direction = directionFromRelation(relation);
        const scope = scopeFromRelation(relation);
        const speechAct =
          SPEECH_BY_THREAD[threadId] ?? ("directive" as const);
        const title = card.finalTitle.slice(0, 160);

        // Uriel is from envelope ("Uriel nehemia") — keep as-is.
        expect(
          threadId !== "f8c6e04a-d698-4456-a4a3-18055e8e007f" ||
            /Uriel/i.test(card.requesterCanonicalName ?? ""),
        ).toBe(true);

        const requesterEmail = card.requesterEmail;
        const assigneeEmail = card.assigneeEmail;
        const requesterName =
          requesterEmail?.toLowerCase() === "office@trigo-models.com"
            ? CANONICAL
            : (card.requesterCanonicalName ?? null);
        const assigneeName = assigneeEmail
          ? (ASSIGNEE_NAME_BY_EMAIL[assigneeEmail.toLowerCase()] ??
            assigneeEmail)
          : null;

        const candidate: FeedCandidate = {
          type: "action",
          headline: title,
          context: null,
          actorName: requesterName,
          actorEmail: requesterEmail,
          sourceMessageId,
          evidenceText,
          actionOwner: scope,
          responsibilityScope: scope,
          requestDirection: direction,
          relationToMailbox: relation,
          requestedAction: title.slice(0, 240),
          actionVerb: null,
          actionObject: card.businessObjectEvidence,
          actionPurpose: null,
          requester: requesterEmail
            ? {
                name: requesterName,
                email: requesterEmail,
                evidenceText,
              }
            : null,
          assignee: assigneeEmail
            ? {
                name: assigneeName,
                email: assigneeEmail,
                evidenceText,
              }
            : null,
          beneficiary: null,
          responseRecipient: null,
          requestModality: "direct_request",
          requestSpeechAct: speechAct,
          communicationNature: "business_request",
          disposition: "create_action",
          actionState: "requested",
          alertCategory: null,
          alertVerificationState: null,
          attributionConfidence: 0.95,
          semanticPrecisionConfidence: 0.95,
          requestEvidence: {
            sourceMessageId,
            evidenceText,
            evidenceType: "request",
            fromCurrentMessage: true,
          },
          subjectEvidence: null,
          contextEvidence: card.contextEvidence
            ? {
                sourceMessageId,
                evidenceText: card.contextEvidence.slice(0, 500),
                evidenceType: "context",
                fromCurrentMessage: false,
              }
            : null,
          businessObjectEvidence: card.businessObjectEvidence
            ? {
                sourceMessageId,
                evidenceText: card.businessObjectEvidence.slice(0, 500),
                evidenceType: "business_object",
                fromCurrentMessage: true,
              }
            : null,
          supportingEvidence: [],
          businessObject: card.businessObjectEvidence,
          previousValue: null,
          currentValue: null,
          occurredAt: sourceMsg.sentAt ?? new Date().toISOString(),
          requestedAt: sourceMsg.sentAt,
          dueAt: null,
          dueEvidenceText: null,
          dueSourceMessageId: null,
          confidence: 0.95,
          businessRelevanceConfidence: 0.95,
          // Unique topic so we never supersede an existing open action.
          topicKey: `o5a66-recall-${sourceMessageId.slice(0, 8)}`,
          replacesSourceMessageId: null,
        };

        const dedupeKey = computeDedupeKey({
          userId: USER_ID,
          threadId,
          sourceMessageId: candidate.sourceMessageId,
          type: candidate.type,
          evidenceText: candidate.evidenceText,
        });

        const persist = await persistFeedExtraction({
          userId: USER_ID,
          mailAccountId: MAIL_ACCOUNT_ID,
          threadId,
          sourceContentHash: ctx!.sourceContentHash,
          nextState: emptyIntelligenceState(),
          accepted: [candidate],
          lastProcessedMessageId: sourceMessageId,
          intelligenceStatus: "ready",
          // Explicit empty — never supersede priors in this controlled run.
          replaceFeedItemIds: [],
        });

        totalInserted += persist.inserted;
        totalSkipped += persist.skippedDupes;
        totalSuperseded += persist.supersededIds.length;
        insertedIds.push(...persist.insertedIds);

        const existingForThread = (alreadyPersisted ?? []).find(
          (r) => r.thread_id === threadId,
        );

        persistResults.push({
          threadId,
          title,
          speechAct,
          relationToMailbox: relation,
          requesterEmail,
          assigneeEmail,
          requestEvidenceOriginal: evidenceText,
          businessObjectEvidence: card.businessObjectEvidence,
          contextEvidence: card.contextEvidence,
          sourceMessageId,
          dedupeKey,
          inserted: persist.inserted,
          skippedDupes: persist.skippedDupes,
          supersededIds: persist.supersededIds,
          insertedIds:
            persist.insertedIds.length > 0
              ? persist.insertedIds
              : existingForThread
                ? [existingForThread.id]
                : [],
          status: "new",
          actionState: "requested",
          extractionVersion: EXTRACTION_VERSION,
        });
      }

      if (resumeMode) {
        expect(totalInserted).toBe(0);
        expect(totalSkipped).toBe(4);
      } else {
        expect(totalInserted).toBe(4);
        expect(totalSkipped).toBe(0);
      }
      expect(totalSuperseded).toBe(0);

      const resolvedIds =
        insertedIds.length === 4
          ? insertedIds
          : (alreadyPersisted ?? []).map((r) => r.id as string);
      expect(resolvedIds).toHaveLength(4);

      const { count: afterCount } = await admin
        .from("feed_items")
        .select("id", { count: "exact", head: true });
      expect(afterCount).toBe(40);
      if (!resumeMode) {
        expect(afterCount).toBe((beforeCount ?? 0) + totalInserted);
      }

      const { data: afterRows } = await admin
        .from("feed_items")
        .select(
          "id,status,updated_at,extraction_version,headline,dedupe_key,thread_id,type,action_state,requester_email,assignee_email,relation_to_mailbox,evidence_text,requested_action,due_at,source_message_id,request_evidence_json",
        )
        .eq("user_id", USER_ID);

      let existingModified = 0;
      const resolvedSet = new Set(resolvedIds);
      for (const [id, before] of beforeById) {
        if (resolvedSet.has(id)) continue; // newly inserted in this run
        const after = (afterRows ?? []).find((r) => r.id === id);
        expect(after).toBeTruthy();
        if (
          after!.status !== before.status ||
          after!.updated_at !== before.updated_at ||
          after!.headline !== before.headline ||
          after!.dedupe_key !== before.dedupe_key
        ) {
          existingModified += 1;
        }
      }
      expect(existingModified).toBe(0);

      const { data: trueZeroAfter } = await admin
        .from("feed_items")
        .select("id,status,updated_at,dedupe_key,headline")
        .eq("user_id", USER_ID)
        .in("thread_id", [...TRUE_ZERO_THREADS]);
      expect((trueZeroAfter ?? []).length).toBe((trueZeroBefore ?? []).length);
      for (const row of trueZeroBefore ?? []) {
        const after = (trueZeroAfter ?? []).find((r) => r.id === row.id);
        expect(after).toEqual(row);
      }

      const { data: persistedRows } = await admin
        .from("feed_items")
        .select(
          "id,type,headline,requested_action,evidence_text,status,dedupe_key,action_state,communication_nature,requester_email,assignee_email,relation_to_mailbox,thread_id,extraction_version,due_at,source_message_id,request_evidence_json,business_object",
        )
        .in("id", resolvedIds);

      expect(persistedRows).toHaveLength(4);
      for (const row of persistedRows ?? []) {
        expect(row.status).toBe("new");
        expect(row.type).toBe("action");
        expect(row.extraction_version).toBe(EXTRACTION_VERSION);
        expect(row.action_state).toBe("requested");
        expect(row.due_at).toBeNull();
        const approvedCard = cards.find((c) => c.threadId === row.thread_id)!;
        expect(row.headline).toBe(approvedCard.finalTitle);
        expect(row.evidence_text).toBe(approvedCard.requestEvidenceOriginal);
        expect(row.requested_action).toBe(approvedCard.finalTitle);
        // Evidence remains original quote — not rewritten title phrasing alone.
        expect(String(row.evidence_text)).not.toBe(
          "להוריד את הקבצים ולתאם שיחה",
        );
      }

      const feed = await listFeedForUser({ userId: USER_ID, limit: 50 });
      expect(feed).not.toHaveProperty("error");
      const feedItems = "items" in feed ? feed.items : [];
      const insertedSet = new Set(resolvedIds);
      const visible = feedItems
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => insertedSet.has(c.id));
      expect(visible).toHaveLength(4);
      // Feed sorts by source occurred_at; recovered threads may sit among recent mail.
      // Require all four in the first page and among the newest recoverable cluster.
      expect(visible.every(({ index }) => index < 20)).toBe(true);
      expect(visible.every(({ c }) => c.type === "action")).toBe(true);
      expect(
        visible.every(({ c }) => /[\u0590-\u05FF]/.test(c.headline)),
      ).toBe(true);
      expect(
        visible.every(({ c }) => /[\u0590-\u05FF]/.test(c.typeLabel)),
      ).toBe(true);
      expect(visible.every(({ c }) => c.dueAt == null)).toBe(true);
      for (const { c } of visible) {
        expect(c.sourceUrl).toContain(`/source/thread/${c.threadId}`);
        const approvedCard = cards.find((x) => x.threadId === c.threadId)!;
        expect(c.headline).toBe(approvedCard.finalTitle);
        expect(c.relationToMailbox).toBe(approvedCard.relationToMailbox);
        expect(c.requesterEmail?.toLowerCase()).toBe(
          approvedCard.requesterEmail?.toLowerCase(),
        );
      }
      const topVisible = visible
        .slice()
        .sort((a, b) => a.index - b.index)
        .map(({ c, index }) => ({ ...c, feedRank: index + 1 }));

      const rollbackSql = [
        "-- Safe rollback (no DELETE): supersede O5A.6.6 controlled persist rows",
        "update public.feed_items",
        "set status = 'superseded',",
        "    updated_at = now()",
        `where extraction_version = '${EXTRACTION_VERSION}'`,
        "  and status = 'new';",
        "  and user_id = '" + USER_ID + "';",
      ].join("\n");

      const report = {
        evaluationVersion: "o5a6.6_controlled_persist",
        status: "LIVE_FEED_VERIFIED",
        resumeMode,
        constraints: {
          noOpenAi: true,
          noReExtraction: true,
          noEngineChange: true,
          noSupersedeExisting: true,
          noTouchTrueZeros: true,
          noO5B: true,
          noWebhooks: true,
          noPush: true,
          noOnyx: true,
        },
        openaiCalls: 0,
        feedItems: {
          before: resumeMode ? 36 : (beforeCount ?? 0),
          after: afterCount ?? 0,
          expected: "36→40",
          inserted: resumeMode ? 4 : totalInserted,
          skippedDuplicatesOnThisRun: totalSkipped,
          skippedDuplicatesFirstPersist: 0,
          existingItemsModified: existingModified,
          superseded: totalSuperseded,
        },
        trueZerosUntouched: {
          threadCount: TRUE_ZERO_THREADS.length,
          rowsBefore: (trueZeroBefore ?? []).length,
          rowsAfter: (trueZeroAfter ?? []).length,
          unchanged: true,
        },
        persist: {
          extractionVersion: EXTRACTION_VERSION,
          perCard: persistResults,
          rows: persistedRows ?? [],
        },
        liveFeed: {
          sortOrder: "occurred_at desc (source message time)",
          visibleCount: topVisible.length,
          cards: topVisible.map((c) => ({
            id: c.id,
            feedRank: c.feedRank,
            type: c.type,
            typeLabel: c.typeLabel,
            headline: c.headline,
            attributionLine: c.attributionLine,
            askLine: c.askLine,
            requesterEmail: c.requesterEmail,
            assigneeEmail: c.assigneeEmail,
            relationToMailbox: c.relationToMailbox,
            dueAt: c.dueAt,
            sourceUrl: c.sourceUrl,
            threadId: c.threadId,
            status: c.status,
          })),
          rtlHebrewOk: true,
        },
        rollback: {
          method: "status='superseded' by extraction_version (no DELETE)",
          sql: rollbackSql,
        },
      };

      const tmpDir = path.resolve(process.cwd(), "tmp");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        path.join(tmpDir, "o5a66-controlled-persist.json"),
        JSON.stringify(report, null, 2),
        "utf8",
      );

      const md: string[] = [
        "# O5A.6.6 Controlled Persist",
        "",
        "Status: **LIVE_FEED_VERIFIED**",
        "",
        "No OpenAI. No re-extraction. No engine change. No O5B / Webhooks / Push / Onyx.",
        "",
        "## Counts",
        "",
        `- feed_items: 36 → ${afterCount}`,
        `- inserted: 4`,
        `- skipped duplicates (first persist): 0`,
        `- existing items modified: ${existingModified}`,
        `- superseded: ${totalSuperseded}`,
        `- Human True Zeros untouched: ${TRUE_ZERO_THREADS.length} threads`,
        resumeMode
          ? `- verification re-run: skippedDupes=${totalSkipped} (idempotent)`
          : "",
        "",
        "## Inserted Actions",
        "",
      ].filter((line) => line !== "");
      for (const r of persistResults) {
        md.push(`### ${String(r.threadId).slice(0, 8)}…`);
        md.push(`- title: **${r.title}**`);
        md.push(`- speech_act: \`${r.speechAct}\``);
        md.push(`- action_state: requested`);
        md.push(`- status: new`);
        md.push(`- extraction_version: \`${EXTRACTION_VERSION}\``);
        md.push(`- ${r.requesterEmail} → ${r.assigneeEmail} (${r.relationToMailbox})`);
        md.push(`- requestEvidence (original): ${r.requestEvidenceOriginal}`);
        md.push(`- businessObjectEvidence: ${r.businessObjectEvidence}`);
        md.push(`- contextEvidence: ${r.contextEvidence}`);
        md.push(`- source_message_id: ${r.sourceMessageId}`);
        md.push(`- dedupe_key: \`${r.dedupeKey}\``);
        md.push(`- inserted: ${r.inserted}, skippedDupes: ${r.skippedDupes}`);
        md.push("");
      }
      md.push("## Live feed (visible O5A.6.6 cards)");
      md.push("");
      md.push(
        "Feed order is `occurred_at` of the source message (not insert time).",
      );
      md.push("");
      for (const c of report.liveFeed.cards) {
        md.push(
          `- rank #${c.feedRank} **${c.typeLabel}**: ${c.headline} — ${c.requesterEmail} (${c.relationToMailbox}) → ${c.sourceUrl}`,
        );
      }
      md.push("");
      md.push("## Safe rollback (no DELETE)");
      md.push("");
      md.push("```sql");
      md.push(rollbackSql);
      md.push("```");
      md.push("");
      md.push("**STOP** — verification complete.");
      md.push("");

      writeFileSync(
        path.join(tmpDir, "o5a66-controlled-persist.md"),
        md.join("\n"),
        "utf8",
      );

      expect(report.feedItems.after).toBe(40);
    },
    180_000,
  );
});
