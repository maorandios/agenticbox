import "server-only";
import type { FeedContextMessage } from "./context";
import { composeActionHeadline } from "./compose";
import { FEED_MIN_SEMANTIC_PRECISION } from "./config";
import {
  buildCanonicalParticipantRegistry,
  isAccountIdentityEmail,
  normalizeEmailAddress,
  resolveCanonicalParticipantName,
  resolveMailboxIdentity,
  resolveRequestAttribution,
  type AccountIdentity,
  type MailboxIdentity,
  type RelationToMailbox,
} from "./identity";
import type { FeedCandidate, FeedExtractionResult } from "./schemas";
import {
  classifyRequestSpeechAct,
  hasRequestEvidenceInCurrentMessage,
  refineRequestedAction,
  speechActAllowsActionCoercion,
} from "./speech-act";

export type ValidationFailureReason =
  | "missing_source_message"
  | "evidence_not_found"
  | "evidence_from_removed_section"
  | "actor_email_invalid"
  | "occurred_at_invalid"
  | "due_at_invalid"
  | "due_evidence_missing"
  | "due_evidence_not_found"
  | "due_evidence_not_temporal"
  | "confidence_low"
  | "business_relevance_low"
  | "attribution_confidence_low"
  | "semantic_precision_low"
  | "thread_not_business"
  | "action_owner_invalid"
  | "action_unknown_responsibility"
  | "requester_evidence_invalid"
  | "assignee_evidence_invalid"
  | "requested_action_missing"
  | "change_missing_business_object"
  | "headline_generic"
  | "marketing_cta"
  | "duplicate_candidate";

export type RejectedCandidate = {
  candidate: FeedCandidate;
  reason: ValidationFailureReason;
};

export type AcceptedCandidate = FeedCandidate & {
  responsibilityScope: NonNullable<FeedCandidate["responsibilityScope"]>;
  actionOwner: NonNullable<FeedCandidate["actionOwner"]>;
  requestDirection: NonNullable<FeedCandidate["requestDirection"]>;
  relationToMailbox: RelationToMailbox;
  headline: string;
};

const GENERIC_HEADLINES = new Set([
  "עדכון",
  "מידע",
  "הודעה",
  "מידע חשוב",
  "נדרש טיפול",
  "יש לעדכן",
  "התקבל מייל חדש",
  "לאשר את השינויים בתכנית",
  "לאשר את השינויים",
  "אישור שינוי בתכניות",
  "אישור שינוי בתכניות ביצוע",
  "update",
  "info",
  "message",
  "important update",
  "action required",
]);

const MARKETING_CTA =
  /(?:לחץ כאן|השג כרטיס|גלה את|נסה עכשיו|try now|get tickets|sign up (?:now|free)|learn more|click here|הירשם עכשיו)/i;

/** Explicit temporal phrase required before accepting dueAt. */
const TEMPORAL_EVIDENCE =
  /(?:מחרתיים|מחר|היום|לשבוע(?:\s+הבא)?|השבוע(?:\s+הבא)?|שבוע(?:\s+הבא)?|עד\s+יום|עד\s+ל?תאריך|עד\s+\d|by\s+\w+|tomorrow|today|next\s+(?:week|monday|tuesday|wednesday|thursday|friday)|\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?|\d{4}-\d{2}-\d{2}|יום\s+(?:א׳|ב׳|ג׳|ד׳|ה׳|ו׳|שבת|ראשון|שני|שלישי|רביעי|חמישי|שישי))/i;

function isValidIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function evidenceInClean(
  evidence: string,
  source: FeedContextMessage,
): "ok" | "missing" | "removed" {
  const evidenceNorm = normalizeForMatch(evidence);
  if (!evidenceNorm) return "missing";
  const bodyNorm = normalizeForMatch(source.body);
  if (bodyNorm.includes(evidenceNorm)) return "ok";
  if (source.removedNormalized.some((b) => b.includes(evidenceNorm))) {
    return "removed";
  }
  return "missing";
}

function partyMentioned(
  party: { name: string | null; email: string | null } | null | undefined,
  messages: FeedContextMessage[],
): boolean {
  if (!party) return false;
  const email = normalizeEmailAddress(party.email) ?? "";
  const name = party.name?.trim().toLowerCase() ?? "";
  for (const m of messages) {
    const emails = new Set(
      [
        m.fromEmail,
        ...m.toEmails,
        ...m.ccEmails,
        ...m.bccEmails,
        m.replyToEmail,
      ]
        .map((e) => normalizeEmailAddress(e))
        .filter(Boolean) as string[],
    );
    if (email && emails.has(email)) return true;
    const hay = normalizeForMatch(
      [m.body, m.fromName, m.subject, ...m.toEmails, ...m.ccEmails].join(" "),
    );
    if (name && name.length >= 2 && hay.includes(name)) return true;
  }
  return false;
}

