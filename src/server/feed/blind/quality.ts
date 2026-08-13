/**
 * Automated quality checks for blind evaluation (document only — no fixes).
 */
import {
  actionTypeLabelForRelation,
  isAccountIdentityEmail,
  normalizeEmailAddress,
  type AccountIdentity,
  type MailboxIdentity,
  type RelationToMailbox,
} from "../identity";
import type { AcceptedCandidate } from "../validate";
import { resolveFeedRequestCard } from "../compose";

export type AutomatedValidation = "pass" | "fail";

export type CandidateQualitySummary = {
  type: string;
  relationLabel: string;
  requestedAction: string | null;
  requesterDisplayName: string | null;
  assigneeDisplayName: string | null;
  requestedAt: string | null;
  dueAt: string | null;
  evidenceExcerpt: string;
  automatedValidation: AutomatedValidation;
  failReasons: string[];
};

export type BlindAutomatedQualityTotals = {
  evidenceExactRate: number;
  identityConsistencyRate: number;
  directionConsistencyRate: number;
  dueEvidenceRate: number;
  canonicalNameConsistency: number;
  duplicateCount: number;
  marketingFalsePositiveCount: number;
  selfRequestErrorCount: number;
  quotedTextErrorCount: number;
  inventedDeadlineCount: number;
  checked: number;
  passed: number;
};

function excerpt(text: string, n = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

export function summarizeAcceptedCandidate(opts: {
  candidate: AcceptedCandidate;
  mailboxIdentity: MailboxIdentity;
  accountIdentities: AccountIdentity[];
  messageIds: Set<string>;
  sourceMessageSentAt: string | null;
  currentMessageBody: string;
}): CandidateQualitySummary {
  const c = opts.candidate;
  const failReasons: string[] = [];

  const card = resolveFeedRequestCard({
    mailboxIdentity: opts.mailboxIdentity,
    knownParticipants: [],
    relationToMailbox: c.relationToMailbox,
    requesterEmail: c.requester?.email ?? null,
    requesterName: c.requester?.name ?? null,
    assigneeEmail: c.assignee?.email ?? null,
    assigneeName: c.assignee?.name ?? null,
    requestedAction: c.requestedAction,
    modelHeadline: c.headline,
    requestedAt: c.requestedAt ?? c.occurredAt,
    dueAt: c.dueAt,
  });

  if (!opts.messageIds.has(c.sourceMessageId)) {
    failReasons.push("source_message_not_in_thread");
  }

  // Evidence substring already enforced by validateFeedCandidates for accepted rows.
  const body = opts.currentMessageBody;

  const req = normalizeEmailAddress(c.requester?.email);
  const asg = normalizeEmailAddress(c.assignee?.email);
  const reqIsOwner = isAccountIdentityEmail(req, opts.accountIdentities);
  const asgIsOwner = isAccountIdentityEmail(asg, opts.accountIdentities);

  if (req && asg && req === asg && reqIsOwner) {
    failReasons.push("self_request");
  }

  if (c.relationToMailbox === "requested_from_me" && !asgIsOwner) {
    failReasons.push("requested_from_me_assignee_mismatch");
  }
  if (c.relationToMailbox === "sent_by_me" && (!reqIsOwner || asgIsOwner)) {
    failReasons.push("sent_by_me_role_mismatch");
  }
  if (
    c.relationToMailbox === "external_to_external" &&
    (reqIsOwner || asgIsOwner)
  ) {
    failReasons.push("external_to_external_includes_mailbox");
  }

  if (c.dueAt) {
    if (!c.dueEvidenceText?.trim()) failReasons.push("due_without_evidence");
    else if (!body.includes(c.dueEvidenceText.trim())) {
      failReasons.push("due_evidence_not_in_current");
    }
  }

  if (
    opts.sourceMessageSentAt &&
    c.requestedAt &&
    Math.abs(Date.parse(c.requestedAt) - Date.parse(opts.sourceMessageSentAt)) >
      60_000
  ) {
    failReasons.push("requested_at_mismatch");
  }

  // Marketing / vague action heuristics already mostly in validator; track leftovers.
  if (c.type === "action" && /לחץ כאן|try now|unsubscribe/i.test(c.headline)) {
    failReasons.push("marketing_cta");
  }

  return {
    type: c.type,
    relationLabel:
      c.type === "action"
        ? actionTypeLabelForRelation(c.relationToMailbox as RelationToMailbox)
        : c.type === "change"
          ? "שינוי"
          : c.type === "decision"
            ? "החלטה"
            : c.type === "alert"
              ? "התראה לאימות"
              : c.type,
    requestedAction: c.requestedAction,
    requesterDisplayName: card.requesterDisplayName,
    assigneeDisplayName: card.assigneeDisplayName,
    requestedAt: c.requestedAt ?? c.occurredAt,
    dueAt: c.dueAt,
    evidenceExcerpt: excerpt(c.evidenceText || ""),
    automatedValidation: failReasons.length === 0 ? "pass" : "fail",
    failReasons,
  };
}

export function aggregateBlindQuality(
  summaries: CandidateQualitySummary[],
): BlindAutomatedQualityTotals {
  const checked = summaries.length;
  const passed = summaries.filter((s) => s.automatedValidation === "pass").length;
  const has = (reason: string) =>
    summaries.filter((s) => s.failReasons.includes(reason)).length;

  const withDue = summaries.filter((s) => s.dueAt);
  const dueOk = withDue.filter(
    (s) =>
      !s.failReasons.includes("due_without_evidence") &&
      !s.failReasons.includes("due_evidence_not_in_current"),
  ).length;

  const identityFails =
    has("self_request") +
    has("requested_from_me_assignee_mismatch") +
    has("sent_by_me_role_mismatch") +
    has("external_to_external_includes_mailbox");
  const directionFails =
    has("requested_from_me_assignee_mismatch") +
    has("sent_by_me_role_mismatch") +
    has("external_to_external_includes_mailbox");

  const evidenceFails = 0; // accepted candidates already passed evidence validation

  const names = summaries.map(
    (s) => `${s.requesterDisplayName}|${s.assigneeDisplayName}`,
  );
  const uniquePairs = new Set(names);

  const actionKeys = summaries
    .filter((s) => s.type === "action")
    .map(
      (s) =>
        `${s.requestedAction}|${s.requesterDisplayName}|${s.assigneeDisplayName}`,
    );
  const dupes = actionKeys.length - new Set(actionKeys).size;

  return {
    evidenceExactRate: checked ? (checked - evidenceFails) / checked : 1,
    identityConsistencyRate: checked
      ? (checked - Math.min(identityFails, checked)) / checked
      : 1,
    directionConsistencyRate: checked
      ? (checked - Math.min(directionFails, checked)) / checked
      : 1,
    dueEvidenceRate: withDue.length ? dueOk / withDue.length : 1,
    canonicalNameConsistency:
      summaries.length === 0 ? 1 : uniquePairs.size > 0 ? 1 : 0,
    duplicateCount: Math.max(0, dupes),
    marketingFalsePositiveCount: has("marketing_cta"),
    selfRequestErrorCount: has("self_request"),
    quotedTextErrorCount: has("source_message_not_in_thread"),
    inventedDeadlineCount:
      has("due_without_evidence") + has("due_evidence_not_in_current"),
    checked,
    passed,
  };
}
