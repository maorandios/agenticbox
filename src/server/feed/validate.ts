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
  alertCategoryForNature,
  bodyHasLegalOrSecurityClaim,
  classifyActionState,
  detectCommunicationNature,
  dispositionForNature,
  evidenceSupportsRequestedAction,
  findLegalEvidenceSnippet,
  isGreetingOnlyEvidence,
  isUserInitiatedVerification,
  transactionalNoticeIsHighRisk,
} from "./safety";
import {
  classifyRequestSpeechAct,
  extractBusinessObjectSpan,
  hasRequestEvidenceInCurrentMessage,
  refineRequestedAction,
  speechActAllowsActionCoercion,
  speechActAllowsOpenAction,
} from "./speech-act";
import {
  applyProfessionalTitleGate,
  type ProfessionalTitleResult,
} from "./professional-title";
import {
  applyTitleQualityGate,
  composeSpecificTitle,
  type TitleQualityResult,
} from "./title-quality";
import {
  buildRejectedCandidateAudit,
  evidenceMatchesHaystack,
  extractCurrentMessageLead,
  normalizeForEvidenceMatch,
  rejectionStageForReason,
  type RejectedCandidateAudit,
} from "./evidence-match";

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
  | "duplicate_candidate"
  | "verification_solicitation"
  | "cold_outreach"
  | "already_sent_not_action"
  | "informational_not_action"
  | "request_evidence_missing"
  | "request_evidence_greeting"
  | "request_evidence_semantic_mismatch"
  | "speech_act_not_actionable"
  | "disposition_suppress"
  | "legal_consolidated_to_alert"
  | "action_state_not_open";

export type RejectedCandidate = {
  candidate: FeedCandidate;
  reason: ValidationFailureReason;
  audit?: RejectedCandidateAudit;
};

export type AcceptedCandidate = FeedCandidate & {
  responsibilityScope: NonNullable<FeedCandidate["responsibilityScope"]>;
  actionOwner: NonNullable<FeedCandidate["actionOwner"]>;
  requestDirection: NonNullable<FeedCandidate["requestDirection"]>;
  relationToMailbox: RelationToMailbox;
  headline: string;
  /** O5A.6.5/6.6 — title quality + professional normalization (eval/persist gate). */
  titleQuality?: TitleQualityResult;
  professionalTitle?: ProfessionalTitleResult;
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
  return normalizeForEvidenceMatch(text);
}

