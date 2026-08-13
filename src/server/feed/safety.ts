/**
 * O5A.5 Feed safety — general detectors (no sender/thread hardcodes).
 */
import { extractCurrentMessageLead } from "./evidence-match";

export type CommunicationNature =
  | "business_request"
  | "business_decision"
  | "business_change"
  | "transactional_notice"
  | "system_notification"
  | "marketing"
  | "cold_outreach"
  | "verification_solicitation"
  | "legal_or_security_claim"
  | "informational"
  | "uncertain";

export type FeedDisposition =
  | "create_action"
  | "create_change"
  | "create_decision"
  | "create_alert"
  | "suppress";

export type ActionState =
  | "requested"
  | "committed"
  | "completed"
  | "already_sent"
  | "informational"
  | "uncertain";

export type AlertCategory =
  | "legal"
  | "security"
  | "payment"
  | "service"
  | "operational"
  | "suspicious_sender";

export type AlertVerificationState =
  | "unverified"
  | "verified"
  | "not_required";

const VERIFICATION_SOLICIT =
  /תג אימות|verification (?:badge|tag)|verified (?:badge|page|account)|claim (?:your )?badge|הפעל(?:ת)? את תג|עבר(?:ה|ו)? את כל הקריטריונים|all (?:the )?criteria|eligibility (?:check|criteria)|activate (?:your )?badge|get verified|verify (?:your )?(?:page|profile|account|listing)/i;

const VERIFICATION_SENDER =
  /verified\s*ai|ai\s*support|support\s*center|verification\s*(?:team|service)|noreply@|no-reply@/i;

const LEGAL_CLAIM =
  /(?:copyright infringement|dmca|cease(?:\s+and\s+desist)?|infring(?:e|ement)|זכויות יוצרים|הסרת תוכן|דרישה משפטית|legal (?:demand|notice|claim)|מכתב התראה|נקיטת הליכים|הפרת זכויות)/i;

/** Boilerplate that must not alone create a legal alert. */
const LEGAL_BOILERPLATE =
  /copyright\s*©|all rights reserved|intellectual property rights[\s\S]{0,80}intended recipient|privacy policy|unsubscribe/i;

const LEGAL_DEMAND =
  /(?:מכתב התראה|נקיטת הליכים|דרישה משפטית|הסרת תוכן|cease(?:\s+and\s+desist)?|copyright infringement|dmca|delete all|הנך נדרש|you are (?:hereby )?required)/i;

const LEGAL_MULTI_DEMAND =
  /(?:delete all|cease any|send (?:a )?written|הסר(?:ה|ת)|חדל|אשר בכתב)/i;

