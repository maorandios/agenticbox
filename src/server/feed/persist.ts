import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDedupeKey } from "./context";
import { getFeedConfig } from "./config";
import { finalizeFeedItemReplacement } from "./replace";
import type { FeedCandidate, ThreadIntelligenceState } from "./schemas";

export type PersistFeedResult = {
  inserted: number;
  skippedDupes: number;
  insertedIds: string[];
  supersededIds: string[];
};

function buildRow(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  item: FeedCandidate;
  dedupeKey: string;
  supersedesId: string | null;
  extractionVersion: string;
  now: string;
}) {
  const { item } = opts;
  const scope = item.responsibilityScope ?? item.actionOwner ?? null;
  return {
    user_id: opts.userId,
    mail_account_id: opts.mailAccountId,
    thread_id: opts.threadId,
    source_message_id: item.sourceMessageId,
    type: item.type,
    headline: item.headline.trim(),
    context: item.context,
    actor_name: item.actorName,
    actor_email: item.actorEmail,
    evidence_text: item.evidenceText,
    occurred_at: item.occurredAt,
    due_at: item.dueAt,
    confidence: item.confidence,
    importance: item.businessRelevanceConfidence,
    business_relevance_confidence: item.businessRelevanceConfidence,
    action_owner: scope,
    responsibility_scope: scope,
    business_object: item.businessObject,
    requested_action: item.requestedAction ?? null,
    requester_name: item.requester?.name ?? null,
    requester_email: item.requester?.email ?? null,
    assignee_name: item.assignee?.name ?? null,
    assignee_email: item.assignee?.email ?? null,
    beneficiary_name: item.beneficiary?.name ?? null,
    beneficiary_email: item.beneficiary?.email ?? null,
    request_modality: item.requestModality ?? null,
    request_direction: item.requestDirection ?? null,
    relation_to_mailbox: item.relationToMailbox ?? null,
    response_recipient_name: item.responseRecipient?.name ?? null,
    response_recipient_email: item.responseRecipient?.email ?? null,
    semantic_precision_confidence: item.semanticPrecisionConfidence ?? null,
    action_verb: item.actionVerb ?? null,
    action_object: item.actionObject ?? null,
    action_purpose: item.actionPurpose ?? null,
    request_evidence_json: item.requestEvidence ?? null,
    supporting_evidence_json: item.supportingEvidence ?? null,
    requester_display_name: item.requester?.name ?? null,
    assignee_display_name: item.assignee?.name ?? null,
    attribution_confidence: item.attributionConfidence ?? null,
    requested_at: item.requestedAt ?? item.occurredAt,
    due_evidence_text: item.dueEvidenceText ?? null,
    due_source_message_id: item.dueSourceMessageId ?? null,
    alert_category: item.alertCategory ?? null,
    alert_verification_state: item.alertVerificationState ?? null,
    communication_nature: item.communicationNature ?? null,
    action_state: item.actionState ?? null,
    topic_key: item.topicKey,
    dedupe_key: opts.dedupeKey,
    status: "new",
    extraction_version: opts.extractionVersion,
    supersedes_feed_item_id: opts.supersedesId,
    created_at: opts.now,
    updated_at: opts.now,
  };
}

