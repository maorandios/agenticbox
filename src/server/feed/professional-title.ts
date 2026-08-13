/**
 * O5A.6.6 — Standalone professional Action title normalization.
 * Domain-agnostic, language-aware. Does not rewrite requestEvidence quotes.
 */

import {
  extractCurrentMessageLead,
  normalizeForEvidenceMatch,
} from "./evidence-match";
import type { RequestSpeechAct } from "./speech-act";
import { extractBusinessObjectSpan } from "./speech-act";
import {
  applyTitleQualityGate,
  assessTitleSpecificity,
  isGenericActionTitle,
  type TitleQualityResult,
  type TitleSpecificityChecks,
} from "./title-quality";

export type ProfessionalTitleChecks = TitleSpecificityChecks & {
  noContextDependentPronouns: boolean;
  noTrailingEtc: boolean;
  noPolitenessNoise: boolean;
  grammaticallyComplete: boolean;
  specificBusinessObject: boolean;
  fullyGrounded: boolean;
};

export type ProfessionalTitleResult = {
  checks: ProfessionalTitleChecks;
  pass: boolean;
  status: "ready_for_persist" | "needs_human_review";
  finalTitle: string;
  displayTitle: string;
  /** Unchanged original quote — never rewritten. */
  requestEvidenceOriginal: string;
  requestEvidenceNormalized: string;
  businessObjectEvidence: string | null;
  contextEvidence: string | null;
  requesterCanonicalName: string | null;
  rewritten: boolean;
  titleSource: TitleQualityResult["titleSource"] | "professional_normalize";
};

const CONTEXT_PRONOUNS_HE =
  /(?:^|[\s,])(?:איתי|איתו|איתה|איתם|איתן|אליו|אליה|אליהם|אליהן|לי|לו|לה|להם|להן|ממני|ממנו|את\s+זה|על\s+זה|לגבי\s+זה|בנושא\s+(?:ה)?זה|זה)(?=$|[\s,.!?])/iu;

const CONTEXT_PRONOUNS_EN =
  /(?:^|[\s,])(?:with\s+me|to\s+me|him|her|them|this|that|it)(?=$|[\s,.!?])/i;

const POLITENESS_HE =
  /(?:^|[\s,])(?:בבקשה|נא|אשמח|היי|שלום(?:\s+רב)?|בוקר\s+טוב|תודה)(?=$|[\s,.!?]|$)/giu;

const POLITENESS_EN =
  /(?:^|[\s,])(?:please|kindly|hi|hello|thanks|thank\s+you)(?=$|[\s,.!?])/gi;

