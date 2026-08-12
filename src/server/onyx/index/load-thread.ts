import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeThreadDocument,
  type ThreadMessageInput,
  type ThreadNormalizeInput,
} from "@/server/onyx/normalize/thread-document";

type ParticipantRole = ThreadMessageInput["participants"][number]["role"];

export async function loadThreadForNormalize(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
}): Promise<ThreadNormalizeInput | null> {
  const admin = createAdminClient();

  const { data: thread, error: threadError } = await admin
    .from("threads")
    .select("id,user_id,mail_account_id,provider_thread_id,subject,folders")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", opts.mailAccountId)
    .eq("id", opts.threadId)
    .maybeSingle();

  if (threadError) throw new Error(`thread_load_failed:${threadError.message}`);
  if (!thread) return null;

  const { data: messages, error: messagesError } = await admin
    .from("messages")
    .select(
      "id,subject,plain_text,clean_conversation,direction,provider_date_at",
    )
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false });

  if (messagesError) throw new Error(`messages_load_failed:${messagesError.message}`);

  const messageRows = messages ?? [];
  const messageIds = messageRows.map((m) => m.id as string);

  const participantsByMessage = new Map<
    string,
    ThreadMessageInput["participants"]
  >();
  const attachmentsByMessage = new Map<
    string,
    ThreadMessageInput["attachments"]
  >();

  if (messageIds.length > 0) {
    const { data: participants, error: participantsError } = await admin
      .from("message_participants")
      .select("message_id,role,email,name,sort_order")
      .eq("user_id", opts.userId)
      .in("message_id", messageIds)
      .order("sort_order", { ascending: true });

    if (participantsError) {
      throw new Error(`participants_load_failed:${participantsError.message}`);
    }

    for (const row of participants ?? []) {
      const messageId = row.message_id as string;
      const list = participantsByMessage.get(messageId) ?? [];
      list.push({
        role: row.role as ParticipantRole,
        email: String(row.email ?? ""),
        name: (row.name as string | null) ?? null,
      });
      participantsByMessage.set(messageId, list);
    }

    const { data: attachments, error: attachmentsError } = await admin
      .from("attachments_metadata")
      .select("message_id,filename,mime_type,size_bytes,is_inline")
      .eq("user_id", opts.userId)
      .in("message_id", messageIds);

    if (attachmentsError) {
      throw new Error(`attachments_load_failed:${attachmentsError.message}`);
    }

    for (const row of attachments ?? []) {
      if (row.is_inline) continue;
      const messageId = row.message_id as string;
      const list = attachmentsByMessage.get(messageId) ?? [];
      list.push({
        filename: String(row.filename ?? "file"),
        mimeType: (row.mime_type as string | null) ?? null,
        sizeBytes:
          typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes) || null,
      });
      attachmentsByMessage.set(messageId, list);
    }
  }

  const normalizedMessages: ThreadMessageInput[] = messageRows.map((row) => ({
    id: row.id as string,
    subject: String(row.subject ?? ""),
    plainText: (row.plain_text as string | null) ?? null,
    cleanConversation: (row.clean_conversation as string | null) ?? null,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    providerDateAt: (row.provider_date_at as string | null) ?? null,
    participants: participantsByMessage.get(row.id as string) ?? [],
    attachments: attachmentsByMessage.get(row.id as string) ?? [],
  }));

  return {
    userId: opts.userId,
    mailAccountId: opts.mailAccountId,
    threadId: opts.threadId,
    providerThreadId: String(thread.provider_thread_id ?? ""),
    subject: String(thread.subject ?? ""),
    messages: normalizedMessages,
  };
}

export async function buildNormalizedThreadDocument(opts: {
  userId: string;
  mailAccountId: string;
  threadId: string;
}) {
  const input = await loadThreadForNormalize(opts);
  if (!input) return null;
  return normalizeThreadDocument(input);
}
