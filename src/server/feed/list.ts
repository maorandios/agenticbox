import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailAccountForUser } from "@/server/mail/account-service";
import {
  actionTypeLabelForRelation,
  mailboxIdentitiesFrom,
  relationToMailboxFromDirection,
  resolveCanonicalParticipantName,
  resolveMailboxIdentity,
  resolveRequestAttribution,
  type RelationToMailbox,
} from "@/server/feed/identity";
import type {
  FeedCardDto,
  FeedItemStatus,
  FeedListResponse,
  FeedRequestDirection,
  FeedResponsibilityScope,
} from "@/types/feed";

const TYPE_LABELS: Record<string, string> = {
  action: "נדרשת פעולה",
  change: "שינוי",
  decision: "החלטה",
  due: "מועד",
  alert: "התראה לאימות",
};

const DEFAULT_STATUSES: FeedItemStatus[] = ["new", "open", "scheduled"];

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export async function listFeedForUser(opts: {
  userId: string;
  cursor?: string | null;
  limit?: number;
  status?: string | null;
}): Promise<FeedListResponse | { error: "no_account" }> {
  const account = await getMailAccountForUser(opts.userId);
  if (!account || account.syncStatus === "disconnected") {
    return { error: "no_account" };
  }

  const mailbox = resolveMailboxIdentity({
    mailAccountId: account.id,
    primaryEmail: account.email,
    aliases: [],
  });

  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
  const admin = createAdminClient();

  let query = admin
    .from("feed_items")
    .select(
      "id,type,headline,context,actor_name,actor_email,occurred_at,due_at,status,thread_id,source_message_id,created_at,action_owner,responsibility_scope,request_direction,relation_to_mailbox,requester_name,requester_email,assignee_name,assignee_email,requester_display_name,assignee_display_name,requested_at,requested_action",
    )
    .eq("user_id", opts.userId)
    .eq("mail_account_id", account.id)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  } else {
    query = query.in("status", DEFAULT_STATUSES);
  }

  if (opts.cursor) {
    const [occurredAt, id] = opts.cursor.split("|");
    if (occurredAt && id) {
      query = query.or(
        `occurred_at.lt.${occurredAt},and(occurred_at.eq.${occurredAt},id.lt.${id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    if (
      /relation_to_mailbox|requester_display_name|request_direction/i.test(
        String(error.message),
      )
    ) {
      return listFeedForUserLegacy(opts, account.id, account.email, mailbox);
    }
    throw new Error(`feed_list_failed:${error.message}`);
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((r) => mapFeedRow(r, mailbox));
  const last = page.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? `${last.occurred_at}|${last.id}` : null,
  };
}

async function listFeedForUserLegacy(
  opts: {
    userId: string;
    cursor?: string | null;
    limit?: number;
    status?: string | null;
  },
  mailAccountId: string,
  _accountEmail: string,
  mailbox: ReturnType<typeof resolveMailboxIdentity>,
): Promise<FeedListResponse> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30));
  const admin = createAdminClient();
  let query = admin
    .from("feed_items")
    .select(
      "id,type,headline,context,actor_name,actor_email,occurred_at,due_at,status,thread_id,source_message_id,created_at,action_owner,responsibility_scope,request_direction,requester_name,requester_email,assignee_name,assignee_email,requested_at,requested_action",
    )
    .eq("user_id", opts.userId)
    .eq("mail_account_id", mailAccountId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  } else {
    query = query.in("status", DEFAULT_STATUSES);
  }

  const { data, error } = await query;
  if (error) throw new Error(`feed_list_failed:${error.message}`);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map((r) => mapFeedRow(r, mailbox)),
    nextCursor: hasMore && last ? `${last.occurred_at}|${last.id}` : null,
  };
}

function mapFeedRow(
  r: Record<string, unknown>,
  mailbox: ReturnType<typeof resolveMailboxIdentity>,
): FeedCardDto {
  const threadId = r.thread_id as string;
  const messageId = r.source_message_id as string | null;
  const scope = (r.responsibility_scope ??
    r.action_owner ??
    null) as FeedResponsibilityScope | null;
  const type = r.type as FeedCardDto["type"];
  const direction = (r.request_direction as FeedRequestDirection | null) ?? null;
  const requesterEmail = (r.requester_email as string | null) ?? null;
  const assigneeEmail = (r.assignee_email as string | null) ?? null;
  const attributed = resolveRequestAttribution({
    requesterEmail,
    assigneeEmail,
    requestModality: null,
    sourceFromEmail:
      requesterEmail ?? (r.actor_email as string | null) ?? null,
    accountIdentities: mailboxIdentitiesFrom(mailbox),
  });
  const relation =
    (r.relation_to_mailbox as RelationToMailbox | null) ??
    relationToMailboxFromDirection(direction) ??
    attributed.relationToMailbox;
  const requesterName = resolveCanonicalParticipantName({
    email: requesterEmail,
    sourceDisplayName:
      (r.requester_display_name as string | null) ??
      (r.requester_name as string | null),
    mailboxIdentity: mailbox,
  });
  const assigneeName = resolveCanonicalParticipantName({
    email: assigneeEmail,
    sourceDisplayName:
      (r.assignee_display_name as string | null) ??
      (r.assignee_name as string | null),
    mailboxIdentity: mailbox,
  });
  const requestedAt =
    (r.requested_at as string | null) ?? (r.occurred_at as string);
  const whenLabel = formatWhen(requestedAt);

  const typeLabel =
    type === "action"
      ? actionTypeLabelForRelation(relation)
      : (TYPE_LABELS[String(type)] ?? String(type));

  const waitingLine =
    relation === "sent_by_me" ? `ממתינים ל־${assigneeName}` : null;

  // Single attribution line with requestedAt once — no askLine date duplicate.
  const askLine: string | null = null;

  // Prefer server-composed headline from requested_action when present.
  const headline = String(
    (r.requested_action as string | null)?.trim() ||
      (r.headline as string | null) ||
      "",
  );

  return {
    id: r.id as string,
    type,
    typeLabel,
    headline,
    context: null,
    actorName: requesterName,
    actorEmail: requesterEmail,
    occurredAt: String(r.occurred_at),
    dueAt: (r.due_at as string | null) ?? null,
    status: r.status as FeedItemStatus,
    threadId,
    sourceUrl: messageId
      ? `/source/thread/${threadId}?message=${encodeURIComponent(messageId)}`
      : `/source/thread/${threadId}`,
    responsibilityScope: scope,
    requestDirection: direction,
    relationToMailbox: relation,
    requesterName,
    requesterEmail,
    assigneeName,
    assigneeEmail,
    requestedAt,
    attributionLine: `${requesterName} → ${assigneeName} · ${whenLabel}`,
    waitingLine,
    askLine,
    canMarkHandled:
      type !== "action" ||
      relation === "requested_from_me" ||
      relation === "my_commitment",
  };
}

export async function patchFeedItemForUser(opts: {
  userId: string;
  feedItemId: string;
  status: "handled" | "irrelevant" | "open";
}): Promise<"ok" | "not_found" | "no_account"> {
  const account = await getMailAccountForUser(opts.userId);
  if (!account || account.syncStatus === "disconnected") return "no_account";

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("feed_items")
    .update({
      status: opts.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.feedItemId)
    .eq("user_id", opts.userId)
    .eq("mail_account_id", account.id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`feed_patch_failed:${error.message}`);
  if (!data) return "not_found";
  return "ok";
}