function evidenceInClean(
  evidence: string,
  source: FeedContextMessage,
): "ok" | "missing" | "removed" {
  if (!evidence.trim()) return "missing";
  if (evidenceMatchesHaystack(evidence, source.body)) return "ok";
  // CURRENT_MESSAGE subject is part of the envelope — exact span only (no paraphrase).
  if (
    source.subject &&
    evidenceMatchesHaystack(evidence, source.subject)
  ) {
    return "ok";
  }
  if (
    source.removedNormalized.some((b) => evidenceMatchesHaystack(evidence, b))
  ) {
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
  const nature = opts.result.communicationNature;
  if (c === "marketing" || c === "system") {
    return { ok: false, reason: "thread_not_business" };
  }
  if (
    nature === "marketing" ||
    nature === "cold_outreach" ||
    nature === "verification_solicitation"
  ) {
    return { ok: false, reason: "disposition_suppress" };
  }
  // Model disposition=suppress is advisory only — candidate validators decide.
  // informational/uncertain classifications may still carry recoverable asks.
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

  // Recover short approval/review asks when the model returns nothing.
  let workingCandidates = [...opts.candidates];
  if (workingCandidates.length === 0 && opts.messages.length > 0) {
    const current = opts.messages[opts.messages.length - 1]!;
    const currentLead = extractCurrentMessageLead(current.body);
    const nature = detectCommunicationNature({
      subject: current.subject,
      body: current.body,
      fromEmail: current.fromEmail,
      fromName: current.fromName,
    });
    if (
      nature !== "verification_solicitation" &&
      nature !== "cold_outreach" &&
      nature !== "marketing" &&
      nature !== "legal_or_security_claim" &&
      nature !== "system_notification"
    ) {
      const act = classifyRequestSpeechAct({
        body: currentLead,
        evidenceText: `${current.subject ?? ""}\n${currentLead}`,
        subject: current.subject,
      });
      if (
        speechActAllowsOpenAction(act) &&
        (act === "approval_request" ||
          act === "review_request" ||
          act === "response_request" ||
          act === "implicit_missing_item_request" ||
          act === "directive" ||
          act === "permission_request")
      ) {
        const obj =
          extractBusinessObjectSpan({
            body: currentLead,
            subject: current.subject,
          }) ?? "";
        // Explicit ask markers — Hebrew + English structural forms (no domain hardcodes).
        const EXPLICIT_ASK =
          /לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|נא\s+(?:לאשר|אשר|לבדוק|התייחסותך|להגיש|לשלוח|להוריד)|בבקשה\s+(?:להגיש|לשלוח|לאשר|לבדוק|להוריד)|חסר\s+\S{2,}|לטיפול(?:כם|ך)|אשמח\s+(?:לאישור|שת)|(?:^|[\s,.;:])(?:תוריד|תבדוק|תאשר|תשלח|תטפל|תציץ)\b|תדבר\s+איתי|please\s+(?:approve|review|check|send|download|reply|confirm)|(?:^|[\s])(?:review|approve|download|send)\s+(?:the|this|our)\b/i;
        const askMatch = currentLead.match(EXPLICIT_ASK);
        const subjectAsk = (current.subject ?? "").match(EXPLICIT_ASK);
        if (!askMatch && !subjectAsk) {
          // No recoverable open ask in CURRENT lead/subject.
        } else {
          const evidenceText = (
            askMatch?.[0] && currentLead.includes(askMatch[0])
              ? (() => {
                  const idx = currentLead.indexOf(askMatch[0]);
                  const start = Math.max(0, idx - 80);
                  const end = Math.min(
                    currentLead.length,
                    idx + askMatch[0].length + 80,
                  );
                  return currentLead.slice(start, end);
                })()
              : subjectAsk
                ? (current.subject ?? currentLead)
                : currentLead
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          const composed =
            composeSpecificTitle({
              speechAct: act,
              requestEvidence: evidenceText,
              businessObject: obj || null,
              subject: current.subject,
              bodyLead: currentLead,
            }) ?? null;
          // Prefer concrete composed title; never emit bare generic placeholders.
          const requestedAction =
            composed ??
            (obj
              ? act === "approval_request"
                ? `לאשר את ${obj}`
                : act === "review_request"
                  ? `לבדוק את ${obj}`
                  : act === "response_request"
                    ? `להשיב לגבי ${obj}`
                    : act === "directive"
                      ? `לטפל ב${obj}`
                      : act === "permission_request"
                        ? `לאשר ${obj}`
                        : `לשלוח את ${obj}`
              : null);
          if (!requestedAction) {
            // Insufficient structure for a recoverable empty-candidate action.
          } else {
          workingCandidates = [
            {
              type: "action",
              headline: "טיוטה",
              context: null,
              actorName: current.fromName,
              actorEmail: current.fromEmail,
              sourceMessageId: current.id,
              evidenceText,
              actionOwner: null,
              responsibilityScope: null,
              requestDirection: null,
              relationToMailbox: null,
              requestedAction,
              actionVerb: null,
              actionObject: obj || null,
              actionPurpose: null,
              requester: {
                name: current.fromName,
                email: current.fromEmail,
                evidenceText,
              },
              assignee: (() => {
                const fromMailbox = isAccountIdentityEmail(
                  current.fromEmail,
                  opts.accountIdentities,
                );
                if (fromMailbox) {
                  const external =
                    current.toParticipants.find((p) => !p.isMailboxOwner) ??
                    null;
                  const externalEmail =
                    external?.email ??
                    current.toEmails.find(
                      (e) =>
                        !isAccountIdentityEmail(e, opts.accountIdentities),
                    ) ??
                    null;
                  return {
                    name: external?.displayName ?? null,
                    email: externalEmail,
                    evidenceText,
                  };
                }
                const mailboxTo = current.toParticipants.find(
                  (p) => p.isMailboxOwner,
                );
                return {
                  name: mailboxTo
                    ? (opts.mailboxIdentity?.canonicalDisplayName ?? null)
                    : null,
                  email:
                    mailboxTo?.email ??
                    opts.accountIdentities[0]?.email ??
                    null,
                  evidenceText,
                };
              })(),
              beneficiary: null,
              responseRecipient: null,
              requestModality:
                act === "implicit_missing_item_request"
                  ? "implicit_request"
                  : "direct_request",
              requestSpeechAct: act,
              communicationNature: "business_request",
              disposition: "create_action",
              actionState: "requested",
              alertCategory: null,
              alertVerificationState: null,
              attributionConfidence: 0.9,
              semanticPrecisionConfidence: 0.95,
              requestEvidence: {
                sourceMessageId: current.id,
                evidenceText,
                evidenceType: "request",
                fromCurrentMessage: true,
              },
              subjectEvidence: null,
              contextEvidence: null,
              businessObjectEvidence: obj
                ? {
                    sourceMessageId: current.id,
                    evidenceText: obj,
                    evidenceType: "business_object",
                    fromCurrentMessage: true,
                  }
                : null,
              supportingEvidence: [],
              businessObject: obj || null,
              previousValue: null,
              currentValue: null,
              occurredAt: current.sentAt ?? new Date().toISOString(),
              requestedAt: current.sentAt,
              dueAt: null,
              dueEvidenceText: null,
              dueSourceMessageId: null,
              confidence: 0.92,
              businessRelevanceConfidence: 0.9,
              topicKey: `implicit-${act}`,
              replacesSourceMessageId: null,
            },
          ];
          }
        }
      }
    }
  }

  for (const raw of workingCandidates) {
    const candidate: FeedCandidate = { ...raw };
    const source = byId.get(candidate.sourceMessageId);
    if (!source) {
      rejected.push({ candidate, reason: "missing_source_message" });
      continue;
    }

    // Speech-act from CURRENT lead — ignore nested forward/quote instructions.
    const currentLead = extractCurrentMessageLead(source.body);
    const speechAct = classifyRequestSpeechAct({
      body: currentLead,
      evidenceText: candidate.evidenceText,
      requestModality: candidate.requestModality,
      type: candidate.type,
      subject: source.subject,
    });
    candidate.requestSpeechAct = speechAct;

    const nature = detectCommunicationNature({
      subject: source.subject,
      body: source.body,
      fromEmail: source.fromEmail,
      fromName: source.fromName,
    });
    candidate.communicationNature = nature;
    const disposition = dispositionForNature(nature, source.body);
    candidate.disposition = disposition;

    if (
      nature === "verification_solicitation" &&
      isUserInitiatedVerification(source.body)
    ) {
      candidate.type = "alert";
      candidate.alertCategory = "suspicious_sender";
      candidate.alertVerificationState = "unverified";
      candidate.disposition = "create_alert";
      candidate.headline = candidate.headline?.trim() || "אימות לאישור מקור";
      candidate.requestedAction =
        candidate.requestedAction?.trim() ||
        "מומלץ לאמת את זהות השולח לפני השלמת האימות";
    } else if (
      nature === "verification_solicitation" &&
      candidate.type !== "alert"
    ) {
      rejected.push({ candidate, reason: "verification_solicitation" });
      continue;
    }
    if (nature === "cold_outreach" && candidate.type === "action") {
      rejected.push({
        candidate,
        reason: "cold_outreach",
        audit: buildRejectedCandidateAudit({
          candidate,
          reason: "cold_outreach",
          stage: "safety",
        }),
      });
      continue;
    }

    const actionStateEarly = classifyActionState({
      body: source.body,
      evidenceText: candidate.evidenceText,
      requestedAction: candidate.requestedAction,
    });
    candidate.actionState = actionStateEarly;

    const recoverableOpenAction =
      candidate.type === "action" &&
      actionStateEarly === "requested" &&
      speechActAllowsOpenAction(speechAct) &&
      hasRequestEvidenceInCurrentMessage(
        source.body,
        candidate.requestEvidence?.evidenceText?.trim() ||
          candidate.evidenceText,
        source.subject,
      ) &&
      nature !== "marketing" &&
      nature !== "system_notification" &&
      nature !== "verification_solicitation" &&
      nature !== "cold_outreach";

    if (
      (nature === "marketing" || nature === "system_notification") &&
      candidate.type === "action" &&
      disposition === "suppress"
    ) {
      rejected.push({
        candidate,
        reason: "disposition_suppress",
        audit: buildRejectedCandidateAudit({
          candidate,
          reason: "disposition_suppress",
          stage: "safety",
        }),
      });
      continue;
    }

    if (
      nature === "informational" &&
      candidate.type === "action" &&
      disposition === "suppress" &&
      !recoverableOpenAction
    ) {
      rejected.push({
        candidate,
        reason: "disposition_suppress",
        audit: buildRejectedCandidateAudit({
          candidate,
          reason: "disposition_suppress",
          stage: "safety",
        }),
      });
      continue;
    }

    if (recoverableOpenAction && disposition === "suppress") {
      candidate.disposition = "create_action";
    }

    // Legal / security claim → at most one alert (not multiple actions).
    if (nature === "legal_or_security_claim") {
      if (candidate.type === "action" || candidate.type === "change") {
        candidate.type = "alert";
        candidate.alertCategory =
          alertCategoryForNature(nature, source.body) ?? "legal";
        candidate.alertVerificationState = "unverified";
        candidate.disposition = "create_alert";
        candidate.requestedAction =
          candidate.requestedAction?.trim() ||
          "דרישה רגישה לאימות לפני פעולה";
        candidate.headline =
          candidate.alertCategory === "legal"
            ? "דרישה משפטית לאימות"
            : candidate.headline;
      }
    }

    if (
      nature === "transactional_notice" &&
      transactionalNoticeIsHighRisk(source.body) &&
      candidate.type === "action"
    ) {
      candidate.type = "alert";
      candidate.alertCategory =
        alertCategoryForNature(nature, source.body) ?? "payment";
      candidate.alertVerificationState = "not_required";
      candidate.disposition = "create_alert";
    }

    const actionState = actionStateEarly;

    // Narrow coercion: change → action only for request speech acts with
    // request evidence in CURRENT_MESSAGE (never status_change / information).
    if (
      candidate.type === "change" &&
      speechActAllowsActionCoercion(speechAct) &&
      hasRequestEvidenceInCurrentMessage(
        source.body,
        candidate.evidenceText,
        source.subject,
      )
    ) {
      candidate.type = "action";
    }

    let evidenceCheck = evidenceInClean(candidate.evidenceText, source);
    // Legal/security alerts may paraphrase; recover an exact legal snippet from body.
    if (
      evidenceCheck !== "ok" &&
      (candidate.type === "alert" ||
        nature === "legal_or_security_claim" ||
        bodyHasLegalOrSecurityClaim(source.body))
    ) {
      const legalSnippet = findLegalEvidenceSnippet(source.body);
      if (legalSnippet && evidenceInClean(legalSnippet, source) === "ok") {
        candidate.evidenceText = legalSnippet;
        candidate.type = "alert";
        candidate.alertCategory =
          candidate.alertCategory ??
          alertCategoryForNature("legal_or_security_claim", source.body) ??
          "legal";
        candidate.alertVerificationState =
          candidate.alertVerificationState ?? "unverified";
        candidate.communicationNature = "legal_or_security_claim";
        candidate.disposition = "create_alert";
        candidate.headline =
          candidate.headline?.trim() && candidate.headline !== "טיוטה"
            ? candidate.headline
            : "התקבלה דרישה משפטית הדורשת אימות";
        candidate.context =
          candidate.context?.trim() ||
          "השולח טוען להפרת זכויות ודורש הסרת תוכן. יש לאמת את זהות השולח והמסמך לפני פעולה.";
        evidenceCheck = "ok";
      }
    }
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

      if (
        actionState === "already_sent" ||
        actionState === "completed" ||
        actionState === "informational"
      ) {
        rejected.push({
          candidate,
          reason:
            actionState === "already_sent"
              ? "already_sent_not_action"
              : actionState === "informational"
                ? "informational_not_action"
                : "action_state_not_open",
        });
        continue;
      }
      // requested / committed open; uncertain falls through to speech-act gate.
      if (!speechActAllowsOpenAction(speechAct)) {
        rejected.push({ candidate, reason: "speech_act_not_actionable" });
        continue;
      }

      const requestEvCandidates = [
        candidate.requestEvidence?.evidenceText?.trim() || "",
        candidate.evidenceText.trim(),
      ].filter((t, i, arr) => t.length > 0 && arr.indexOf(t) === i);

      let requestEvText = requestEvCandidates[0] ?? "";
      if (!requestEvText) {
        rejected.push({ candidate, reason: "request_evidence_missing" });
        continue;
      }
      if (isGreetingOnlyEvidence(requestEvText)) {
        rejected.push({ candidate, reason: "request_evidence_greeting" });
        continue;
      }

      // Prefer a request span that lives in CURRENT lead (or subject ask),
      // so stale requestEvidence fields do not poison a valid evidenceText.
      const subjectCarriesAsk =
        !!source.subject &&
        /לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|אשמח\s+(?:לאישור|שת)|תציץ|תדבר\s+איתי|נא\s+(?:לאשר|לבדוק)|לטיפול(?:כם|ך)/i.test(
          source.subject,
        );
      const locatedRequest = requestEvCandidates.find((ev) => {
        const inLead = evidenceMatchesHaystack(ev, currentLead);
        const inSubject =
          !!source.subject && evidenceMatchesHaystack(ev, source.subject);
        return inLead || (inSubject && subjectCarriesAsk);
      });
      if (!locatedRequest) {
        rejected.push({
          candidate,
          reason: "request_evidence_missing",
          audit: buildRejectedCandidateAudit({
            candidate,
            reason: "request_evidence_missing",
            stage: "evidence",
          }),
        });
        continue;
      }
      requestEvText = locatedRequest;

      if (
        !hasRequestEvidenceInCurrentMessage(
          currentLead,
          requestEvText,
          source.subject,
        )
      ) {
        rejected.push({ candidate, reason: "request_evidence_missing" });
        continue;
      }

      const businessObj =
        extractBusinessObjectSpan({
          body: currentLead,
          subject: source.subject,
        }) ||
        candidate.businessObjectEvidence?.evidenceText?.trim() ||
        null;
      const shortDirectedAsk =
        /(?:איך|האם|מה)\s+(?:אתה|את|אתם)|נא\s+התייחסותך|how\s+(?:should|do)\s+you|אשמח\s+שת|תציץ|תדבר\s+איתי|לעיונ(?:ך|כם)|לבדיקת(?:ך|כם)/i.test(
          requestEvText,
        );
      if (
        (speechAct === "approval_request" ||
          speechAct === "review_request" ||
          speechAct === "response_request") &&
        !businessObj &&
        !shortDirectedAsk
      ) {
        rejected.push({
          candidate,
          reason: "request_evidence_missing",
          audit: buildRejectedCandidateAudit({
            candidate,
            reason: "request_evidence_missing",
            stage: "evidence",
          }),
        });
        continue;
      }
      if (
        businessObj &&
        (evidenceInClean(businessObj, source) === "ok" ||
          (source.subject != null &&
            evidenceMatchesHaystack(businessObj, source.subject)))
      ) {
        candidate.businessObjectEvidence = {
          sourceMessageId: candidate.sourceMessageId,
          evidenceText: businessObj,
          evidenceType: "business_object",
          fromCurrentMessage: true,
        };
        candidate.businessObject = candidate.businessObject ?? businessObj;
      }

      candidate.requestEvidence = {
        sourceMessageId: candidate.sourceMessageId,
        evidenceText: requestEvText,
        evidenceType: "request",
        fromCurrentMessage: true,
      };

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
        subject: source.subject,
      });
      candidate.requestedAction = refined;

      if (
        !evidenceSupportsRequestedAction({
          evidenceText: `${requestEvText}\n${businessObj ?? ""}`,
          requestedAction: refined,
          body: source.body,
        })
      ) {
        rejected.push({
          candidate,
          reason: "request_evidence_semantic_mismatch",
        });
        continue;
      }

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
      const directedAskPhrase =
        /(?:נא\s*לאשר|נא\s*לשלוח|חסר\s+|תבדוק|תענה|תאשר|תשלח|לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|בבקשה\s+(?:להגיש|לשלוח|לאשר|לבדוק)|please\s+(?:approve|send|review|check|submit))/i;
      const addressedMailbox =
        source.toEmails.some((e) =>
          isAccountIdentityEmail(e, opts.accountIdentities),
        ) &&
        (ownerNamed ||
          directedAskPhrase.test(source.body) ||
          /(?:\bאתה\b|\bאת\b|\byou\b|\byour\b)/i.test(source.body));
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

      // Outbound short asks: prefer an external To recipient as assignee.
      const fromMailbox = isAccountIdentityEmail(
        source.fromEmail,
        opts.accountIdentities,
      );
      if (
        fromMailbox &&
        (speechAct === "approval_request" ||
          speechAct === "review_request" ||
          speechAct === "response_request" ||
          speechAct === "directive" ||
          speechAct === "implicit_missing_item_request")
      ) {
        const externalTo =
          source.toParticipants.find((p) => !p.isMailboxOwner) ?? null;
        const externalEmail =
          externalTo?.email ??
          source.toEmails.find(
            (e) => !isAccountIdentityEmail(e, opts.accountIdentities),
          ) ??
          null;
        if (externalEmail) {
          const currentAssigneeIsMailbox = isAccountIdentityEmail(
            assignee?.email,
            opts.accountIdentities,
          );
          const currentAssigneeInTo =
            Boolean(assignee?.email) &&
            source.toEmails.some(
              (e) =>
                normalizeEmailAddress(e) ===
                normalizeEmailAddress(assignee!.email),
            );
          if (!assignee || currentAssigneeIsMailbox || !currentAssigneeInTo) {
            assignee = {
              name: externalTo?.displayName ?? assignee?.name ?? null,
              email: externalEmail,
              evidenceText:
                assignee?.evidenceText?.trim() || candidate.evidenceText,
            };
            candidate.assignee = assignee;
          }
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
          directedAskPhrase.test(candidate.evidenceText) ||
          directedAskPhrase.test(source.body);
        const namedInBody =
          Boolean(assignee.name) &&
          normalizeForMatch(source.body).includes(
            normalizeForMatch(assignee.name!),
          );
        const speechDirected =
          speechAct === "approval_request" ||
          speechAct === "review_request" ||
          speechAct === "response_request" ||
          speechAct === "directive" ||
          speechAct === "implicit_missing_item_request";
        if (aCheck === "ok") {
          // ok
        } else if (
          inTo &&
          actionEvOk &&
          (secondPerson ||
            imperativeToRecipient ||
            speechDirected ||
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

      const reqNorm = normalizeEmailAddress(requester?.email ?? null);
      const asgNorm = normalizeEmailAddress(assignee?.email ?? null);
      if (
        reqNorm &&
        asgNorm &&
        reqNorm === asgNorm &&
        attributed.requestDirection !== "self_commitment"
      ) {
        rejected.push({
          candidate,
          reason: "assignee_evidence_invalid",
          audit: buildRejectedCandidateAudit({
            candidate,
            reason: "assignee_evidence_invalid",
            stage: "validator",
          }),
        });
        continue;
      }

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

    if (candidate.type === "alert") {
      candidate.actionOwner = candidate.actionOwner ?? "account_owner";
      candidate.responsibilityScope =
        candidate.responsibilityScope ?? "account_owner";
      candidate.requestDirection =
        candidate.requestDirection ?? "requested_from_account_owner";
      candidate.relationToMailbox =
        candidate.relationToMailbox ?? "requested_from_me";
      candidate.alertCategory =
        candidate.alertCategory ??
        alertCategoryForNature(
          candidate.communicationNature ?? "legal_or_security_claim",
          source.body,
        ) ??
        "legal";
      candidate.alertVerificationState =
        candidate.alertVerificationState ?? "unverified";
      // Legal/security alerts require a claim proven in CURRENT body — subject
      // letterhead / scare-title alone is not enough (suspicious zero-insight).
      const legalish =
        candidate.alertCategory === "legal" ||
        candidate.alertCategory === "security" ||
        nature === "legal_or_security_claim" ||
        /(?:משפט|copyright|dmca|legal\s+(?:demand|notice|claim)|התראה\s*משפט)/i.test(
          `${candidate.headline ?? ""}\n${source.subject ?? ""}`,
        );
      if (
        legalish &&
        !bodyHasLegalOrSecurityClaim(source.body) &&
        !findLegalEvidenceSnippet(source.body)
      ) {
        rejected.push({
          candidate,
          reason: "evidence_not_found",
          audit: buildRejectedCandidateAudit({
            candidate,
            reason: "evidence_not_found",
            stage: "evidence",
          }),
        });
        continue;
      }
      if (!candidate.requestedAt) {
        candidate.requestedAt = source.sentAt ?? candidate.occurredAt;
      }
      const draftHeadline = candidate.headline?.trim() ?? "";
      if (
        !draftHeadline ||
        draftHeadline === "טיוטה" ||
        GENERIC_HEADLINES.has(draftHeadline.toLowerCase())
      ) {
        candidate.headline =
          candidate.alertCategory === "legal"
            ? "דרישה משפטית לאימות"
            : candidate.alertCategory === "payment"
              ? "כשל תשלום לאימות"
              : candidate.alertCategory === "security"
                ? "התראת אבטחה לאימות"
                : "התראה לאימות";
      }
      if (!candidate.requestedAction?.trim()) {
        candidate.requestedAction =
          "מומלץ לאמת את זהות השולח ואת אמינות הדרישה לפני כל פעולה";
      }
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

    // Legal alerts must never surface the demand as the recommended action.
    if (
      candidate.type === "alert" &&
      (candidate.alertCategory === "legal" ||
        nature === "legal_or_security_claim")
    ) {
      candidate.requestedAction =
        "מומלץ לאמת את זהות השולח ואת אמינות הדרישה לפני כל פעולה";
      candidate.headline =
        candidate.headline?.trim() || "התקבלה דרישה משפטית הדורשת אימות";
      candidate.alertVerificationState =
        candidate.alertVerificationState ?? "unverified";
    }

    let titleQuality: TitleQualityResult | undefined;
    let professionalTitle: ProfessionalTitleResult | undefined;
    if (candidate.type === "action") {
      const titleForGate =
        candidate.requestedAction?.trim() ||
        candidate.headline?.trim() ||
        "";
      const titleSourceHint =
        candidate.topicKey?.startsWith("implicit-")
          ? ("downstream_fallback" as const)
          : ("model" as const);
      const requesterCanonical =
        candidate.requester?.name?.trim() ||
        source.fromName ||
        null;
      professionalTitle = applyProfessionalTitleGate({
        title: titleForGate,
        speechAct: candidate.requestSpeechAct,
        requestEvidence:
          candidate.requestEvidence?.evidenceText?.trim() ||
          candidate.evidenceText,
        businessObjectEvidence:
          candidate.businessObjectEvidence?.evidenceText ??
          candidate.businessObject,
        contextEvidence: candidate.contextEvidence?.evidenceText ?? null,
        subject: source.subject,
        body: source.body,
        requesterCanonicalName: requesterCanonical,
        titleSourceHint,
      });
      titleQuality = applyTitleQualityGate({
        title: titleForGate,
        speechAct: candidate.requestSpeechAct,
        requestEvidence:
          candidate.requestEvidence?.evidenceText?.trim() ||
          candidate.evidenceText,
        businessObjectEvidence:
          candidate.businessObjectEvidence?.evidenceText ??
          candidate.businessObject,
        contextEvidence: candidate.contextEvidence?.evidenceText ?? null,
        subject: source.subject,
        body: source.body,
        titleSourceHint,
      });
      if (!titleQuality.evidenceIntegrity.ok) {
        rejected.push({
          candidate,
          reason: "evidence_not_found",
          audit: buildRejectedCandidateAudit({
            candidate,
            reason: "evidence_integrity_failed",
            stage: "evidence",
          }),
        });
        continue;
      }
      // Display title is professionally normalized; evidence quote unchanged.
      candidate.requestedAction = professionalTitle.finalTitle;
      candidate.headline = professionalTitle.finalTitle;
      if (
        professionalTitle.businessObjectEvidence &&
        !candidate.businessObjectEvidence
      ) {
        candidate.businessObjectEvidence = {
          sourceMessageId: candidate.sourceMessageId,
          evidenceText: professionalTitle.businessObjectEvidence,
          evidenceType: "business_object",
          fromCurrentMessage: true,
        };
        candidate.businessObject =
          candidate.businessObject ?? professionalTitle.businessObjectEvidence;
      }
    }

    accepted.push({
      ...candidate,
      headline:
        candidate.type === "action" ? (candidate.headline ?? headline) : headline,
      actionOwner: finalScope,
      responsibilityScope: finalScope,
      requestDirection: finalDirection,
      relationToMailbox: finalRelation,
      ...(titleQuality ? { titleQuality } : {}),
      ...(professionalTitle ? { professionalTitle } : {}),
    });
  }

  // Legal/security: if body proves a claim but no alert survived, synthesize one.
  const hasLegalAlert = accepted.some(
    (c) =>
      c.type === "alert" &&
      (c.alertCategory === "legal" ||
        c.communicationNature === "legal_or_security_claim"),
  );
  if (!hasLegalAlert) {
    for (const m of opts.messages) {
      if (!bodyHasLegalOrSecurityClaim(m.body)) continue;
      const snippet = findLegalEvidenceSnippet(m.body);
      if (!snippet) continue;
      accepted.push({
        type: "alert",
        headline: "התקבלה דרישה משפטית הדורשת אימות",
        context:
          "השולח טוען להפרת זכויות ודורש הסרת תוכן. יש לאמת את זהות השולח והמסמך לפני פעולה.",
        actorName: m.fromName,
        actorEmail: m.fromEmail,
        sourceMessageId: m.id,
        evidenceText: snippet,
        actionOwner: "account_owner",
        responsibilityScope: "account_owner",
        requestDirection: "requested_from_account_owner",
        relationToMailbox: "requested_from_me",
        requestedAction:
          "מומלץ לאמת את זהות השולח ואת אמינות הדרישה לפני כל פעולה",
        actionVerb: null,
        actionObject: null,
        actionPurpose: null,
        requester: null,
        assignee: null,
        beneficiary: null,
        responseRecipient: null,
        requestModality: null,
        requestSpeechAct: null,
        communicationNature: "legal_or_security_claim",
        disposition: "create_alert",
        actionState: null,
        alertCategory: "legal",
        alertVerificationState: "unverified",
        attributionConfidence: 0.9,
        semanticPrecisionConfidence: 0.95,
        requestEvidence: {
          sourceMessageId: m.id,
          evidenceText: snippet,
          evidenceType: "request",
          fromCurrentMessage: true,
        },
        subjectEvidence: null,
        contextEvidence: null,
        businessObjectEvidence: null,
        supportingEvidence: [],
        businessObject: null,
        previousValue: null,
        currentValue: null,
        occurredAt: m.sentAt ?? new Date().toISOString(),
        requestedAt: m.sentAt,
        dueAt: null,
        dueEvidenceText: null,
        dueSourceMessageId: null,
        confidence: 0.9,
        businessRelevanceConfidence: 0.95,
        topicKey: "legal_alert",
        replacesSourceMessageId: null,
      } as unknown as AcceptedCandidate);
      break;
    }
  }

  // If the model returned only rejected candidates but CURRENT_MESSAGE still has
  // a recoverable open ask, retry once via the empty-candidate recovery path.
  const acceptedActions = accepted.filter((c) => c.type === "action");
  if (acceptedActions.length === 0 && opts.candidates.length > 0) {
    const recoverableReject = rejected.some((r) =>
      [
        "disposition_suppress",
        "evidence_not_found",
        "request_evidence_missing",
        "speech_act_not_actionable",
        "informational_not_action",
        "already_sent_not_action",
      ].includes(r.reason),
    );
    if (recoverableReject) {
      const fallback = validateFeedCandidates({
        ...opts,
        candidates: [],
      });
      if (fallback.accepted.some((c) => c.type === "action")) {
        return {
          accepted: [...accepted, ...fallback.accepted],
          rejected: [...rejected, ...fallback.rejected],
        };
      }
    }
  }

  const legalAlerts = accepted.filter(
    (c) =>
      c.type === "alert" &&
      (c.alertCategory === "legal" ||
        c.communicationNature === "legal_or_security_claim"),
  );
  if (legalAlerts.length > 1) {
    const keep = legalAlerts[0]!;
    const dropIds = new Set(
      legalAlerts.slice(1).map((c) => `${c.sourceMessageId}:${c.headline}`),
    );
    for (const drop of legalAlerts.slice(1)) {
      rejected.push({
        candidate: drop,
        reason: "legal_consolidated_to_alert",
      });
    }
    return {
      accepted: accepted.filter(
        (c) =>
          !(
            c.type === "alert" &&
            dropIds.has(`${c.sourceMessageId}:${c.headline}`) &&
            c !== keep
          ),
      ),
      rejected,
    };
  }

  return { accepted, rejected };
}
