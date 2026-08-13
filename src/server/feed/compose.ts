/**
 * Server-side Feed card composition — never trust free-form model headlines.
 */
import type { RelationToMailbox } from "./identity";
import {
  actionTypeLabelForRelation,
  resolveCanonicalParticipantName,
  type CanonicalParticipant,
  type MailboxIdentity,
} from "./identity";

export type ResolvedFeedRequest = {
  relationToMailbox: RelationToMailbox;
  typeLabel: string;
  headline: string;
  requesterDisplayName: string;
  assigneeDisplayName: string;
  requestedAction: string;
  requestedAt: string;
  dueAt: string | null;
  attributionLine: string;
  waitingLine: string | null;
  askLine: string | null;
  canMarkHandled: boolean;
};

/**
 * Prefer validated requestedAction; never invent engineering-approval wording
 * from vague model headlines about "שינויים בתכניות".
 */
export function composeActionHeadline(opts: {
  requestedAction: string | null | undefined;
  modelHeadline?: string | null;
  relationToMailbox: RelationToMailbox;
  assigneeDisplayName: string;
}): string {
  const action = opts.requestedAction?.trim() || "";
  if (action) return action;
  const fallback = opts.modelHeadline?.trim() || "";
  return fallback || "פעולה";
}

export function resolveFeedRequestCard(opts: {
  mailboxIdentity: MailboxIdentity;
  knownParticipants: CanonicalParticipant[];
  relationToMailbox: RelationToMailbox;
  requesterEmail: string | null;
  requesterName: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  requestedAction: string | null;
  modelHeadline?: string | null;
  requestedAt: string;
  dueAt: string | null;
}): ResolvedFeedRequest {
  const requesterDisplayName = resolveCanonicalParticipantName({
    email: opts.requesterEmail,
    sourceDisplayName: opts.requesterName,
    mailboxIdentity: opts.mailboxIdentity,
    knownParticipants: opts.knownParticipants,
  });
  const assigneeDisplayName = resolveCanonicalParticipantName({
    email: opts.assigneeEmail,
    sourceDisplayName: opts.assigneeName,
    mailboxIdentity: opts.mailboxIdentity,
    knownParticipants: opts.knownParticipants,
  });

  const requestedAction = opts.requestedAction?.trim() || "";
  const headline = composeActionHeadline({
    requestedAction,
    modelHeadline: opts.modelHeadline,
    relationToMailbox: opts.relationToMailbox,
    assigneeDisplayName,
  });

  let whenLabel = opts.requestedAt;
  try {
    whenLabel = new Intl.DateTimeFormat("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(opts.requestedAt));
  } catch {
    /* keep */
  }

  const attributionLine = `${requesterDisplayName} → ${assigneeDisplayName} · ${whenLabel}`;

  // Label already encodes "נדרשת ממך פעולה" — avoid a second requester/date line.
  const askLine: string | null = null;

  let waitingLine: string | null = null;
  if (opts.relationToMailbox === "sent_by_me") {
    waitingLine = `ממתינים ל־${assigneeDisplayName}`;
  }

  return {
    relationToMailbox: opts.relationToMailbox,
    typeLabel: actionTypeLabelForRelation(opts.relationToMailbox),
    headline,
    requesterDisplayName,
    assigneeDisplayName,
    requestedAction: requestedAction || headline,
    requestedAt: opts.requestedAt,
    dueAt: opts.dueAt,
    attributionLine,
    waitingLine,
    askLine,
    canMarkHandled:
      opts.relationToMailbox === "requested_from_me" ||
      opts.relationToMailbox === "my_commitment",
  };
}
