import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDirection } from "./direction";
import { sanitizeEmailHtml } from "@/server/mail/sanitize/html";
import type {
  NylasEmailName,
  NylasMessage,
  NylasThread,
} from "./nylas-types";

function unixToIso(unix?: number | null) {
  if (unix == null || Number.isNaN(unix)) return null;
  return new Date(unix * 1000).toISOString();
}

function normalizeEmail(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

export { resolveDirection };

function participantsSummary(thread: NylasThread) {
  return (thread.participants ?? []).map((p) => ({
    email: normalizeEmail(p.email),
    name: p.name ?? null,
  }));
}

export async function upsertThread(params: {
  userId: string;
  mailAccountId: string;
  thread: NylasThread;
}) {
  const admin = createAdminClient();
  const latest =
    params.thread.latestMessageReceivedDate ??
    params.thread.latestMessageSentDate ??
    params.thread.earliestMessageDate;

  const row = {
    user_id: params.userId,
    mail_account_id: params.mailAccountId,
    provider_thread_id: params.thread.id,
    subject: params.thread.subject ?? "",
    snippet: params.thread.snippet ?? "",
    latest_message_at: unixToIso(latest),
    message_count: params.thread.messageIds?.length ?? 0,
    unread: Boolean(params.thread.unread),
    starred: Boolean(params.thread.starred),
    folders: params.thread.folders ?? [],
    participants_summary: participantsSummary(params.thread),
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("threads")
    .upsert(row, { onConflict: "mail_account_id,provider_thread_id" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`thread_upsert_failed:${error?.message ?? "unknown"}`);
  }
  return data.id as string;
}

async function replaceParticipants(params: {
  userId: string;
  messageId: string;
  message: NylasMessage;
}) {
  const admin = createAdminClient();
  await admin.from("message_participants").delete().eq("message_id", params.messageId);

  const rows: Array<{
    user_id: string;
    message_id: string;
    role: "from" | "to" | "cc" | "bcc" | "reply_to";
    email: string;
    name: string | null;
    sort_order: number;
  }> = [];

  const push = (
    role: "from" | "to" | "cc" | "bcc" | "reply_to",
    list: NylasEmailName[] | undefined,
  ) => {
    (list ?? []).forEach((person, index) => {
      const email = normalizeEmail(person.email);
      if (!email) return;
      rows.push({
        user_id: params.userId,
        message_id: params.messageId,
        role,
        email,
        name: person.name ?? null,
        sort_order: index,
      });
    });
  };

  push("from", params.message.from);
  push("to", params.message.to);
  push("cc", params.message.cc);
  push("bcc", params.message.bcc);
  push("reply_to", params.message.replyTo);

  if (rows.length) {
    const { error } = await admin.from("message_participants").insert(rows);
    if (error) {
      throw new Error(`participants_upsert_failed:${error.message}`);
    }
  }
}

async function replaceAttachments(params: {
  userId: string;
  messageId: string;
  message: NylasMessage;
}) {
  const admin = createAdminClient();
  await admin.from("attachments_metadata").delete().eq("message_id", params.messageId);

  const attachments = params.message.attachments ?? [];
  if (!attachments.length) return 0;

  const rows = attachments.map((att) => ({
    user_id: params.userId,
    message_id: params.messageId,
    provider_attachment_id: att.id,
    filename: att.filename || "attachment",
    mime_type: att.contentType ?? null,
    size_bytes: att.size ?? null,
    is_inline: Boolean(att.isInline),
    content_id: att.contentId ?? null,
    disposition: att.contentDisposition ?? null,
  }));

  const { error } = await admin.from("attachments_metadata").insert(rows);
  if (error) {
    throw new Error(`attachments_upsert_failed:${error.message}`);
  }
  return rows.length;
}

export async function upsertMessage(params: {
  userId: string;
  mailAccountId: string;
  threadId: string;
  accountEmail: string;
  aliases: string[];
  message: NylasMessage;
}): Promise<{ attachmentCount: number }> {
  const admin = createAdminClient();
  const rawHtml = params.message.body ?? null;
  const sanitized = sanitizeEmailHtml(rawHtml);
  const direction = resolveDirection({
    from: params.message.from,
    accountEmail: params.accountEmail,
    aliases: params.aliases,
  });
  const nowIso = new Date().toISOString();

  const row = {
    user_id: params.userId,
    mail_account_id: params.mailAccountId,
    thread_id: params.threadId,
    provider_message_id: params.message.id,
    provider_thread_id: params.message.threadId ?? "",
    subject: params.message.subject ?? "",
    snippet: params.message.snippet ?? "",
    sanitized_html: sanitized.sanitizedHtml,
    plain_text: sanitized.plainText,
    extraction_status: sanitized.extractionStatus,
    provider_date_at: unixToIso(params.message.date),
    received_at: nowIso,
    synced_at: nowIso,
    direction,
    unread: Boolean(params.message.unread),
    starred: Boolean(params.message.starred),
    is_draft: false,
    updated_at: nowIso,
  };

  const { data, error } = await admin
    .from("messages")
    .upsert(row, { onConflict: "mail_account_id,provider_message_id" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`message_upsert_failed:${error?.message ?? "unknown"}`);
  }

  const messageId = data.id as string;

  if (rawHtml) {
    const { error: rawError } = await admin.rpc("upsert_message_raw_source", {
      p_user_id: params.userId,
      p_mail_account_id: params.mailAccountId,
      p_message_id: messageId,
      p_raw_html: rawHtml,
      p_source_encoding: "utf-8",
    });
    if (rawError) {
      await admin
        .from("messages")
        .update({ extraction_status: "sanitize_failed" })
        .eq("id", messageId);
      throw new Error(`raw_source_upsert_failed:${rawError.message}`);
    }
  }

  await replaceParticipants({
    userId: params.userId,
    messageId,
    message: params.message,
  });

  const attachmentCount = await replaceAttachments({
    userId: params.userId,
    messageId,
    message: params.message,
  });

  return { attachmentCount };
}
