/**
 * Deterministic Feed thread eligibility — no LLM.
 * False negatives preferred over false positives for marketing/bulk.
 */

export type FeedThreadEligibility =
  | "business_conversation"
  | "important_transactional"
  | "bulk_marketing"
  | "system_notification"
  | "insufficient_content"
  | "unknown";

export type EligibilityResult = {
  classification: FeedThreadEligibility;
  eligibleForExtraction: boolean;
  reasons: string[];
  signals: string[];
  score: number;
};

export type EligibilityMessageInput = {
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  direction: "inbound" | "outbound";
  body: string;
};

export type EligibilityThreadInput = {
  subject: string | null;
  accountEmail: string;
  messages: EligibilityMessageInput[];
};

const MARKETING_LOCAL_PARTS = [
  "newsletter",
  "news",
  "marketing",
  "updates",
  "promo",
  "promotions",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notify",
  "hello",
  "info",
  "mailer",
  "bounce",
];

const BULK_BODY_PATTERNS: Array<{ id: string; re: RegExp; weight: number }> = [
  { id: "unsubscribe", re: /unsubscribe|opt[\s-]?out|הסרה מרשימת|להסרה מהרשימה/i, weight: 3 },
  { id: "utm", re: /[?&]utm_(?:source|medium|campaign)=/i, weight: 2 },
  { id: "webinar", re: /\bwebinar\b|וובינר|הרצאה מקוונת/i, weight: 2 },
  { id: "tickets", re: /\btickets?\b|כרטיסים|השג כרטיס/i, weight: 2 },
  { id: "promotion", re: /\bpromotion\b|\bsale\b|מבצע|הנחה בלעדית/i, weight: 2 },
  { id: "release_notes", re: /release notes|product update|what's new|מה חדש|changelog/i, weight: 3 },
  { id: "public_beta", re: /public (?:alpha|beta)|now in (?:alpha|beta)|נכנס ל-?beta/i, weight: 3 },
  { id: "cta_try", re: /try (?:it )?now|נסה עכשיו|get started free|התחל בחינם/i, weight: 2 },
  { id: "view_in_browser", re: /view (?:this )?in (?:your )?browser|הצג בדפדפן/i, weight: 2 },
  { id: "manage_preferences", re: /manage (?:email )?preferences|עדכון העדפות דיוור/i, weight: 2 },
];

const TRANSACTIONAL_EXCEPTIONS: Array<{ id: string; re: RegExp }> = [
  { id: "invoice", re: /invoice|חשבונית|payment (?:failed|due)|תשלום|receipt|קבלה/i },
  { id: "quote_rfq", re: /quote|rfq|הצעת מחיר|בקשת הצעה|הזמנה|purchase order|\bpo\b/i },
  { id: "shipping", re: /shipment|shipping|delivery|אספקה|משלוח|עיכוב באספקה/i },
  { id: "contract", re: /contract|agreement|חוזה|לאישור|please (?:sign|approve)|נא לאשר|מאשרים סופית|אושר סופית/i },
  { id: "lead", re: /new lead|ליד חדש|contact form|טופס יצירת קשר|בקשה מאתר/i },
  { id: "ops_incident", re: /outage|incident|downtime|תקלה|שירות לא זמין|sever(?:e|ity)/i },
  { id: "security", re: /security alert|suspicious (?:login|sign-?in)|אימות דו-שלבי|password reset/i },
  { id: "meeting", re: /meeting (?:moved|rescheduled|cancelled)|פגישה (?:נדחתה|בוטלה|הועברה)|calendar invite/i },
  { id: "legal_gov", re: /court|subpoena|tax authority|רשות המסים|הודעה משפטית|משרד ממשלתי/i },
];

const BUSINESS_SUBJECT =
  /הזמנה|הצעה|מחיר|אישור|תוכנית|מפרט|אספקה|חוזה|עבודה|quote|order|invoice|contract|spec|delivery|approve|approval/i;

function localPart(email: string | null): string {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[0]!.toLowerCase();
}

function combinedText(input: EligibilityThreadInput): string {
  const parts = [
    input.subject ?? "",
    ...input.messages.map((m) =>
      [m.subject ?? "", m.fromEmail ?? "", m.fromName ?? "", m.body].join("\n"),
    ),
  ];
  return parts.join("\n");
}

function humanParticipantCount(input: EligibilityThreadInput): number {
  const emails = new Set<string>();
  for (const m of input.messages) {
    if (m.fromEmail) emails.add(m.fromEmail.toLowerCase());
    for (const t of m.toEmails) emails.add(t.toLowerCase());
  }
  let humans = 0;
  for (const e of emails) {
    const local = localPart(e);
    if (!local) continue;
    if (MARKETING_LOCAL_PARTS.some((p) => local === p || local.startsWith(`${p}+`))) {
      continue;
    }
    humans += 1;
  }
  return humans;
}

function hasReplyConversation(input: EligibilityThreadInput): boolean {
  const dirs = new Set(input.messages.map((m) => m.direction));
  return dirs.has("inbound") && dirs.has("outbound");
}

/**
 * Score-based classifier. Bulk requires combined score threshold — not a single keyword.
 */
export function classifyFeedThreadEligibility(
  input: EligibilityThreadInput,
): EligibilityResult {
  const signals: string[] = [];
  const reasons: string[] = [];
  const text = combinedText(input);
  const bodyText = input.messages.map((m) => m.body).join("\n");
  const contentLen = bodyText.replace(/\s+/g, " ").trim().length;

  if (contentLen < 12) {
    return {
      classification: "insufficient_content",
      eligibleForExtraction: false,
      reasons: ["body_too_short"],
      signals: ["insufficient_content"],
      score: 0,
    };
  }

  let marketingScore = 0;
  let transactionalScore = 0;

  for (const m of input.messages) {
    const local = localPart(m.fromEmail);
    if (local && MARKETING_LOCAL_PARTS.includes(local)) {
      marketingScore += local.includes("newsletter") || local === "marketing" ? 3 : 1;
      signals.push(`sender_local:${local}`);
    }
  }

  for (const p of BULK_BODY_PATTERNS) {
    if (p.re.test(text)) {
      marketingScore += p.weight;
      signals.push(p.id);
    }
  }

  // Broad audience heuristic: many distinct recipients on a single inbound blast.
  const maxRecipients = Math.max(
    0,
    ...input.messages.map((m) => m.toEmails.length),
  );
  if (maxRecipients >= 8) {
    marketingScore += 3;
    signals.push("wide_recipient_list");
  }

  for (const ex of TRANSACTIONAL_EXCEPTIONS) {
    if (ex.re.test(text)) {
      transactionalScore += 4;
      signals.push(`tx:${ex.id}`);
    }
  }

  const reply = hasReplyConversation(input);
  if (reply) {
    transactionalScore += 2;
    signals.push("inbound_outbound_reply");
  }

  const humans = humanParticipantCount(input);
  if (humans >= 2) {
    transactionalScore += 1;
    signals.push(`human_participants:${humans}`);
  }

  if (BUSINESS_SUBJECT.test(input.subject ?? "") || BUSINESS_SUBJECT.test(text)) {
    transactionalScore += 2;
    signals.push("business_subject");
  }

  // Important transactional exception wins over marketing signals.
  if (transactionalScore >= 4 && marketingScore >= 3) {
    reasons.push("transactional_exception_over_marketing");
    return {
      classification: "important_transactional",
      eligibleForExtraction: true,
      reasons,
      signals,
      score: transactionalScore - marketingScore,
    };
  }

  if (marketingScore >= 5) {
    reasons.push(`marketing_score=${marketingScore}`);
    return {
      classification: "bulk_marketing",
      eligibleForExtraction: false,
      reasons,
      signals,
      score: -marketingScore,
    };
  }

  // Pure system noise without transactional exception.
  const systemOnly =
    /mailer-daemon|postmaster|delivery status notification|undeliverable/i.test(
      text,
    ) && transactionalScore < 4;
  if (systemOnly) {
    return {
      classification: "system_notification",
      eligibleForExtraction: false,
      reasons: ["system_bounce_or_dsn"],
      signals,
      score: -2,
    };
  }

  if (reply || transactionalScore >= 4 || (humans >= 2 && marketingScore < 3)) {
    const classification =
      transactionalScore >= 4 && !reply
        ? "important_transactional"
        : "business_conversation";
    reasons.push(
      reply
        ? "conversation_with_reply"
        : transactionalScore >= 4
          ? "transactional_signals"
          : "multi_party_thread",
    );
    return {
      classification,
      eligibleForExtraction: true,
      reasons,
      signals,
      score: transactionalScore - marketingScore,
    };
  }

  if (marketingScore >= 3) {
    reasons.push(`likely_bulk_score=${marketingScore}`);
    return {
      classification: "bulk_marketing",
      eligibleForExtraction: false,
      reasons,
      signals,
      score: -marketingScore,
    };
  }

  // Ambiguous — prefer skip (false negative over false positive).
  reasons.push("ambiguous_prefer_skip");
  return {
    classification: "unknown",
    eligibleForExtraction: false,
    reasons,
    signals,
    score: 0,
  };
}

export type EligibleSelectionPriority = {
  threadId: string;
  priority: number;
  classification: FeedThreadEligibility;
};

/**
 * Higher priority first. Used when selecting ≤20 eligible threads from ≤100 scan.
 */
export function scoreEligibleThreadPriority(input: EligibilityThreadInput): number {
  let p = 0;
  if (hasReplyConversation(input)) p += 100;
  if (BUSINESS_SUBJECT.test(input.subject ?? "")) p += 40;
  const humans = humanParticipantCount(input);
  if (humans >= 3) p += 30;
  else if (humans >= 2) p += 15;
  const text = combinedText(input);
  if (TRANSACTIONAL_EXCEPTIONS.some((ex) => ex.re.test(text))) p += 35;
  const last = input.messages.at(-1);
  if (last?.direction === "inbound") p += 10;
  // Prefer threads with more message substance.
  const len = input.messages.reduce((n, m) => n + m.body.length, 0);
  p += Math.min(20, Math.floor(len / 400));
  return p;
}
