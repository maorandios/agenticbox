import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailAccountForUser } from "@/server/mail/account-service";
import { sanitizeEmailHtml } from "@/server/mail/sanitize/html";
import type { Attachment, Message, Participant } from "@/types/domain";
import {
  toAttachmentDto,
  toMessageDto,
  toParticipant,
} from "./mappers";

export type ThreadMessagesResult = {
  messages: Message[];
  participants: Participant[];
  attachments: Attachment[];
};

async function loadRawHtmlByMessageId(params: {
  userId: string;
  messageIds: string[];
}) {
  const admin = createAdminClient();
  const map = new Map<string, string>();
  for (const messageId of params.messageIds) {
    const { data, error } = await admin.rpc("get_message_raw_html", {
      p_user_id: params.userId,
      p_message_id: messageId,
    });
    if (error) {
      // RPC may be missing until migration 0010 is applied.
      break;
    }
    if (typeof data === "string" && data.trim()) {
      map.set(messageId, data);
    }
  }
  return map;
}

export async function getMessagesForThreadOwned(params: {
  userId: string;
  threadId: string;
}): Promise<ThreadMessagesResult | null> {
  const account = await getMailAccountForUser(params.userId);
  if (!account) return null;

  const admin = createAdminClient();

  const { data: thread, error: tErr } = await admin
    .from("threads")
    .select("id")
    .eq("user_id", params.userId)
    .eq("mail_account_id", account.id)
    .eq("id", params.threadId)
    .maybeSingle();
  if (tErr) throw new Error(`thread_lookup_failed:${tErr.message}`);
  if (!thread) return null;

  const { data: rows, error } = await admin
    .from("messages")
    .select(
      "id,thread_id,subject,snippet,plain_text,sanitized_html,provider_date_at,direction,quoted_text",
    )
    .eq("user_id", params.userId)
    .eq("thread_id", params.threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`messages_failed:${error.message}`);

  const messageIds = (rows ?? []).map((r) => r.id as string);
  const participantsByMessage = new Map<
    string,
    { role: string; email: string; name: string | null }[]
  >();

  for (let i = 0; i < messageIds.length; i += 100) {
    const chunk = messageIds.slice(i, i + 100);
    if (!chunk.length) continue;
    const { data: parts, error: pErr } = await admin
      .from("message_participants")
      .select("message_id,role,email,name")
      .eq("user_id", params.userId)
      .in("message_id", chunk)
      .order("sort_order", { ascending: true });
    if (pErr) throw new Error(`participants_failed:${pErr.message}`);
    for (const p of parts ?? []) {
      const mid = p.message_id as string;
      const list = participantsByMessage.get(mid) ?? [];
      list.push({
        role: p.role as string,
        email: p.email as string,
        name: (p.name as string | null) ?? null,
      });
      participantsByMessage.set(mid, list);
    }
  }

  const attachmentsByMessage = new Map<string, Attachment[]>();
  const cidMaps = new Map<string, Map<string, string>>();
  const allAttachments: Attachment[] = [];

  for (let i = 0; i < messageIds.length; i += 100) {
    const chunk = messageIds.slice(i, i + 100);
    if (!chunk.length) continue;
    const { data: atts, error: aErr } = await admin
      .from("attachments_metadata")
      .select(
        "id,message_id,filename,mime_type,size_bytes,is_inline,content_id",
      )
      .eq("user_id", params.userId)
      .in("message_id", chunk);
    if (aErr) throw new Error(`attachments_failed:${aErr.message}`);
    for (const row of atts ?? []) {
      const dto = toAttachmentDto(row as never);
      allAttachments.push(dto);
      const mid = row.message_id as string;
      const list = attachmentsByMessage.get(mid) ?? [];
      list.push(dto);
      attachmentsByMessage.set(mid, list);
      if (row.content_id) {
        const cidMap = cidMaps.get(mid) ?? new Map<string, string>();
        const cid = String(row.content_id).replace(/^<|>$/g, "").toLowerCase();
        cidMap.set(cid, dto.id);
        cidMap.set(`<${cid}>`, dto.id);
        cidMaps.set(mid, cidMap);
      }
    }
  }

  const rawByMessage = await loadRawHtmlByMessageId({
    userId: params.userId,
    messageIds,
  });

  const participantsMap = new Map<string, Participant>();
  const messages: Message[] = (rows ?? []).map((row) => {
    const parts = participantsByMessage.get(row.id as string) ?? [];
    const fromRow = parts.find((p) => p.role === "from");
    const from = fromRow
      ? toParticipant({ email: fromRow.email, name: fromRow.name })
      : null;
    const to = parts
      .filter((p) => p.role === "to")
      .map((p) => toParticipant({ email: p.email, name: p.name }));
    const cc = parts
      .filter((p) => p.role === "cc")
      .map((p) => toParticipant({ email: p.email, name: p.name }));
    if (from) participantsMap.set(from.id, from);
    for (const p of [...to, ...cc]) participantsMap.set(p.id, p);

    const atts = attachmentsByMessage.get(row.id as string) ?? [];
    const raw = rawByMessage.get(row.id as string);
    const refreshed = raw ? sanitizeEmailHtml(raw) : null;
    const rowForDto = refreshed?.sanitizedHtml
      ? {
          ...row,
          sanitized_html: refreshed.sanitizedHtml,
          plain_text: refreshed.plainText ?? row.plain_text,
        }
      : row;

    return toMessageDto({
      row: rowForDto as never,
      from,
      to,
      cc,
      attachmentIds: atts.filter((a) => !a.inlineInBody).map((a) => a.id),
      cidToAttachmentId: cidMaps.get(row.id as string) ?? new Map(),
    });
  });

  return {
    messages,
    participants: [...participantsMap.values()],
    attachments: allAttachments,
  };
}