const COLD_OUTREACH =
  /(?:share (?:your )?technical documents|cad-ready|prepare (?:a )?(?:quote|proposal|offer)|i(?:'|’)d love to (?:help|partner|work)|unpause (?:the )?project|introduce (?:our|my) (?:service|company)|we (?:can|could) (?:help|assist) (?:you )?(?:with|on))/i;

const MARKETING_PRODUCT =
  /(?:release notes|product update|what(?:'|’)s new|changelog|newsletter|unsubscribe|utm_source|try (?:it )?now|get started free)/i;

const ALREADY_SENT =
  /(?:^|[\s])(?:מצ["״']?ב|מצורף(?:ים)?|attached(?: please)?|please find attached|הנה ה|שלחתי את|i(?:'|’)ve (?:sent|attached)|i have (?:sent|attached))/i;

const APPROVAL_OF_ATTACHMENT =
  /(?:לאישור(?:ך|כם)?|for (?:your )?approval|נא לאשר|please approve|לאישור)/i;

const EXPLICIT_REQUEST =
  /(?:נא\s+(?:לשלוח|לאשר|אשר|לבדוק|להשלים|להשיב|לעדכן|להוריד)|בבקשה\s+(?:לשלוח|לאשר|להגיש|לבדוק)|please\s+(?:send|approve|check|review|reply|submit)|חסר\s+\S{2,}|תשלח|תאשר|תבדוק|תוריד|לטיפולכם|לטפל(?:כם)?|אשמח\s+(?:לאישור|שת|שתיי)|תציץ|תדבר\s+איתי)/i;

/** Imperative / please ask that opens an action even without נא+infinitive. */
const DIRECTIVE_ASK =
  /(?:^|[\s,.;:])(?:נא|בבקשה)(?=\s|$|[.,!?:])|(?:please\s+(?:send|approve|check|review|reply|submit|confirm))|(?:תוריד|תשלח|תאשר|תבדוק|תטפל)\s/i;

const PAUSED_OR_STATUS_NOTICE =
  /(?:has been paused|automatically pause|free-tier|project[\s\S]{0,40}paused|הושהה|on hold|inactivity)/i;

const PERMISSION_REQUEST =
  /אם אתה מאשר(?:ת)? לי|אם אפשר(?:י)? לי|מאשר לי (?:לשנות|להוסיף|לציין|לעדכן)|may I |can I (?:add|change|update)/i;

const COMMITMENT =
  /(?:אשלח|אטפל|אבדוק|אאשר|(?:אנחנו\s+)?נשלח|i(?:'|’)ll\s+send|i will\s+send|we will\s+send)/i;

const COMPLETED_REPORT =
  /(?:נשלחה|הושלם|בוצע|already sent|has been sent|was sent|נשלח\s+(?:אתמול|כבר|היום))/i;

const REAL_PAYMENT_FAIL =
  /(?:payment (?:failed|declined|due)|תשלום נכשל|החיוב נדחה|invoice overdue|כרטיס נדחה)/i;

const REAL_SECURITY =
  /(?:suspicious (?:login|sign-?in)|password reset|אימות דו-שלבי|new sign-in|security alert)/i;

/** User started verification and is asked to finish a legitimate step. */
const USER_INITIATED_VERIFY =
  /(?:you (?:requested|started|initiated) (?:this |the )?verif|complete (?:the |your )?(?:verification|setup) (?:you |that you )?(?:started|requested)|השלם(?:ת)? את (?:תהליך )?האימות (?:ש|שביקשת|שהתחלת)|המשך אימות|finish (?:setting up|verifying))/i;

const GREETING_ONLY =
  /^(?:היי|הי|שלום|בוקר טוב|hi|hello|hey)[\s,!.]*[\p{L}\s]{0,40}$/iu;

export function isUserInitiatedVerification(body: string): boolean {
  return USER_INITIATED_VERIFY.test(body);
}

export function isGreetingOnlyEvidence(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 2) return true;
  if (t.length > 60) return false;
  return GREETING_ONLY.test(t);
}

const APPROVAL_OR_REVIEW =
  /לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|נא\s+לאשר|נא\s+לבדוק|for your (?:approval|review)/i;

export function classifyActionState(opts: {
  body: string;
  evidenceText: string;
  requestedAction?: string | null;
}): ActionState {
  // Prefer CURRENT lead-in so forwarded "מצ״ב/נשלח" does not eclipse an active ask.
  const currentLead = extractCurrentMessageLead(opts.body);
  const text = `${opts.evidenceText}\n${currentLead}`;
  const hasOpenAsk =
    PERMISSION_REQUEST.test(text) ||
    EXPLICIT_REQUEST.test(text) ||
    APPROVAL_OR_REVIEW.test(text) ||
    DIRECTIVE_ASK.test(text) ||
    APPROVAL_OF_ATTACHMENT.test(text);

  if (ALREADY_SENT.test(text) && APPROVAL_OR_REVIEW.test(text)) {
    return "requested";
  }
  if (ALREADY_SENT.test(text) && APPROVAL_OF_ATTACHMENT.test(text)) {
    return "requested";
  }
  // Attachment/sent markers only suppress when the CURRENT lead has no open ask.
  if (ALREADY_SENT.test(text) && !hasOpenAsk) {
    return "already_sent";
  }
  if (COMPLETED_REPORT.test(text) && !hasOpenAsk) {
    return "completed";
  }
  if (COMMITMENT.test(text)) return "committed";
  if (hasOpenAsk) {
    return "requested";
  }
  if (
    PAUSED_OR_STATUS_NOTICE.test(text) ||
    /השתנה|הושהה|paused|changed from/i.test(text)
  ) {
    return "informational";
  }
  return "uncertain";
}

export function detectCommunicationNature(opts: {
  subject: string | null;
  body: string;
  fromEmail: string | null;
  fromName: string | null;
}): CommunicationNature {
  const blob = `${opts.subject ?? ""}\n${opts.body}\n${opts.fromName ?? ""}\n${opts.fromEmail ?? ""}`;
  const sender = `${opts.fromName ?? ""} ${opts.fromEmail ?? ""}`;

  if (
    VERIFICATION_SOLICIT.test(blob) ||
    isUserInitiatedVerification(opts.body) ||
    (VERIFICATION_SENDER.test(sender) &&
      /(?:תג|badge|verified|אימות|activate|הפעל)/i.test(opts.body))
  ) {
    return "verification_solicitation";
  }
  if (bodyHasLegalOrSecurityClaim(opts.body)) {
    return "legal_or_security_claim";
  }
  if (COLD_OUTREACH.test(blob)) return "cold_outreach";
  if (MARKETING_PRODUCT.test(blob)) return "marketing";
  if (REAL_PAYMENT_FAIL.test(blob)) return "transactional_notice";
  if (/unsubscribe|newsletter|view in browser/i.test(blob)) return "marketing";
  if (
    /system notification|no-reply|automated message|happy hacking|check out the latest/i.test(
      blob,
    ) ||
    PAUSED_OR_STATUS_NOTICE.test(blob)
  ) {
    return "system_notification";
  }

  const state = classifyActionState({
    body: opts.body,
    evidenceText: extractCurrentMessageLead(opts.body).slice(0, 400),
  });
  if (state === "already_sent" || state === "completed" || state === "informational") {
    return "informational";
  }
  if (state === "requested" || state === "committed") return "business_request";
  if (/אישר|החליט|approved|decided/i.test(opts.body)) return "business_decision";
  if (/השתנה מ-|changed from/i.test(opts.body)) return "business_change";
  return "uncertain";
}

export function dispositionForNature(
  nature: CommunicationNature,
  body?: string,
): FeedDisposition {
  switch (nature) {
    case "business_request":
      return "create_action";
    case "business_change":
      return "create_change";
    case "business_decision":
      return "create_decision";
    case "legal_or_security_claim":
      return "create_alert";
    case "transactional_notice":
      // High-risk payment/security upgraded in validate; plain notices suppress.
      return body && transactionalNoticeIsHighRisk(body)
        ? "create_alert"
        : "suppress";
    case "verification_solicitation":
      return body && isUserInitiatedVerification(body)
        ? "create_alert"
        : "suppress";
    case "system_notification":
    case "marketing":
    case "cold_outreach":
    case "informational":
    case "uncertain":
      return "suppress";
    default:
      return "suppress";
  }
}

export function alertCategoryForNature(
  nature: CommunicationNature,
  body: string,
): AlertCategory | null {
  if (nature !== "legal_or_security_claim" && nature !== "transactional_notice") {
    return null;
  }
  if (LEGAL_CLAIM.test(body) || LEGAL_MULTI_DEMAND.test(body)) return "legal";
  if (REAL_SECURITY.test(body)) return "security";
  if (REAL_PAYMENT_FAIL.test(body)) return "payment";
  if (nature === "legal_or_security_claim") return "suspicious_sender";
  return "operational";
}

/** True transactional alerts that should not be suppressed. */
export function transactionalNoticeIsHighRisk(body: string): boolean {
  return REAL_PAYMENT_FAIL.test(body) || REAL_SECURITY.test(body);
}

/** Exact substring from body that proves a legal/security claim, if any. */
export function findLegalEvidenceSnippet(body: string): string | null {
  if (!bodyHasLegalOrSecurityClaim(body)) return null;
  const normalized = body.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /.{0,40}(?:מכתב התראה|זכויות יוצרים|הפרת זכויות|דרישה משפטית|copyright infringement|dmca|cease(?:\s+and\s+desist)?|legal (?:demand|notice|claim)|נקיטת הליכים).{0,80}/i,
  );
  if (match?.[0]) {
    const snippet = match[0].trim();
    if (normalized.includes(snippet)) return snippet.slice(0, 500);
  }
  const idx = normalized.search(LEGAL_DEMAND);
  if (idx < 0) return null;
  const start = Math.max(0, idx - 20);
  return normalized.slice(start, start + 180).trim();
}

export function bodyHasLegalOrSecurityClaim(body: string): boolean {
  if (REAL_SECURITY.test(body)) return true;
  if (LEGAL_DEMAND.test(body)) return true;
  if (LEGAL_BOILERPLATE.test(body) && !LEGAL_DEMAND.test(body)) return false;
  return LEGAL_CLAIM.test(body) && /(?:נדרש|דורש|demand|must|הסר|delete|cease|הליכים)/i.test(body);
}

export function evidenceSupportsRequestedAction(opts: {
  evidenceText: string;
  requestedAction: string;
  body?: string;
}): boolean {
  const hay = `${opts.evidenceText}\n${opts.body ?? ""}`.toLowerCase();
  const action = opts.requestedAction.toLowerCase();
  if (isGreetingOnlyEvidence(opts.evidenceText)) return false;
  // Reject inventing "send" from "already attached"
  if (
    /(?:לשלוח|send)/i.test(action) &&
    ALREADY_SENT.test(opts.evidenceText) &&
    !EXPLICIT_REQUEST.test(opts.evidenceText) &&
    !APPROVAL_OF_ATTACHMENT.test(opts.evidenceText)
  ) {
    return false;
  }
  // Reject inventing unpause from paused notice
  if (
    /(?:unpause|בטל השהי|לבטל השהי)/i.test(action) &&
    /(?:paused|הושהה|on hold)/i.test(opts.evidenceText)
  ) {
    return false;
  }
  // Evidence itself carries a request / permission / commitment speech act.
  if (
    PERMISSION_REQUEST.test(opts.evidenceText) ||
    EXPLICIT_REQUEST.test(opts.evidenceText) ||
    COMMITMENT.test(opts.evidenceText) ||
    APPROVAL_OF_ATTACHMENT.test(opts.evidenceText) ||
    APPROVAL_OR_REVIEW.test(opts.evidenceText) ||
    APPROVAL_OR_REVIEW.test(opts.body ?? "")
  ) {
    return true;
  }
  // Soft overlap: action tokens should appear in evidence or surrounding body
  const tokens = action
    .split(/[\s"'״״]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 6);
  if (tokens.length === 0) return !isGreetingOnlyEvidence(opts.evidenceText);
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits >= 1;
}
