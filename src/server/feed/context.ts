import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { stableJsonHash } from "@/server/onyx/normalize/hash";
import { cleanFeedMessageBody } from "./clean-content";
import {
  isAccountIdentityEmail,
  loadAccountIdentities,
  resolveMailboxIdentity,
  resolveMessageAccountRelation,
  type AccountIdentity,
  type MailboxIdentity,
  type MessageAccountRelation,
} from "./identity";
import {
  emptyIntelligenceState,
  ThreadIntelligenceStateSchema,
  type ThreadIntelligenceState,
} from "./schemas";

export type FeedParticipantRef = {
  email: string;
  displayName: string | null;
  isMailboxOwner: boolean;
};

export type FeedContextMessage = {
  id: string;
  subject: string | null;
  sentAt: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  toParticipants: FeedParticipantRef[];
  ccEmails: string[];
  ccParticipants: FeedParticipantRef[];
  bccEmails: string[];
  bccParticipants: FeedParticipantRef[];
  replyToEmail: string | null;
  direction: "inbound" | "outbound";
  isAccountOwner: boolean;
  accountRelation: MessageAccountRelation;
  body: string;
  removedNormalized: string[];
};

export type MessageEnvelope = {
  messageId: string;
  sentAt: string | null;
  from: FeedParticipantRef & { email: string };
  to: FeedParticipantRef[];
  cc: FeedParticipantRef[];
  bcc: FeedParticipantRef[];
  accountRelation: MessageAccountRelation;
  currentMessageText: string;
};

export type FeedExistingItemSummary = {
  id: string;
  type: string;
  headline: string;
  topicKey: string;
  sourceMessageId: string | null;
  status: string;
};

export type FeedThreadContext = {
  userId: string;
  mailAccountId: string;
  threadId: string;
  accountEmail: string;
  accountIdentities: AccountIdentity[];
  mailboxIdentity: MailboxIdentity;
  subject: string | null;
  messages: FeedContextMessage[];
  includedMessageIds: string[];
  previousState: ThreadIntelligenceState;
  existingItems: FeedExistingItemSummary[];
  sourceContentHash: string;
  contextCoverage: "full" | "truncated";
  triggerMessageId: string | null;
};

const MAX_CONTEXT_CHARS = 28_000;
const RECENT_FALLBACK_MESSAGES = 8;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function bodyFromRow(row: {
  clean_conversation: string | null;
  plain_text: string | null;
  quoted_text: string | null;
  signature_plain: string | null;
}): { body: string; removedNormalized: string[] } {
  const rawClean = normalizeWhitespace(row.clean_conversation ?? "");
  const rawPlain = normalizeWhitespace(row.plain_text ?? "");
  const base = rawClean || rawPlain;
  const cleaned = cleanFeedMessageBody(base);
  const removedNormalized = [...cleaned.removedNormalized];
  if (row.quoted_text) {
    removedNormalized.push(normalizeWhitespace(row.quoted_text).toLowerCase());
  }
  if (row.signature_plain) {
    removedNormalized.push(
      normalizeWhitespace(row.signature_plain).toLowerCase(),
    );
  }
  return { body: cleaned.cleanText, removedNormalized };
}

export function computeFeedContentHash(input: {
  threadId: string;
  messages: Array<{ id: string; sentAt: string | null; body: string }>;
}): string {
  return stableJsonHash({
    threadId: input.threadId,
    messages: input.messages.map((m) => ({
      id: m.id,
      sentAt: m.sentAt,
      body: m.body,
    })),
  });
}

export function computeDedupeKey(input: {
  userId: string;
  threadId: string;
  sourceMessageId: string;
  type: string;
  evidenceText: string;
}): string {
  const normalizedEvidence = normalizeWhitespace(input.evidenceText).toLowerCase();
  return createHash("sha256")
    .update(
      [
        input.userId,
        input.threadId,
        input.sourceMessageId,
        input.type,
        normalizedEvidence,
      ].join("|"),
      "utf8",
    )
    .digest("hex");
}