const TRAILING_ETC = /(?:\s*(?:וכו['׳"]?|וכולי|etc\.?|and so on))\s*$/iu;

const INFINITIVE_START_HE =
  /^(?:לבדוק|לאשר|לשלוח|לעדכן|להוריד|לתאם|לעיין|לעבור|לבצע|לטפל|לשלם|להשיב|לשוחח|להגיש|לחתום|להחליף|לסקור|להשלים)(?:\s|$)/u;

const INFINITIVE_START_EN =
  /^(?:review|approve|send|update|download|schedule|check|pay|reply|submit|sign|replace|handle|discuss)(?:\s|$)/i;

function firstName(canonical: string | null | undefined): string | null {
  const t = (canonical ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Prefer Latin given name when present (e.g. "Uriel Nehemia").
  const latin = t.match(/\b([A-Za-z]{2,})\b/);
  if (latin?.[1]) return latin[1];
  const he = t.split(/[\s|]+/).find((p) => p.length >= 2);
  return he ?? null;
}

function stripPoliteness(text: string): string {
  return text
    .replace(POLITENESS_HE, " ")
    .replace(POLITENESS_EN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingEtc(text: string): string {
  return text.replace(TRAILING_ETC, "").replace(/\s+/g, " ").trim();
}

function hasContextPronouns(title: string): boolean {
  return CONTEXT_PRONOUNS_HE.test(title) || CONTEXT_PRONOUNS_EN.test(title);
}

function hasPolitenessNoise(title: string): boolean {
  return (
    /(?:^|[\s])(?:בבקשה|נא|אשמח|היי|שלום|please|kindly|hi\b|hello)\b/i.test(
      title,
    ) || /לטיפול(?:כם|ך)\s*$/u.test(title.trim())
  );
}

function hasTrailingEtc(title: string): boolean {
  return TRAILING_ETC.test(title);
}

function startsWithInfinitive(title: string): boolean {
  return INFINITIVE_START_HE.test(title) || INFINITIVE_START_EN.test(title);
}

function contentTokens(text: string): string[] {
  const stop = new Set(
    [
      "את",
      "על",
      "של",
      "עם",
      "אל",
      "או",
      "גם",
      "רק",
      "the",
      "a",
      "an",
      "to",
      "of",
      "for",
      "and",
      "or",
      "with",
    ].map((s) => s.toLowerCase()),
  );
  return normalizeForEvidenceMatch(text)
    .split(/[\s"'״״`.,;:!?()[\]{}\-/\\|]+/)
    .map((t) => t.trim())
    .map((t) => t.replace(/^ו(?=[\u0590-\u05FF])/u, ""))
    .filter((t) => t.length >= 2 && !stop.has(t));
}

/** Grounding: token appears in hay, or a de-prefixed Hebrew/EN stem does. */
function tokenGroundedInHay(tok: string, hay: string, envelope: string): boolean {
  if (hay.includes(tok)) return true;
  if (envelope && tok.toLowerCase() === envelope) return true;
  if (
    /^(?:לאשר|לבדוק|לעיין|לעבור|להוריד|לשלוח|להשיב|לטפל|לבצע|לתאם|לעדכן|לשלם|לשוחח|approve|review|download|pay|update|send|schedule|discuss)$/i.test(
      tok,
    )
  ) {
    return true;
  }
  // Hebrew clitics / definite article prefixes on grounded stems.
  const stem = tok.replace(/^[לבכמהש](?=[\u0590-\u05FF]{2,})/u, "");
  if (stem.length >= 2 && stem !== tok && hay.includes(stem)) return true;
  // "להזמנת" ↔ "הזמנת" (infinitive ל + definite ה collapsed).
  const stem2 = tok.replace(/^ל(?=ה[\u0590-\u05FF])/u, "");
  if (stem2.length >= 3 && stem2 !== tok && hay.includes(stem2)) return true;
  // Construct-state: שיחה ↔ שיחת, הזמנה ↔ הזמנת
  if (
    /[\u0590-\u05FF]ה$/u.test(tok) &&
    hay.includes(`${tok.slice(0, -1)}ת`)
  ) {
    return true;
  }
  if (
    /[\u0590-\u05FF]ת$/u.test(tok) &&
    hay.includes(`${tok.slice(0, -1)}ה`)
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize a draft title into a short professional infinitive form.
 * Uses only grounded spans + optional requester name for pronoun resolution.
 */
export function normalizeProfessionalTitle(opts: {
  draftTitle: string;
  speechAct: RequestSpeechAct | null | undefined;
  requestEvidence: string;
  businessObject: string | null;
  subject?: string | null;
  bodyLead?: string | null;
  contextEvidence?: string | null;
  requesterCanonicalName?: string | null;
}): { title: string | null; unresolvedPronoun: boolean } {
  const evidence = opts.requestEvidence.replace(/\s+/g, " ").trim();
  const lead = (opts.bodyLead ?? "").replace(/\s+/g, " ").trim();
  const subject = (opts.subject ?? "").replace(/\s+/g, " ").trim();
  const corpus = `${evidence}\n${lead}\n${subject}\n${opts.contextEvidence ?? ""}`;
  const requester = firstName(opts.requesterCanonicalName);
  let unresolvedPronoun = false;

  const objRaw =
    (opts.businessObject?.trim() ||
      extractBusinessObjectSpan({
        body: `${lead}\n${evidence}`,
        subject: opts.subject,
      }) ||
      "")
      .replace(/\s+/g, " ")
      .trim();

  // Detect talk-with-me / review+talk patterns before stripping pronouns.
  const wantsTalk =
    /תדבר\s+איתי|דבר\s+איתי|לשוחח|שיחה|talk\s+with\s+me|call\s+me|speak\s+with\s+me/i.test(
      `${opts.draftTitle}\n${corpus}`,
    );
  const wantsReview =
    /תציץ|לעיין|לעבור\s+על|review|look\s+over|אשמח\s+שתציץ/i.test(
      `${opts.draftTitle}\n${corpus}`,
    );
  const wantsDownload =
    /תוריד|להוריד|download/i.test(`${opts.draftTitle}\n${corpus}`);
  const wantsApprove =
    /לאישור|לאשר|אשמח\s+לאישור|approve|מבקש\s+אישור/i.test(corpus);
  const wantsHandle =
    /לטיפול(?:כם|ך)|לטפל|handle/i.test(`${opts.draftTitle}\n${corpus}`);
  const wantsPay = /לשלם|pay|invoice|חשבונית/i.test(corpus);
  const wantsUpdate = /לעדכן|update/i.test(corpus);
  const wantsSend = /לשלוח|תשלח|send/i.test(corpus);

  if (
    (wantsTalk || /איתי|with\s+me/i.test(opts.draftTitle)) &&
    !requester
  ) {
    // Pronoun needs resolution but no requester name available.
    if (/איתי|with\s+me|אליו|him\b|them\b/i.test(`${opts.draftTitle}\n${evidence}`)) {
      unresolvedPronoun = true;
    }
  }

  // Object cleanup: strip etc / politeness / bare handling markers.
  let obj = stripTrailingEtc(stripPoliteness(objRaw));
  obj = obj
    .replace(/^לטיפול(?:כם|ך)\s+/u, "")
    .replace(/\s+לטיפול(?:כם|ך)$/u, "")
    .replace(/^(?:הי|שלום|hi|hello)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Richer object from lead for "order — handling work" shapes.
  const orderWork = lead.match(
    /(.{3,50}?)\s*[-–:]\s*לטיפול(?:כם|ך)\s+([^\n.!?،,]{2,40})/u,
  );
  if (orderWork && wantsHandle) {
    const order = stripTrailingEtc(orderWork[1]!.trim());
    const work = stripTrailingEtc(orderWork[2]!.trim());
    if (order.length >= 3 && work.length >= 2 && !/^וכו/.test(work)) {
      const title = `לבצע ${work} ל${order}`.replace(/\s+/g, " ").trim();
      return { title: title.slice(0, 160), unresolvedPronoun: false };
    }
  }

  // Download + schedule call
  if (wantsDownload && (wantsTalk || /שיח/i.test(corpus))) {
    const files =
      corpus.match(/הקבצים|the\s+files?|קבצים/i)?.[0] ?? "הקבצים";
    const fileObj = /files?/i.test(files) ? files : "הקבצים";
    return {
      title: `להוריד את ${fileObj} ולתאם שיחה`.replace(/\s+/g, " ").slice(0, 160),
      unresolvedPronoun: false,
    };
  }

  // Review content + talk with requester
  if (wantsReview && wantsTalk) {
    const content =
      corpus.match(/\bתוכן\b|the\s+content|התוכן/i)?.[0] ?? "התוכן";
    const contentObj = /content/i.test(content) ? "the content" : "התוכן";
    if (requester) {
      if (/content/i.test(contentObj)) {
        return {
          title: `review ${contentObj} and discuss with ${requester}`.slice(
            0,
            160,
          ),
          unresolvedPronoun: false,
        };
      }
      return {
        title: `לעבור על ${contentObj} ולשוחח עם ${requester}`.slice(0, 160),
        unresolvedPronoun: false,
      };
    }
    unresolvedPronoun = true;
    return { title: null, unresolvedPronoun };
  }

  // Approve + subject/object
  if (wantsApprove && obj.length >= 3) {
    // Prefer subject-like object over greeting fragments.
    let approveObj = obj;
    if (/^(?:מאור|הי|שלום|hi)\b/i.test(approveObj) && subject.length >= 3) {
      approveObj = subject
        .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
        .trim();
    }
    approveObj = stripTrailingEtc(stripPoliteness(approveObj));
    if (approveObj.length >= 3) {
      const preferHe = /[\u0590-\u05FF]/.test(corpus);
      return {
        title: (preferHe ? `לאשר את ${approveObj}` : `approve ${approveObj}`)
          .replace(/\s+/g, " ")
          .slice(0, 160),
        unresolvedPronoun: false,
      };
    }
  }

  // Handling / perform work on object
  if (wantsHandle && obj.length >= 2) {
    const work = stripTrailingEtc(obj);
    if (work.length >= 2 && !/^וכו/.test(work)) {
      // If lead has a broader order phrase, attach it.
      const orderHint = lead.match(
        /הזמנת\s+[^\n.!?،-]{2,40}|order\s+[^\n.!?،-]{2,40}|po[\s-]?\d+/i,
      );
      if (orderHint?.[0] && !normalizeForEvidenceMatch(work).includes(
        normalizeForEvidenceMatch(orderHint[0]).slice(0, 8),
      )) {
        return {
          title: `לבצע ${work} ל${orderHint[0].trim()}`
            .replace(/\s+/g, " ")
            .slice(0, 160),
          unresolvedPronoun: false,
        };
      }
      return {
        title: `לבצע ${work}`.replace(/\s+/g, " ").slice(0, 160),
        unresolvedPronoun: false,
      };
    }
  }

  if (wantsPay) {
    const inv =
      corpus.match(/invoice\s*#?\s*[\w-]+|חשבונית\s*#?\s*[\w-]+/i)?.[0] ??
      obj;
    if (inv && inv.length >= 3) {
      return {
        title: (/invoice/i.test(inv) ? `pay ${inv}` : `לשלם את ${inv}`)
          .replace(/\s+/g, " ")
          .slice(0, 160),
        unresolvedPronoun: false,
      };
    }
  }

  if (wantsUpdate && obj.length >= 3) {
    return {
      title: (/[A-Za-z]{3,}/.test(obj) ? `update ${obj}` : `לעדכן את ${obj}`)
        .replace(/\s+/g, " ")
        .slice(0, 160),
      unresolvedPronoun: false,
    };
  }

  if (wantsSend && obj.length >= 3) {
    return {
      title: (/[A-Za-z]{3,}/.test(obj) ? `send ${obj}` : `לשלוח את ${obj}`)
        .replace(/\s+/g, " ")
        .slice(0, 160),
      unresolvedPronoun: false,
    };
  }

  // Fallback: clean draft into infinitive if possible.
  let draft = stripTrailingEtc(stripPoliteness(opts.draftTitle));
  draft = draft
    .replace(/\s+לגבי\s+זה\b/giu, "")
    .replace(/\s+את\s+זה\b/giu, "")
    .replace(/\s+בנושא\s+(?:ה)?זה\b/giu, "")
    .replace(/\s+ובוא\s+נעשה\s+/giu, " ו")
    .replace(/לעשות\s+שיח(?:ה|ת)/giu, "לתאם שיחה")
    .replace(/\bתוריד\b/gu, "להוריד")
    .replace(/\bתבדוק\b/gu, "לבדוק")
    .replace(/\bתאשר\b/gu, "לאשר")
    .replace(/\bתשלח\b/gu, "לשלוח")
    .replace(/\bתציץ\b(?:\s+ב)?/gu, "לעבור על ")
    .replace(/\bתדבר\s+איתי\b/gu, requester ? `לשוחח עם ${requester}` : "לשוחח")
    .replace(/\bdownload\b/gi, "download")
    .replace(/\s+/g, " ")
    .trim();

  if (/איתי|with\s+me|אליו|him\b/i.test(draft) && !requester) {
    return { title: null, unresolvedPronoun: true };
  }
  if (/איתי|with\s+me/i.test(draft) && requester) {
    draft = draft
      .replace(/\bאיתי\b/gu, `עם ${requester}`)
      .replace(/\bwith\s+me\b/gi, `with ${requester}`);
  }

  if (!startsWithInfinitive(draft) && obj.length >= 3) {
    if (wantsApprove) draft = `לאשר את ${obj}`;
    else if (wantsReview) draft = `לעבור על ${obj}`;
    else if (wantsDownload) draft = `להוריד את ${obj}`;
    else if (wantsHandle) draft = `לבצע ${obj}`;
  }

  draft = draft.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!draft || isGenericActionTitle(draft) || hasContextPronouns(draft)) {
    if (hasContextPronouns(draft) && !requester) unresolvedPronoun = true;
    return { title: null, unresolvedPronoun };
  }
  return { title: draft, unresolvedPronoun };
}

export function assessProfessionalTitle(opts: {
  title: string;
  requestEvidence: string;
  businessObjectEvidence?: string | null;
  contextEvidence?: string | null;
  subject?: string | null;
  bodyLead?: string | null;
  requesterCanonicalName?: string | null;
}): ProfessionalTitleChecks {
  const base = assessTitleSpecificity(opts);
  const title = opts.title.replace(/\s+/g, " ").trim();
  const noContextDependentPronouns = !hasContextPronouns(title);
  const noTrailingEtc = !hasTrailingEtc(title);
  const noPolitenessNoise = !hasPolitenessNoise(title);
  const grammaticallyComplete =
    startsWithInfinitive(title) &&
    title.length >= 8 &&
    !/[-–]\s*$/.test(title) &&
    !/\bוכו/.test(title);

  const obj = (opts.businessObjectEvidence ?? "").trim();
  const specificBusinessObject =
    (obj.length >= 2 && !/^(?:זה|הנושא|הבקשה|this|it)$/i.test(obj)) ||
    base.businessObjectPresent;

  const envelope = firstName(opts.requesterCanonicalName)?.toLowerCase() ?? "";
  const hay = normalizeForEvidenceMatch(
    [
      opts.requestEvidence,
      opts.businessObjectEvidence ?? "",
      opts.contextEvidence ?? "",
      opts.subject ?? "",
      opts.bodyLead ?? "",
      opts.requesterCanonicalName ?? "",
    ].join("\n"),
  );
  const tokens = contentTokens(title);
  const fullyGrounded =
    tokens.length > 0 &&
    tokens.every((tok) => tokenGroundedInHay(tok, hay, envelope));

  const standaloneMeaningful =
    !isGenericActionTitle(title) &&
    noContextDependentPronouns &&
    noPolitenessNoise &&
    grammaticallyComplete &&
    specificBusinessObject &&
    title.length >= 10;

  return {
    ...base,
    actionVerbPresent: base.actionVerbPresent || startsWithInfinitive(title),
    businessObjectPresent: specificBusinessObject,
    standaloneMeaningful,
    groundedInEvidence: fullyGrounded,
    noContextDependentPronouns,
    noTrailingEtc,
    noPolitenessNoise,
    grammaticallyComplete,
    specificBusinessObject,
    fullyGrounded,
  };
}

export function applyProfessionalTitleGate(opts: {
  title: string;
  speechAct: RequestSpeechAct | null | undefined;
  requestEvidence: string;
  businessObjectEvidence?: string | null;
  contextEvidence?: string | null;
  subject?: string | null;
  body: string;
  requesterCanonicalName?: string | null;
  titleSourceHint?: "model" | "downstream_fallback";
}): ProfessionalTitleResult {
  const base = applyTitleQualityGate({
    title: opts.title,
    speechAct: opts.speechAct,
    requestEvidence: opts.requestEvidence,
    businessObjectEvidence: opts.businessObjectEvidence,
    contextEvidence: opts.contextEvidence,
    subject: opts.subject,
    body: opts.body,
    titleSourceHint: opts.titleSourceHint,
  });

  const lead = extractCurrentMessageLead(opts.body);
  const normalized = normalizeProfessionalTitle({
    draftTitle: base.finalTitle,
    speechAct: opts.speechAct,
    requestEvidence: opts.requestEvidence,
    businessObject: base.businessObjectEvidence,
    subject: opts.subject,
    bodyLead: lead,
    contextEvidence: opts.contextEvidence,
    requesterCanonicalName: opts.requesterCanonicalName,
  });

  if (normalized.unresolvedPronoun || !normalized.title) {
    const checks = assessProfessionalTitle({
      title: base.finalTitle,
      requestEvidence: opts.requestEvidence,
      businessObjectEvidence: base.businessObjectEvidence,
      contextEvidence: opts.contextEvidence,
      subject: opts.subject,
      bodyLead: lead,
      requesterCanonicalName: opts.requesterCanonicalName,
    });
    return {
      checks: {
        ...checks,
        noContextDependentPronouns: false,
        fullyGrounded: false,
        standaloneMeaningful: false,
      },
      pass: false,
      status: "needs_human_review",
      finalTitle: base.finalTitle,
      displayTitle: base.finalTitle,
      requestEvidenceOriginal: base.evidenceIntegrity.originalRequestEvidence,
      requestEvidenceNormalized:
        base.evidenceIntegrity.normalizedRequestEvidence,
      businessObjectEvidence: base.businessObjectEvidence,
      contextEvidence: base.contextEvidence,
      requesterCanonicalName: opts.requesterCanonicalName ?? null,
      rewritten: base.rewritten,
      titleSource: base.titleSource,
    };
  }

  const finalTitle = normalized.title;
  const checks = assessProfessionalTitle({
    title: finalTitle,
    requestEvidence: opts.requestEvidence,
    businessObjectEvidence: base.businessObjectEvidence,
    contextEvidence: opts.contextEvidence,
    subject: opts.subject,
    bodyLead: lead,
    requesterCanonicalName: opts.requesterCanonicalName,
  });

  const pass =
    checks.noContextDependentPronouns &&
    checks.noTrailingEtc &&
    checks.noPolitenessNoise &&
    checks.grammaticallyComplete &&
    checks.specificBusinessObject &&
    checks.standaloneMeaningful &&
    checks.fullyGrounded &&
    !isGenericActionTitle(finalTitle);

  return {
    checks,
    pass,
    status: pass ? "ready_for_persist" : "needs_human_review",
    finalTitle,
    displayTitle: finalTitle,
    requestEvidenceOriginal: base.evidenceIntegrity.originalRequestEvidence,
    requestEvidenceNormalized: base.evidenceIntegrity.normalizedRequestEvidence,
    businessObjectEvidence: base.businessObjectEvidence,
    contextEvidence: base.contextEvidence,
    requesterCanonicalName: opts.requesterCanonicalName ?? null,
    rewritten: true,
    titleSource: "professional_normalize",
  };
}