export function hasParseableTemporalExpression(text: string): boolean {
  return TEMPORAL_EVIDENCE.test(text);
}

export function validateExtractionGate(opts: {
  result: FeedExtractionResult;
}): { ok: true } | { ok: false; reason: ValidationFailureReason } {
  const c = opts.result.threadClassification;
  // Marketing / system only. Business, informational, and uncertain may still
  // contain sent_by_me / external_to_external / decisions — validate candidates.
  if (c === "marketing" || c === "system") {
    return { ok: false, reason: "thread_not_business" };
  }
  return { ok: true };
}

export function validateFeedCandidates(opts: {
  candidates: FeedCandidate[];
  messages: FeedContextMessage[];
  accountIdentities: AccountIdentity[];
  mailboxIdentity?: MailboxIdentity;
  minConfidence: number;
  minBusinessRelevance: number;
  minSemanticPrecision?: number;
  existingDedupeKeys: Set<string>;
  computeDedupeKey: (c: FeedCandidate) => string;
}): {
  accepted: AcceptedCandidate[];
  rejected: RejectedCandidate[];
} {
  const mailbox =
    opts.mailboxIdentity ??
    resolveMailboxIdentity({
      mailAccountId: "unknown",
      primaryEmail: opts.accountIdentities[0]?.email ?? "",
      aliases: opts.accountIdentities
        .filter((i) => i.type !== "primary")
        .map((i) => i.email),
    });
  const minSemantic =
    opts.minSemanticPrecision ?? FEED_MIN_SEMANTIC_PRECISION;

  const knownParticipants = buildCanonicalParticipantRegistry({
    mailboxIdentity: mailbox,
    participants: opts.messages.flatMap((m) => [
      { email: m.fromEmail, displayName: m.fromName },
      ...m.toParticipants.map((p) => ({
        email: p.email,
        displayName: p.displayName,
      })),
      ...m.ccParticipants.map((p) => ({
        email: p.email,
        displayName: p.displayName,
      })),
      ...m.bccParticipants.map((p) => ({
        email: p.email,
        displayName: p.displayName,
      })),
    ]),
  });

  const byId = new Map(opts.messages.map((m) => [m.id, m]));
  const emailsInThread = new Set<string>();
  for (const m of opts.messages) {
    for (const e of [
      m.fromEmail,
      ...m.toEmails,
      ...m.ccEmails,
      ...m.bccEmails,
      m.replyToEmail,
    ]) {
      const n = normalizeEmailAddress(e);
      if (n) emailsInThread.add(n);
    }
  }

  const accepted: AcceptedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const seenKeys = new Set<string>(opts.existingDedupeKeys);

  for (const raw of opts.candidates) {
    const candidate: FeedCandidate = { ...raw };
    const source = byId.get(candidate.sourceMessageId);
    if (!source) {
      rejected.push({ candidate, reason: "missing_source_message" });
      continue;
    }

    // Speech-act from CURRENT_MESSAGE — server authoritative.
    const speechAct = classifyRequestSpeechAct({
      body: source.body,
      evidenceText: candidate.evidenceText,
      requestModality: candidate.requestModality,
      type: candidate.type,
    });
    candidate.requestSpeechAct = speechAct;

    // Narrow coercion: change → action only for request speech acts with
    // request evidence in CURRENT_MESSAGE (never status_change / information).
    if (
      candidate.type === "change" &&
      speechActAllowsActionCoercion(speechAct) &&
      hasRequestEvidenceInCurrentMessage(source.body, candidate.evidenceText)
    ) {
      candidate.type = "action";
    }

    const evidenceCheck = evidenceInClean(candidate.evidenceText, source);
    if (evidenceCheck !== "ok") {
      rejected.push({
        candidate,
        reason:
          evidenceCheck === "removed"
            ? "evidence_from_removed_section"
            : "evidence_not_found",
      });
      continue;
    }

    if (!isValidIsoDate(candidate.occurredAt)) {
      rejected.push({ candidate, reason: "occurred_at_invalid" });
      continue;
    }

    // Due date hard rules — evidence must be in CURRENT message only + temporal.
    // Invented deadlines are cleared (null) rather than rejecting the whole action.
    if (candidate.dueAt != null && candidate.dueAt !== "") {
      let dueOk = true;
      if (!isValidIsoDate(candidate.dueAt)) {
        dueOk = false;
      }
      const dueEv = candidate.dueEvidenceText?.trim() ?? "";
      const dueSrc = candidate.dueSourceMessageId?.trim() ?? "";
      if (!dueEv || !dueSrc || dueSrc !== candidate.sourceMessageId) {
        dueOk = false;
      } else {
        const dueMessage = byId.get(dueSrc);
        if (!dueMessage) {
          dueOk = false;
        } else {
          const dueCheck = evidenceInClean(dueEv, dueMessage);
          if (dueCheck !== "ok") dueOk = false;
          else if (!hasParseableTemporalExpression(dueEv)) dueOk = false;
        }
      }
      if (!dueOk) {
        candidate.dueAt = null;
        candidate.dueEvidenceText = null;
        candidate.dueSourceMessageId = null;
      }
    } else {
      candidate.dueAt = null;
      candidate.dueEvidenceText = null;
      candidate.dueSourceMessageId = null;
    }

    if (candidate.confidence < opts.minConfidence) {
      rejected.push({ candidate, reason: "confidence_low" });
      continue;
    }

    if (candidate.businessRelevanceConfidence < opts.minBusinessRelevance) {
      rejected.push({ candidate, reason: "business_relevance_low" });
      continue;
    }

    if (candidate.type === "action") {
      const semantic =
        candidate.semanticPrecisionConfidence ?? candidate.confidence;
      if (semantic < minSemantic) {
        rejected.push({ candidate, reason: "semantic_precision_low" });
        continue;
      }
      candidate.semanticPrecisionConfidence = semantic;

      const requestedActionRaw =
        candidate.requestedAction?.trim() ||
        candidate.headline?.trim() ||
        "";
      if (!requestedActionRaw) {
        rejected.push({ candidate, reason: "requested_action_missing" });
        continue;
      }
      // General refinement from CURRENT_MESSAGE speech — no golden hardcodes.
      const refined = refineRequestedAction({
        body: source.body,
        action: requestedActionRaw,
        speechAct,
        requesterDisplayName: source.fromName,
      });
      candidate.requestedAction = refined;

      // Requester = CURRENT_MESSAGE sender (email is source of truth).
      candidate.requester = {
        name: source.fromName,
        email: source.fromEmail,
        evidenceText:
          candidate.requester?.evidenceText?.trim() ||
          candidate.evidenceText,
      };
      const requester = candidate.requester;

      // Prefer explicitly addressed TO recipient when body names them /
      // uses second-person / imperative toward a mailbox owner in TO.
      let assignee = candidate.assignee ?? null;
      const ownerToken =
        mailbox.canonicalDisplayName.split(/[\s|]+/).find(Boolean) || "";
      const ownerNamed =
        ownerToken.length >= 2 &&
        new RegExp(
          `(?:^|[\\s,])${ownerToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$|[,"'])`,
          "i",
        ).test(source.body);
      const addressedMailbox =
        source.toEmails.some((e) =>
          isAccountIdentityEmail(e, opts.accountIdentities),
        ) &&
        (ownerNamed ||
          /תבדוק|תענה|תאשר|תשלח|(?:\bאתה\b|\bאת\b)/i.test(source.body));
      if (addressedMailbox) {
        const mailboxTo = source.toParticipants.find((p) => p.isMailboxOwner);
        if (mailboxTo) {
          assignee = {
            name: mailbox.canonicalDisplayName,
            email: mailboxTo.email,
            evidenceText:
              assignee?.evidenceText?.trim() || candidate.evidenceText,
          };
          candidate.assignee = assignee;
        }
      }

      if (requester) {
        const emailMatch =
          Boolean(requester.email) &&
          normalizeEmailAddress(requester.email) ===
            normalizeEmailAddress(source.fromEmail);
        if (!emailMatch) {
          rejected.push({ candidate, reason: "requester_evidence_invalid" });
          continue;
        }
      }

      if (assignee) {
        const assigneeEmail = normalizeEmailAddress(assignee.email) ?? "";
        const inTo = source.toEmails.some(
          (e) => normalizeEmailAddress(e) === assigneeEmail,
        );
        const aCheck = evidenceInClean(
          assignee.evidenceText || candidate.evidenceText,
          source,
        );
        const actionEvOk =
          evidenceInClean(candidate.evidenceText, source) === "ok";
        const secondPerson =
          /(?:\bאתה\b|\bאת\b|\byou\b|\byour\b)/i.test(candidate.evidenceText) ||
          /(?:\bאתה\b|\bאת\b|\byou\b|\byour\b)/i.test(source.body);
        const imperativeToRecipient =
          /(?:נא\s*לאשר|נא\s*לשלוח|חסר\s+|תבדוק|תענה|please\s+approve|please\s+send)/i.test(
            candidate.evidenceText,
          ) ||
          /(?:נא\s*לאשר|נא\s*לשלוח|חסר\s+|תבדוק|תענה)/i.test(source.body);
        const namedInBody =
          Boolean(assignee.name) &&
          normalizeForMatch(source.body).includes(
            normalizeForMatch(assignee.name!),
          );
        if (aCheck === "ok") {
          // ok
        } else if (
          inTo &&
          actionEvOk &&
          (secondPerson ||
            imperativeToRecipient ||
            namedInBody ||
            partyMentioned(assignee, opts.messages) ||
            isAccountIdentityEmail(assignee.email, opts.accountIdentities))
        ) {
          // Deterministic: To-header + request directed at recipient.
        } else if (
          assigneeEmail &&
          !emailsInThread.has(assigneeEmail) &&
          !partyMentioned(assignee, opts.messages)
        ) {
          rejected.push({ candidate, reason: "assignee_evidence_invalid" });
          continue;
        } else {
          rejected.push({ candidate, reason: "assignee_evidence_invalid" });
          continue;
        }
      }

      // Never treat CC-only mailbox presence as assignee.
      if (
        assignee &&
        isAccountIdentityEmail(assignee.email, opts.accountIdentities) &&
        !source.toEmails.some((e) =>
          isAccountIdentityEmail(e, opts.accountIdentities),
        ) &&
        !isAccountIdentityEmail(source.fromEmail, opts.accountIdentities)
      ) {
        const onlyCc =
          source.ccEmails.some((e) =>
            isAccountIdentityEmail(e, opts.accountIdentities),
          ) ||
          source.bccEmails.some((e) =>
            isAccountIdentityEmail(e, opts.accountIdentities),
          );
        if (onlyCc) {
          rejected.push({ candidate, reason: "assignee_evidence_invalid" });
          continue;
        }
      }

      const attributed = resolveRequestAttribution({
        requesterEmail: requester?.email,
        assigneeEmail: assignee?.email,
        requestModality: candidate.requestModality,
        sourceFromEmail: source.fromEmail,
        accountIdentities: opts.accountIdentities,
      });

      if (
        attributed.requestDirection === "self_commitment" &&
        !assignee?.email
      ) {
        candidate.assignee = {
          name: mailbox.canonicalDisplayName,
          email: source.fromEmail,
          evidenceText: candidate.evidenceText,
        };
        assignee = candidate.assignee;
      }

      // Canonical display names — never persist raw From variants for mailbox.
      if (candidate.requester) {
        candidate.requester = {
          ...candidate.requester,
          name: resolveCanonicalParticipantName({
            email: candidate.requester.email,
            sourceDisplayName: candidate.requester.name,
            mailboxIdentity: mailbox,
            knownParticipants,
          }),
        };
      }
      if (candidate.assignee) {
        candidate.assignee = {
          ...candidate.assignee,
          name: resolveCanonicalParticipantName({
            email: candidate.assignee.email,
            sourceDisplayName: candidate.assignee.name,
            mailboxIdentity: mailbox,
            knownParticipants,
          }),
        };
      }
      if (candidate.beneficiary) {
        candidate.beneficiary = {
          ...candidate.beneficiary,
          name: resolveCanonicalParticipantName({
            email: candidate.beneficiary.email,
            sourceDisplayName: candidate.beneficiary.name,
            mailboxIdentity: mailbox,
            knownParticipants,
          }),
        };
      }
      if (candidate.responseRecipient) {
        candidate.responseRecipient = {
          ...candidate.responseRecipient,
          name: resolveCanonicalParticipantName({
            email: candidate.responseRecipient.email,
            sourceDisplayName: candidate.responseRecipient.name,
            mailboxIdentity: mailbox,
            knownParticipants,
          }),
        };
      }

      candidate.requestDirection = attributed.requestDirection;
      candidate.relationToMailbox = attributed.relationToMailbox;
      candidate.responsibilityScope = attributed.responsibilityScope;
      candidate.actionOwner = attributed.responsibilityScope;

      // Never keep model-suggested relation when emails disagree.
      if (
        candidate.requester?.email &&
        candidate.assignee?.email &&
        !isAccountIdentityEmail(
          candidate.requester.email,
          opts.accountIdentities,
        ) &&
        !isAccountIdentityEmail(
          candidate.assignee.email,
          opts.accountIdentities,
        )
      ) {
        candidate.requestDirection = "external_to_external";
        candidate.relationToMailbox = "external_to_external";
        candidate.responsibilityScope = "external_person";
        candidate.actionOwner = "external_person";
      }

      // Server-composed headline — model free text is draft only.
      candidate.headline = composeActionHeadline({
        requestedAction: candidate.requestedAction,
        modelHeadline: candidate.headline,
        relationToMailbox: attributed.relationToMailbox,
        assigneeDisplayName: candidate.assignee?.name ?? "",
      });

      const attr = candidate.attributionConfidence ?? candidate.confidence;
      if (attr < opts.minConfidence) {
        rejected.push({ candidate, reason: "attribution_confidence_low" });
        continue;
      }
      candidate.attributionConfidence = attr;

      if (attributed.responsibilityScope === "unknown") {
        rejected.push({ candidate, reason: "action_unknown_responsibility" });
        continue;
      }

      if (candidate.requester) {
        candidate.actorName = candidate.requester.name;
        candidate.actorEmail = candidate.requester.email;
      }

      if (!candidate.requestedAt) {
        candidate.requestedAt = source.sentAt ?? candidate.occurredAt;
      }
    }

    if (candidate.type === "change") {
      const obj = candidate.businessObject?.trim() ?? "";
      if (!obj) {
        rejected.push({ candidate, reason: "change_missing_business_object" });
        continue;
      }
      candidate.actionOwner = candidate.actionOwner ?? "unknown";
      candidate.responsibilityScope =
        candidate.responsibilityScope ?? "unknown";
      candidate.requestDirection = candidate.requestDirection ?? "unknown";
    }

    if (candidate.type === "decision") {
      candidate.actionOwner = candidate.actionOwner ?? "unknown";
      candidate.responsibilityScope =
        candidate.responsibilityScope ?? "unknown";
      candidate.requestDirection = candidate.requestDirection ?? "unknown";
    }

    if (candidate.actorEmail) {
      const email = normalizeEmailAddress(candidate.actorEmail);
      if (!email || !emailsInThread.has(email)) {
        if (candidate.type !== "action") {
          rejected.push({ candidate, reason: "actor_email_invalid" });
          continue;
        }
      }
    }

    const headline = (candidate.headline ?? "").trim();
    if (!headline || GENERIC_HEADLINES.has(headline.toLowerCase())) {
      rejected.push({ candidate, reason: "headline_generic" });
      continue;
    }

    if (
      MARKETING_CTA.test(headline) ||
      MARKETING_CTA.test(candidate.evidenceText) ||
      MARKETING_CTA.test(candidate.context ?? "")
    ) {
      rejected.push({ candidate, reason: "marketing_cta" });
      continue;
    }

    const key = opts.computeDedupeKey(candidate);
    if (seenKeys.has(key)) {
      rejected.push({ candidate, reason: "duplicate_candidate" });
      continue;
    }
    seenKeys.add(key);

    // Final authoritative attribution at accept time (ignore model relation).
    let finalDirection = candidate.requestDirection ?? "unknown";
    let finalRelation = candidate.relationToMailbox ?? "unknown";
    let finalScope = candidate.responsibilityScope ?? "unknown";
    if (candidate.type === "action") {
      const finalAttr = resolveRequestAttribution({
        requesterEmail: candidate.requester?.email,
        assigneeEmail: candidate.assignee?.email,
        requestModality: candidate.requestModality,
        sourceFromEmail: byId.get(candidate.sourceMessageId)?.fromEmail,
        accountIdentities: opts.accountIdentities,
      });
      finalDirection = finalAttr.requestDirection;
      finalRelation = finalAttr.relationToMailbox;
      finalScope = finalAttr.responsibilityScope;
    }

    accepted.push({
      ...candidate,
      headline,
      actionOwner: finalScope,
      responsibilityScope: finalScope,
      requestDirection: finalDirection,
      relationToMailbox: finalRelation,
    });
  }

  return { accepted, rejected };
}