export async function buildFeedThreadContext(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  triggerMessageId?: string | null;
}): Promise<FeedThreadContext | null> {
  const admin = createAdminClient();

  const { data: account, error: accountError } = await admin
    .from("mail_accounts")
    .select("id,email,aliases")
    .eq("user_id", opts.userId)
    .eq("id", opts.mailAccountId)
    .maybeSingle();
  if (accountError) {
    throw new Error(`feed_account_load_failed:${accountError.message}`);
  }
  if (!account) return null;
  const accountEmail = String(account.email ?? "")
    .trim()
    .toLowerCase();
  const accountIdentities = loadAccountIdentities({
    primaryEmail: accountEmail,
    aliases: account.aliases,
  });
  const mailboxIdentity = resolveMailboxIdentity({
    mailAccountId: opts.mailAccountId,
    primaryEmail: accountEmail,
    aliases: account.aliases,
  });

  const { data: thread, error: threadError } = await admin
    .from("threads")
    .select("id,subject")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .eq("id", opts.threadId)
    .maybeSingle();
  if (threadError) throw new Error(`feed_thread_load_failed:${threadError.message}`);
  if (!thread) return null;

  const { data: messageRows, error: messagesError } = await admin
    .from("messages")
    .select(
      "id,subject,plain_text,clean_conversation,quoted_text,signature_plain,provider_date_at,direction",
    )
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (messagesError) {
    throw new Error(`feed_messages_load_failed:${messagesError.message}`);
  }

  const rows = messageRows ?? [];
  const messageIds = rows.map((r) => r.id as string);
  const participantsByMessage = new Map<
    string,
    Array<{ role: string; email: string; name: string | null }>
  >();

  if (messageIds.length > 0) {
    const { data: parts, error: partsError } = await admin
      .from("message_participants")
      .select("message_id,role,email,name,sort_order")
      .eq("user_id", opts.userId)
      .in("message_id", messageIds)
      .order("sort_order", { ascending: true });
    if (partsError) {
      throw new Error(`feed_participants_load_failed:${partsError.message}`);
    }
    for (const p of parts ?? []) {
      const mid = p.message_id as string;
      const list = participantsByMessage.get(mid) ?? [];
      list.push({
        role: String(p.role),
        email: String(p.email ?? ""),
        name: (p.name as string | null) ?? null,
      });
      participantsByMessage.set(mid, list);
    }
  }

  const allMessages: FeedContextMessage[] = rows.map((row) => {
    const parts = participantsByMessage.get(row.id as string) ?? [];
    const from = parts.find((p) => p.role === "from");
    const replyTo = parts.find((p) => p.role === "reply_to");
    const fromEmail = from?.email || null;
    const toParts = parts.filter((p) => p.role === "to");
    const ccParts = parts.filter((p) => p.role === "cc");
    const bccParts = parts.filter((p) => p.role === "bcc");
    const toParticipants: FeedParticipantRef[] = toParts.map((p) => ({
      email: p.email,
      displayName: p.name,
      isMailboxOwner: isAccountIdentityEmail(p.email, accountIdentities),
    }));
    const ccParticipants: FeedParticipantRef[] = ccParts.map((p) => ({
      email: p.email,
      displayName: p.name,
      isMailboxOwner: isAccountIdentityEmail(p.email, accountIdentities),
    }));
    const bccParticipants: FeedParticipantRef[] = bccParts.map((p) => ({
      email: p.email,
      displayName: p.name,
      isMailboxOwner: isAccountIdentityEmail(p.email, accountIdentities),
    }));
    const toEmails = toParticipants.map((p) => p.email).filter(Boolean);
    const ccEmails = ccParticipants.map((p) => p.email).filter(Boolean);
    const bccEmails = bccParticipants.map((p) => p.email).filter(Boolean);
    const direction =
      row.direction === "outbound" ? "outbound" : "inbound";
    const { body, removedNormalized } = bodyFromRow({
      clean_conversation: (row.clean_conversation as string | null) ?? null,
      plain_text: (row.plain_text as string | null) ?? null,
      quoted_text: (row.quoted_text as string | null) ?? null,
      signature_plain: (row.signature_plain as string | null) ?? null,
    });
    return {
      id: row.id as string,
      subject: (row.subject as string | null) ?? null,
      sentAt: (row.provider_date_at as string | null) ?? null,
      fromEmail,
      fromName: from?.name ?? null,
      toEmails,
      toParticipants,
      ccEmails,
      ccParticipants,
      bccEmails,
      bccParticipants,
      replyToEmail: replyTo?.email || null,
      direction,
      isAccountOwner: isAccountIdentityEmail(fromEmail, accountIdentities),
      accountRelation: resolveMessageAccountRelation({
        fromEmail,
        toEmails,
        ccEmails,
        bccEmails,
        accountIdentities,
      }),
      body,
      removedNormalized,
    };
  });

  const { data: stateRow } = await admin
    .from("thread_intelligence_state")
    .select("state_json")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .maybeSingle();

  let previousState = emptyIntelligenceState();
  if (stateRow?.state_json) {
    const parsed = ThreadIntelligenceStateSchema.safeParse(stateRow.state_json);
    if (parsed.success) previousState = parsed.data;
  }

  const { data: existingRows } = await admin
    .from("feed_items")
    .select("id,type,headline,topic_key,source_message_id,status")
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .neq("status", "cancelled")
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(40);

  const existingItems: FeedExistingItemSummary[] = (existingRows ?? []).map(
    (r) => ({
      id: r.id as string,
      type: String(r.type),
      headline: String(r.headline ?? ""),
      topicKey: String(r.topic_key ?? ""),
      sourceMessageId: (r.source_message_id as string | null) ?? null,
      status: String(r.status),
    }),
  );

  const sourceContentHash = computeFeedContentHash({
    threadId: opts.threadId,
    messages: allMessages.map((m) => ({
      id: m.id,
      sentAt: m.sentAt,
      body: m.body,
    })),
  });

  const hasPriorState =
    previousState.openActions.length +
      previousState.decisions.length +
      previousState.deadlines.length +
      previousState.currentFacts.length +
      previousState.resolvedItems.length >
    0;

  let selected = allMessages;
  let contextCoverage: "full" | "truncated" = "full";

  const estimateSize = (msgs: FeedContextMessage[]) =>
    buildFeedUserPayload({
      userId: opts.userId,
      mailAccountId: opts.mailAccountId,
      threadId: opts.threadId,
      accountEmail,
      accountIdentities,
      mailboxIdentity,
      subject: (thread.subject as string | null) ?? null,
      messages: msgs,
      includedMessageIds: msgs.map((m) => m.id),
      previousState: hasPriorState ? previousState : emptyIntelligenceState(),
      existingItems,
      sourceContentHash,
      contextCoverage: "full",
      triggerMessageId: opts.triggerMessageId ?? null,
    }).length;

  if (estimateSize(selected) > MAX_CONTEXT_CHARS) {
    contextCoverage = "truncated";
    if (hasPriorState) {
      const triggerId = opts.triggerMessageId ?? selected.at(-1)?.id ?? null;
      const recent = selected.slice(-RECENT_FALLBACK_MESSAGES);
      const trigger = triggerId
        ? selected.find((m) => m.id === triggerId)
        : null;
      const byId = new Map(recent.map((m) => [m.id, m]));
      if (trigger) byId.set(trigger.id, trigger);
      selected = Array.from(byId.values()).sort((a, b) => {
        const at = a.sentAt ?? "";
        const bt = b.sentAt ?? "";
        return at.localeCompare(bt) || a.id.localeCompare(b.id);
      });
    } else {
      selected = selected.slice(-RECENT_FALLBACK_MESSAGES);
    }
    while (estimateSize(selected) > MAX_CONTEXT_CHARS && selected.length > 1) {
      selected = selected.slice(1);
    }
  }

  return {
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
    accountEmail,
    accountIdentities,
    mailboxIdentity,
    subject: (thread.subject as string | null) ?? null,
    messages: selected,
    includedMessageIds: selected.map((m) => m.id),
    previousState,
    existingItems,
    sourceContentHash,
    contextCoverage,
    triggerMessageId: opts.triggerMessageId ?? null,
  };
}

