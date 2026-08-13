/**
 * Request speech-act classification — general rules only (no golden hardcodes).
 */

import { extractCurrentMessageLead } from "./evidence-match";

export type RequestSpeechAct =
  | "directive"
  | "permission_request"
  | "approval_request"
  | "review_request"
  | "response_request"
  | "implicit_missing_item_request"
  | "commitment"
  | "status_change"
  | "information"
  | "uncertain";

const PERMISSION_REQUEST =
  /אם אתה מאשר(?:ת)? לי|אם אפשר(?:י)? לי|מאשר לי (?:לשנות|להוסיף|לציין|לעדכן)|may I |can I (?:add|change|update)/i;

const REVIEW_REQUEST =
  /לבדיקת(?:ך|כם)|נא\s+לבדוק|אשמח\s+שת(?:בדוק|ציץ|עיין)|תציץ\s+ב|לעיונ(?:ך|כם)|for\s+your\s+(?:review|check)|please\s+(?:review|check)/i;

const RESPONSE_REQUEST =
  /נא\s+התייחסותך|מה\s+(?:דע|אומר|חושב)|(?:איך|האם|מה)\s+(?:אתה|את|אתם|אתן)(?=\s|$|[.,!?])|אשמח\s+שת(?:דבר|חזור|שיב)|תדבר\s+איתי|how\s+(?:should|do)\s+(?:we|I|you)|can\s+you\s+(?:please\s+)?(?:confirm|approve|check|tell)|what\s+do\s+you\s+think/i;

const APPROVAL_REQUEST =
  /לאישור(?:ך|כם)|נא\s+(?:לאשר|אשר)|אשמח\s+לאישור|ממתין\s+לאישור|לפני\s+שאני\s+מעביר|לאשר\s+לביצוע|for\s+your\s+approval|please\s+approve/i;

