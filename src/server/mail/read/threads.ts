import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailAccountForUser } from "@/server/mail/account-service";
import type { MailboxView } from "@/types/domain";
import type { Participant, Thread } from "@/types/domain";
import {
  participantsFromThreadSummary,
  toThreadDto,
} from "./mappers";

async function activeMailAccountId(userId: string): Promise<string | null> {
  const account = await getMailAccountForUser(userId);
  return account?.id ?? null;
}

export type ThreadListResult = {
  threads: Thread[];
  participants: Participant[];
  nextCursor: string | null;
};

type CursorPayload = { t: string; id: string };

function pageSize(limit?: number) {
  const raw = Number(
    limit ?? process.env.EMAIL_THREADS_PAGE_SIZE ?? 40,
  );
  if (!Number.isFinite(raw)) return 40;
  return Math.min(50, Math.max(30, Math.floor(raw)));
}

function encodeCursor(payload: CursorPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as CursorPayload;
    if (
      typeof parsed?.t === "string" &&
      typeof parsed?.id === "string" &&
      parsed.t &&
      parsed.id
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function applyMailboxFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  mailboxView: MailboxView,
) {
  switch (mailboxView) {
    case "unread":
      return query.eq("unread", true);
    case "starred":
      return query.eq("starred", true);
    case "sent":
      return query.contains("folders", ["SENT"]);
    case "drafts":
      return query.contains("folders", ["DRAFT"]);
    case "archive":
      return query.overlaps("folders", ["ARCHIVE", "CATEGORY_PERSONAL"]);
    case "trash":
      return query.contains("folders", ["TRASH"]);
    case "inbox":
    default:
      // Prefer INBOX when present; otherwise all non-trash threads.
      return query.not("folders", "cs", "{TRASH}");
  }
}

export async function listThreadsForUser(params: {
  userId: string;
  mailboxView: MailboxView;
  cursor?: string | null;
  limit?: number;
}): Promise<ThreadListResult> {
  const mailAccountId = await activeMailAccountId(params.userId);
  if (!mailAccountId) {
    return { threads: [], participants: [], nextCursor: null };
  }

  const admin = createAdminClient();
  const limit = pageSize(params.limit);
  const cursor = decodeCursor(params.cursor);

  let query = admin
    .from("threads")
    .select(
      "id,subject,snippet,unread,starred,latest_message_at,participants_summary,folders",
    )
    .eq("user_id", params.userId)
    .eq("mail_account_id", mailAccountId)
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  query = applyMailboxFilter(query, params.mailboxView);

  if (cursor) {
    query = query.or(
      `latest_message_at.lt.${cursor.t},and(latest_message_at.eq.${cursor.t},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`list_threads_failed:${error.message}`);

  const rows = data ?? [];
  const pageRows = rows.slice(0, limit);
  const threads = pageRows.map(toThreadDto);
  const participantsMap = new Map<string, Participant>();
  for (const row of pageRows) {
    for (const p of participantsFromThreadSummary(row.participants_summary)) {
      participantsMap.set(p.id, p);
    }
  }

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = pageRows[pageRows.length - 1];
    if (last?.latest_message_at && last.id) {
      nextCursor = encodeCursor({
        t: last.latest_message_at as string,
        id: last.id as string,
      });
    }
  }

  return {
    threads,
    participants: [...participantsMap.values()],
    nextCursor,
  };
}

export async function getThreadForUser(params: {
  userId: string;
  threadId: string;
}): Promise<{ thread: Thread; participants: Participant[] } | null> {
  const mailAccountId = await activeMailAccountId(params.userId);
  if (!mailAccountId) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("threads")
    .select(
      "id,subject,snippet,unread,starred,latest_message_at,participants_summary,folders",
    )
    .eq("user_id", params.userId)
    .eq("mail_account_id", mailAccountId)
    .eq("id", params.threadId)
    .maybeSingle();

  if (error) throw new Error(`get_thread_failed:${error.message}`);
  if (!data) return null;

  const thread = toThreadDto(data);
  const participants = participantsFromThreadSummary(data.participants_summary);
  return { thread, participants };
}

export async function getDefaultThreadIdForUser(userId: string) {
  const mailAccountId = await activeMailAccountId(userId);
  if (!mailAccountId) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("threads")
    .select("id")
    .eq("user_id", userId)
    .eq("mail_account_id", mailAccountId)
    .not("folders", "cs", "{TRASH}")
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`default_thread_failed:${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

export async function countAttachmentsForThread(params: {
  userId: string;
  threadId: string;
}) {
  const admin = createAdminClient();
  const { data: messages, error } = await admin
    .from("messages")
    .select("id")
    .eq("user_id", params.userId)
    .eq("thread_id", params.threadId);
  if (error) throw new Error(`thread_messages_failed:${error.message}`);
  const ids = (messages ?? []).map((m) => m.id as string);
  if (!ids.length) return 0;

  let total = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { count, error: aErr } = await admin
      .from("attachments_metadata")
      .select("id", { count: "exact", head: true })
      .eq("user_id", params.userId)
      .eq("is_inline", false)
      .in("message_id", chunk);
    if (aErr) throw new Error(`attachment_count_failed:${aErr.message}`);
    total += count ?? 0;
  }
  return total;
}