export async function persistFeedExtraction(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  sourceContentHash: string;
  nextState: ThreadIntelligenceState;
  accepted: FeedCandidate[];
  lastProcessedMessageId: string | null;
  intelligenceStatus: "ready" | "needs_review";
  /** Explicit prior cards to supersede only AFTER successful insert. */
  replaceFeedItemIds?: string[];
  replaceStatusReason?: string;
}): Promise<PersistFeedResult> {
  const admin = createAdminClient();
  const config = getFeedConfig();
  const now = new Date().toISOString();
  const replaceIds = new Set(opts.replaceFeedItemIds ?? []);
  const replaceReason =
    opts.replaceStatusReason ?? "replaced_by_newer_extraction";

  const { data: existing } = await admin
    .from("feed_items")
    .select("id,dedupe_key,source_message_id,type,topic_key,status")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId);

  const byDedupe = new Map(
    (existing ?? [])
      .filter(
        (r) =>
          r.status !== "superseded" &&
          r.status !== "cancelled" &&
          r.status !== "needs_replacement",
      )
      .map((r) => [r.dedupe_key as string, r]),
  );
  const openOrNeedsByTopic = new Map(
    (existing ?? [])
      .filter((r) =>
        ["new", "open", "needs_replacement"].includes(String(r.status)),
      )
      .map((r) => [`${r.type}:${r.topic_key}`, r]),
  );

  let inserted = 0;
  let skippedDupes = 0;
  const insertedIds: string[] = [];
  const supersededIds: string[] = [];

  for (const item of opts.accepted) {
    const dedupeKey = computeDedupeKey({
      userId: opts.userId,
      threadId: opts.threadId,
      sourceMessageId: item.sourceMessageId,
      type: item.type,
      evidenceText: item.evidenceText,
    });
    if (byDedupe.has(dedupeKey)) {
      skippedDupes += 1;
      continue;
    }

    const conflictingSuperseded = (existing ?? []).find(
      (r) =>
        r.dedupe_key === dedupeKey &&
        (r.status === "superseded" ||
          r.status === "cancelled" ||
          r.status === "needs_replacement"),
    );
    if (conflictingSuperseded?.id) {
      await admin
        .from("feed_items")
        .update({
          dedupe_key: `${dedupeKey}:archived:${conflictingSuperseded.id}`,
          updated_at: now,
        })
        .eq("id", conflictingSuperseded.id)
        .eq("user_id", opts.userId);
    }

    // Resolve which prior card this replacement should supersede — DO NOT
    // mutate it until insert succeeds.
    let supersedesId: string | null = null;
    if (replaceIds.size > 0) {
      supersedesId = [...replaceIds][0] ?? null;
    } else if (item.type === "change" || item.replacesSourceMessageId) {
      const prior =
        openOrNeedsByTopic.get(`${item.type}:${item.topicKey}`) ??
        openOrNeedsByTopic.get(`action:${item.topicKey}`) ??
        null;
      if (prior?.id) supersedesId = prior.id as string;
    } else if (item.type === "action") {
      const prior =
        openOrNeedsByTopic.get(`action:${item.topicKey}`) ?? null;
      if (prior?.id) supersedesId = prior.id as string;
    }

    const row = buildRow({
      userId: opts.userId,
      mailAccountId: opts.mailAccountId,
      threadId: opts.threadId,
      item,
      dedupeKey,
      supersedesId,
      extractionVersion: config.extractionVersion,
      now,
    });

    let insertedRow: { id: string } | null = null;
    let { data, error } = await admin
      .from("feed_items")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (
      error &&
      /request_direction|relation_to_mailbox|response_recipient|semantic_precision|request_evidence|supporting_evidence|action_verb|requester_display_name|superseded_by/i.test(
        String(error.message),
      )
    ) {
      const withoutNew = { ...row } as Record<string, unknown>;
      for (const k of [
        "request_direction",
        "relation_to_mailbox",
        "response_recipient_name",
        "response_recipient_email",
        "semantic_precision_confidence",
        "action_verb",
        "action_object",
        "action_purpose",
        "request_evidence_json",
        "supporting_evidence_json",
        "requester_display_name",
        "assignee_display_name",
      ]) {
        delete withoutNew[k];
      }
      ({ data, error } = await admin
        .from("feed_items")
        .insert(withoutNew)
        .select("id")
        .maybeSingle());
    }

    if (error) {
      if (error.code === "23505") {
        skippedDupes += 1;
        continue;
      }
      // Insert failed — leave any prior item untouched (no supersede).
      throw new Error(`feed_item_insert_failed:${error.message}`);
    }

    insertedRow = data as { id: string } | null;
    if (!insertedRow?.id) {
      throw new Error("feed_item_insert_failed:missing_id");
    }

    inserted += 1;
    insertedIds.push(insertedRow.id);
    byDedupe.set(dedupeKey, {
      id: insertedRow.id,
      dedupe_key: dedupeKey,
      source_message_id: item.sourceMessageId,
      type: item.type,
      topic_key: item.topicKey,
      status: "new",
    });

    // ONLY NOW supersede the prior card.
    if (supersedesId) {
      const fin = await finalizeFeedItemReplacement({
        userId: opts.userId,
        oldFeedItemId: supersedesId,
        newFeedItemId: insertedRow.id,
        statusReason: replaceReason,
      });
      if (!fin.ok) {
        // Compensating rollback: remove the new card so we don't leave both.
        await admin
          .from("feed_items")
          .delete()
          .eq("id", insertedRow.id)
          .eq("user_id", opts.userId);
        throw new Error(`feed_replace_finalize_failed:${fin.error}`);
      }
      supersededIds.push(supersedesId);
      replaceIds.delete(supersedesId);
      openOrNeedsByTopic.delete(`${item.type}:${item.topicKey}`);
    }
  }

  const { data: existingState } = await admin
    .from("thread_intelligence_state")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .maybeSingle();

  if (existingState?.id) {
    const { error } = await admin
      .from("thread_intelligence_state")
      .update({
        source_content_hash: opts.sourceContentHash,
        state_json: opts.nextState,
        last_processed_message_id: opts.lastProcessedMessageId,
        last_extracted_at: now,
        status: opts.intelligenceStatus,
        updated_at: now,
      })
      .eq("user_id", opts.userId)
      .eq("thread_id", opts.threadId);
    if (error) throw new Error(`feed_state_update_failed:${error.message}`);
  } else {
    const { error } = await admin.from("thread_intelligence_state").insert({
      user_id: opts.userId,
      mail_account_id: opts.mailAccountId,
      thread_id: opts.threadId,
      source_content_hash: opts.sourceContentHash,
      state_json: opts.nextState,
      last_processed_message_id: opts.lastProcessedMessageId,
      last_extracted_at: now,
      status: opts.intelligenceStatus,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(`feed_state_insert_failed:${error.message}`);
  }

  return { inserted, skippedDupes, insertedIds, supersededIds };
}