const DIRECTIVE =
  /(?:^|[\s,.;:])(?:נא|בבקשה|please)(?=\s|$|[.,!?:])|תעדכן אותי|תבדוק|תענה|תשלח|תאשר|תטפל|לטיפול(?:כם|ך)|נא\s+(?:לשלוח|להשיב|להשלים|לעדכן|להגיש|לטפל)|בבקשה\s+(?:להגיש|לשלוח|לאשר|לבדוק)|please\s+(?:send|update|reply|submit)|מצ["״']?ב\s+לאישור/i;

const IMPLICIT_MISSING =
  /חסר\s+\S{2,}/i;

const COMMITMENT =
  /(?:אני\s+)?(?:אשלח|אטפל|אאשר|אבדוק)|(?:אנחנו\s+)?נשלח|I'll |I will |we will /i;

const STATUS_CHANGE =
  /השתנה מ-|changed from|עלה ל-|ירד ל-|עודכן ל-|המחיר|הכמות|הסטטוס/i;

const REPORTED_DECISION =
  /(?:^|[\s])(?:אישר|אושרה?|דחה|נדחתה|החליט)\s/i;

/** Attached materials phrasing that may carry a review/approval ask. */
const ATTACHED_WITH_ASK =
  /מצ["״']?ב[\s\S]{0,120}(?:לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|for your (?:approval|review))/i;

/**
 * Extract a business-object span from CURRENT_MESSAGE for short ask phrases.
 * Returns null when the ask stands alone without an object.
 */
export function extractBusinessObjectSpan(opts: {
  body: string;
  subject?: string | null;
}): string | null {
  const body = opts.body.replace(/\s+/g, " ").trim();
  const isJunkObject = (obj: string) =>
    /^(?:--|—|בברכה|regards|thanks|תודה|best regards|sent from)/i.test(obj) ||
    /#\S{2,}|^\+?\d{7,}$/.test(obj) ||
    obj.length > 80;

  // Prefer attachment-object spans (מצ״ב X לאישור/לבדיקה) before trailing ask text.
  const fromAttach = body.match(
    /מצ["״']?ב\s+(.+?)\s+(?:לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|לפני\s+שאני|for your (?:approval|review))/i,
  );
  if (fromAttach?.[1]) {
    const raw = fromAttach[1].trim();
    if (raw.length >= 2 && !/^(?:רק|זה|זהו)$/i.test(raw) && !isJunkObject(raw)) {
      return raw;
    }
  }
  // "לטיפולכם <work>" or "<order> - לטיפולכם <work>"
  const forHandling = body.match(
    /(?:^|[\s.])(.{2,60}?)\s*[-–:]?\s*לטיפול(?:כם|ך)\s+([^\n.!?،,]{2,60})/i,
  );
  if (forHandling) {
    const before = forHandling[1]!.trim();
    const after = forHandling[2]!.trim();
    if (after.length >= 2 && !isJunkObject(after)) {
      // Prefer concrete work item after לטיפולכם when present.
      if (!/^(?:וכו|etc)\b/i.test(after)) return after.length <= 60 ? after : after.slice(0, 60);
    }
    if (before.length >= 3 && !isJunkObject(before) && !/^(?:from|מאת)\b/i.test(before)) {
      return before.length <= 60 ? before : before.slice(0, 60);
    }
  }
  const fromSubmit = body.match(
    /(?:בבקשה|נא|please)\s+(?:להגיש|לשלוח|לאשר|לבדוק|להוריד|approve|send|review|check|download)\s+(?:את\s+)?([^\n.!?،,]{2,80})/i,
  );
  if (fromSubmit?.[1]) {
    const obj = fromSubmit[1].trim();
    if (obj.length >= 2 && !isJunkObject(obj)) return obj;
  }
  const fromImperative = body.match(
    /(?:תוריד|תבדוק|תאשר|תשלח|תטפל)\s+(?:את\s+)?([^\n.!?،,]{2,60})/i,
  );
  if (fromImperative?.[1]) {
    const obj = fromImperative[1].trim().replace(/\s+בבקשה.*$/i, "").trim();
    if (obj.length >= 2 && !isJunkObject(obj)) return obj;
  }
  const fromAsk = body.match(
    /(?:נא\s+(?:לאשר|אשר|לבדוק|התייחסותך)|לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם))\s+(?:את\s+|ל|על|של)?\s*([^\n.!?،,]{2,80})/i,
  );
  if (fromAsk?.[1]) {
    const obj = fromAsk[1].trim();
    if (obj.length >= 2 && !isJunkObject(obj) && !/^לפני\s+שאני/i.test(obj)) {
      return obj;
    }
  }
  const fromResponse = body.match(
    /(?:התייחסותך|לבדיקת(?:ך|כם)|לאישור(?:ך|כם)|לעיונ(?:ך|כם))\s+(?:ל|על|של|את)?\s*([^\n.!?،,]{2,80})/i,
  );
  if (fromResponse?.[1]) {
    const obj = fromResponse[1].trim();
    if (!isJunkObject(obj) && !/^לפני\s+שאני/i.test(obj)) return obj;
  }
  // Invoice / payment / HR / ops English objects
  const fromEn = body.match(
    /(?:invoice|purchase order|po|timesheet|policy|ticket|order)\s*[#:]?\s*([A-Za-z0-9][\w-]{1,40})/i,
  );
  if (fromEn?.[0] && !isJunkObject(fromEn[0])) {
    return fromEn[0].replace(/\s+/g, " ").trim().slice(0, 80);
  }

  const subjectRaw = (opts.subject ?? "").replace(/\s+/g, " ").trim();
  const subject = subjectRaw
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .trim();
  if (subject.length >= 3) {
    const subjectHasAsk =
      APPROVAL_REQUEST.test(opts.subject ?? "") ||
      REVIEW_REQUEST.test(opts.subject ?? "") ||
      RESPONSE_REQUEST.test(opts.subject ?? "") ||
      /אשמח\s+(?:לאישור|שת)|תציץ|תדבר\s+איתי|לטיפול(?:כם|ך)/i.test(
        opts.subject ?? "",
      );
    const bodyHasAsk =
      APPROVAL_REQUEST.test(body) ||
      REVIEW_REQUEST.test(body) ||
      RESPONSE_REQUEST.test(body) ||
      DIRECTIVE.test(body) ||
      /אשמח\s+לאישור|לטיפול(?:כם|ך)/i.test(body);
    if (bodyHasAsk || subjectHasAsk) {
      // If subject itself is mostly the ask, pull a content noun from it.
      const contentFromSubject = subject
        .replace(
          /(?:הי|שלום|hi|hello).{0,20}?(?:בהמשך לשיחתנו|following (?:our )?call)?/i,
          "",
        )
        .replace(
          /אשמח\s+שת(?:ציץ|בדוק|עיין).{0,20}|תדבר\s+איתי|please\s+(?:review|approve|check).{0,20}/gi,
          "",
        )
        .replace(/\s+/g, " ")
        .trim();
      const pick =
        contentFromSubject.length >= 3 ? contentFromSubject : subject;
      return pick.length <= 80 ? pick : pick.slice(0, 80);
    }
  }
  return null;
}

export function shortAskHasBusinessObject(opts: {
  body: string;
  subject?: string | null;
  evidenceText: string;
}): boolean {
  const text = `${opts.evidenceText}\n${opts.body}`;
  if (ATTACHED_WITH_ASK.test(text)) return true;
  if (IMPLICIT_MISSING.test(text)) return true;
  const obj = extractBusinessObjectSpan({
    body: opts.body,
    subject: opts.subject,
  });
  if (!obj) return false;
  // Bare "לעיונך" / "לבדיקתך" without object → false
  const bare =
    /^(?:לעיונ(?:ך|כם)|לבדיקת(?:ך|כם)|לאישור(?:ך|כם)|היי|שלום)[\s.!,]*$/iu;
  if (bare.test(opts.evidenceText.replace(/\s+/g, " ").trim()) && !obj) {
    return false;
  }
  return obj.length >= 2;
}

/** Evidence in CURRENT lead (or subject ask) that a request speech act is present. */
export function hasRequestEvidenceInCurrentMessage(
  body: string,
  evidenceText: string,
  subject?: string | null,
): boolean {
  const currentLead = extractCurrentMessageLead(body);
  const text = `${evidenceText}\n${currentLead}\n${subject ?? ""}`;
  if (PERMISSION_REQUEST.test(text)) return true;
  if (APPROVAL_REQUEST.test(text) || ATTACHED_WITH_ASK.test(text)) {
    return shortAskHasBusinessObject({ body, evidenceText, subject });
  }
  if (REVIEW_REQUEST.test(text)) {
    if (shortAskHasBusinessObject({ body, evidenceText, subject })) return true;
    // Directed review ask already carries object/intent in the CURRENT ask span.
    const askSpan = `${evidenceText}\n${subject ?? ""}`.replace(/\s+/g, " ").trim();
    if (askSpan.length >= 12 && REVIEW_REQUEST.test(askSpan)) return true;
  }
  if (
    RESPONSE_REQUEST.test(evidenceText) ||
    RESPONSE_REQUEST.test(currentLead) ||
    RESPONSE_REQUEST.test(subject ?? "")
  ) {
    if (
      RESPONSE_REQUEST.test(evidenceText) &&
      evidenceText.replace(/\s+/g, " ").trim().length >= 12
    ) {
      return true;
    }
    if (
      RESPONSE_REQUEST.test(subject ?? "") &&
      (subject ?? "").replace(/\s+/g, " ").trim().length >= 12
    ) {
      return true;
    }
    return shortAskHasBusinessObject({ body, evidenceText, subject });
  }
  if (DIRECTIVE.test(text) || IMPLICIT_MISSING.test(text)) return true;
  if (/לטיפול(?:כם|ך)|נא\s+לטפל/i.test(text)) return true;
  if (COMMITMENT.test(text)) return true;
  if (
    /(?:^|[\s])\S{2,20}\s+י(?:עדכן|שלח|טפל|אשר)(?=\s|$|[.,!?״"'])/.test(text)
  ) {
    return true;
  }
  // Short Hebrew approval asks
  if (/אשמח\s+לאישור|לאישור(?:ך|כם)/i.test(text)) return true;
  return false;
}

export function classifyRequestSpeechAct(opts: {
  body: string;
  evidenceText: string;
  requestModality?: string | null;
  type?: string | null;
  subject?: string | null;
}): RequestSpeechAct {
  const text = `${opts.evidenceText}\n${opts.body}\n${opts.subject ?? ""}`;
  const hasObject = shortAskHasBusinessObject({
    body: opts.body,
    evidenceText: opts.evidenceText,
    subject: opts.subject,
  });

  if (PERMISSION_REQUEST.test(text)) return "permission_request";

  if (IMPLICIT_MISSING.test(text)) return "implicit_missing_item_request";

  const attachedApproval =
    /מצ["״']?ב[\s\S]{0,120}לאישור(?:ך|כם)/i.test(text) ||
    APPROVAL_REQUEST.test(text);
  const attachedReview =
    /מצ["״']?ב[\s\S]{0,120}לבדיקת(?:ך|כם)/i.test(text) ||
    (/לבדיקת(?:ך|כם)|נא\s+לבדוק|אשמח\s+שתבדוק|לעיונ(?:ך|כם)|for\s+your\s+(?:review|check)|please\s+(?:review|check)/i.test(
      text,
    ) &&
      !APPROVAL_REQUEST.test(text));

  if (attachedApproval && hasObject) return "approval_request";
  if (attachedApproval && APPROVAL_REQUEST.test(opts.evidenceText) && hasObject) {
    return "approval_request";
  }
  // Short approval ask with business object from CURRENT subject (after Fwd:/Re: strip).
  if (APPROVAL_REQUEST.test(text) && hasObject) return "approval_request";
  if (attachedReview && hasObject) return "review_request";

  if (
    (RESPONSE_REQUEST.test(opts.evidenceText) ||
      RESPONSE_REQUEST.test(opts.body)) &&
    (hasObject || RESPONSE_REQUEST.test(opts.evidenceText))
  ) {
    // Boilerplate FAQ ("Have questions? Submit a ticket") is not a business ask.
    if (
      /have questions\?|submit a support ticket|contact (?:our )?support|read the documentation/i.test(
        text,
      ) &&
      !/(?:איך|האם|מה)\s+(?:אתה|את|אתם)|נא\s+התייחסותך|how\s+(?:should|do)\s+you/i.test(
        text,
      )
    ) {
      // fall through
    } else {
      const bareReview = /^(?:לעיונ(?:ך|כם)|לבדיקת(?:ך|כם))[\s.!,]*$/iu;
      if (
        bareReview.test(opts.evidenceText.replace(/\s+/g, " ").trim()) &&
        !hasObject
      ) {
        return "uncertain";
      }
      return "response_request";
    }
  }

  if (DIRECTIVE.test(text)) return "directive";

  if (/לטיפול(?:כם|ך)/i.test(text)) return "directive";

  if (
    opts.requestModality === "commitment" ||
    COMMITMENT.test(text) ||
    /(?:^|[\s])\S{2,20}\s+י(?:עדכן|שלח|טפל|אשר)(?=\s|$|[.,!?״"'])/.test(text)
  ) {
    return "commitment";
  }

  if (STATUS_CHANGE.test(text)) return "status_change";
  if (
    REPORTED_DECISION.test(text) &&
    !PERMISSION_REQUEST.test(text) &&
    !APPROVAL_REQUEST.test(text) &&
    !DIRECTIVE.test(text)
  ) {
    return "status_change";
  }
  if (
    opts.requestModality === "information_only" ||
    opts.type === "decision"
  ) {
    return "information";
  }
  return "uncertain";
}

const ACTIONABLE: ReadonlySet<RequestSpeechAct> = new Set([
  "directive",
  "permission_request",
  "approval_request",
  "review_request",
  "response_request",
  "implicit_missing_item_request",
  "commitment",
]);

export function speechActAllowsActionCoercion(
  act: RequestSpeechAct,
): boolean {
  return ACTIONABLE.has(act);
}

export function speechActAllowsOpenAction(act: RequestSpeechAct): boolean {
  return ACTIONABLE.has(act);
}

/**
 * General requestedAction refinement from CURRENT_MESSAGE — no golden IDs/names.
 */
export function refineRequestedAction(opts: {
  body: string;
  action: string;
  speechAct: RequestSpeechAct;
  requesterDisplayName: string | null;
  subject?: string | null;
}): string {
  const bodyNorm = opts.body.replace(/\s+/g, " ").trim();
  const action = opts.action.trim();
  const who =
    opts.requesterDisplayName?.trim().split(/\s+/)[0] || "המבקש/ת";
  const obj =
    extractBusinessObjectSpan({ body: opts.body, subject: opts.subject }) ?? "";

  // Missing deliverable directed at recipient → send/complete the missing item.
  const missing = bodyNorm.match(/חסר\s+([^\n.!?،,]{2,80})/i);
  if (missing && opts.speechAct === "implicit_missing_item_request") {
    const m = missing[1]!.trim().replace(/\s+/g, " ");
    if (m && !/^לשלוח/.test(action)) {
      return `לשלוח את ${m} החסר`;
    }
  }

  if (opts.speechAct === "review_request" && obj) {
    if (!/לבדוק|לעיין|review/i.test(action) || action.length < 8) {
      return `לבדוק את ${obj} המצורפים`.replace(/המצורפים המצורפים/, "המצורפים");
    }
  }
  if (opts.speechAct === "approval_request" && obj) {
    if (!/לאשר|approve/i.test(action) || action.length < 8) {
      return `לאשר את ${obj}`;
    }
  }
  if (opts.speechAct === "response_request" && obj) {
    if (!/התייחס|להשיב|response/i.test(action) || action.length < 8) {
      return `להתייחס ל${obj}`;
    }
  }

  // Permission to change/add a caption or label on a document — not document approval.
  if (opts.speechAct === "permission_request") {
    const quoted = bodyNorm.match(/[«"“”']([^«"“”']{2,80})[»"“”']/);
    if (quoted && /(?:להוסיף|לציין|לשנות|כתוב|כיתוב)/i.test(bodyNorm)) {
      return `לאשר ל${who} לציין על המסמך "${quoted[1]!.trim()}"`;
    }
    const writeOn = bodyNorm.match(/כתוב על ([^\n.!?،,]{2,80})/i);
    if (writeOn && /(?:מאשר|לאשר|להוסיף|לציין|לשנות)/i.test(bodyNorm)) {
      return `לאשר ל${who} לציין על ${writeOn[1]!.trim()}`;
    }
    if (/(?:להוסיף|לשנות|לציין).{0,40}(?:כיתוב|כתוב)/i.test(bodyNorm)) {
      return `לאשר ל${who} לשנות את הכיתוב במסמך`;
    }
  }

  return action;
}