function formatParticipantList(parts: FeedParticipantRef[]): string {
  if (parts.length === 0) return "";
  return parts
    .map((p) => {
      const flag = p.isMailboxOwner ? " [MAILBOX]" : "";
      return `${p.displayName ?? ""} <${p.email}>${flag}`;
    })
    .join(", ");
}

export function formatFeedMessageBlock(
  m: FeedContextMessage,
  opts?: { asCurrent?: boolean },
): string {
  const bodyLabel = opts?.asCurrent ? "CURRENT_MESSAGE" : "MESSAGE_BODY";
  return [
    "MESSAGE:",
    `ID: ${m.id}`,
    `SENT_AT: ${m.sentAt ?? ""}`,
    `FROM: ${m.fromName ?? ""} <${m.fromEmail ?? ""}>${m.isAccountOwner ? " [MAILBOX]" : ""}`,
    `TO: ${formatParticipantList(m.toParticipants) || m.toEmails.join(", ")}`,
    `CC: ${formatParticipantList(m.ccParticipants) || m.ccEmails.join(", ")}`,
    `BCC: ${formatParticipantList(m.bccParticipants) || m.bccEmails.join(", ")}`,
    `REPLY_TO: ${m.replyToEmail ?? ""}`,
    `DIRECTION: ${m.direction}`,
    `MESSAGE_ACCOUNT_RELATION: ${m.accountRelation}`,
    `IS_ACCOUNT_OWNER_SENDER: ${m.isAccountOwner ? "true" : "false"}`,
    `${bodyLabel}:`,
    m.body,
    "END_MESSAGE",
  ].join("\n");
}

export function buildFeedUserPayload(ctx: FeedThreadContext): string {
  const identities = ctx.accountIdentities
    .map((id) => `- ${id.email} (${id.type})`)
    .join("\n");

  const triggerId =
    ctx.triggerMessageId ??
    ctx.messages.at(-1)?.id ??
    null;
  const current =
    (triggerId
      ? ctx.messages.find((m) => m.id === triggerId)
      : null) ?? ctx.messages.at(-1) ?? null;
  const prior = current
    ? ctx.messages.filter((m) => m.id !== current.id)
    : ctx.messages;

  const header = [
    `THREAD_ID: ${ctx.threadId}`,
    `SUBJECT: ${ctx.subject ?? ""}`,
    "THREAD_ACCOUNT_IDENTITIES (email only — never display names):",
    identities || "- (none)",
    `CONTEXT_COVERAGE: ${ctx.contextCoverage}`,
    `TRIGGER_MESSAGE_ID: ${ctx.triggerMessageId ?? ""}`,
    "",
    "INSTRUCTIONS: Only CURRENT_MESSAGE may open a new request. PRIOR_MESSAGES_FOR_CONTEXT clarifies the object of the request only. Never use prior/quoted text as evidence or deadline. CC alone does not make the account the assignee. MESSAGE_ACCOUNT_RELATION is computed in code.",
    "",
    "PREVIOUS_STATE_JSON:",
    JSON.stringify(ctx.previousState),
    "",
    "EXISTING_ITEMS_JSON:",
    JSON.stringify(
      ctx.existingItems.map((i) => ({
        id: i.id,
        type: i.type,
        headline: i.headline,
        topicKey: i.topicKey,
        sourceMessageId: i.sourceMessageId,
        status: i.status,
      })),
    ),
  ].join("\n");

  const currentBlock = current
    ? `CURRENT_MESSAGE:\n${formatFeedMessageBlock(current, { asCurrent: true })}`
    : "CURRENT_MESSAGE:\n(none)";
  const priorBlock =
    prior.length > 0
      ? `PRIOR_MESSAGES_FOR_CONTEXT:\n${prior.map((m) => formatFeedMessageBlock(m)).join("\n\n")}`
      : "PRIOR_MESSAGES_FOR_CONTEXT:\n(none)";

  return `${header}\n\n${currentBlock}\n\n${priorBlock}`;
}
