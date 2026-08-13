/**
 * Generic Action title quality gate — domain-agnostic, language-aware.
 * No thread/sender/project hardcodes.
 */

import {
  evidenceMatchesHaystack,
  extractCurrentMessageLead,
  normalizeEvidenceText,
  normalizeForEvidenceMatch,
} from "./evidence-match";
import type { RequestSpeechAct } from "./speech-act";
import { extractBusinessObjectSpan } from "./speech-act";

export type TitleSpecificityChecks = {
  actionVerbPresent: boolean;
  businessObjectPresent: boolean;
  standaloneMeaningful: boolean;
  groundedInEvidence: boolean;
};

export type TitleQualityResult = {
  checks: TitleSpecificityChecks;
  pass: boolean;
  status: "ready_for_persist" | "needs_human_review";
  finalTitle: string;
  rewritten: boolean;
  modelOrFallbackTitle: string;
  titleSource: "model" | "downstream_fallback" | "downstream_rewrite";
  evidenceIntegrity: {
    ok: boolean;
    originalRequestEvidence: string;
    normalizedRequestEvidence: string;
    reason: string | null;
  };
  businessObjectEvidence: string | null;
  contextEvidence: string | null;
};

/** Structural/generic titles — signal only; paired with specificity checks. */
const GENERIC_TITLE_SIGNAL =
  /^(?:לבצע את הבקשה|לטפל בנושא|להתייחס ל(?:ה)?בקשה|להתייחס לזה|לבדוק את זה|לחזור אליו|לעשות את הנדרש|לטפל בזה|נא לטפל|please handle this|follow up|take care of this|handle this|do the (?:request|needed)|review this|check this)[\s.]*$/iu;

const ACTION_VERB_HE =
  /(?:לאשר|לבדוק|לעיין|לעבור|להוריד|לשלוח|להגיש|להשיב|להתייחס|לטפל|לטיפול|לבצע|לתאם|לעדכן|לתקן|לשלם|להשלים|לחתום|להחליף|להתקין|לסקור|לשוחח|תוריד|תבדוק|תאשר|תשלח|תציץ|תדבר)/i;

const ACTION_VERB_EN =
  /(?:\bapprove\b|\breview\b|\bcheck\b|\bsend\b|\bsubmit\b|\bdownload\b|\breply\b|\bupdate\b|\bpay\b|\bsign\b|\breplace\b|\bschedule\b|\bconfirm\b|\bhandle\b|\bfollow[\s-]?up\b)/i;

const STOPWORDS = new Set(
  [
    "את",
    "על",
    "של",
    "עם",
    "אל",
    "או",
    "גם",
    "רק",
    "זה",
    "זו",
    "זאת",
    "הבקשה",
    "הנושא",
    "הנדרש",
    "המצורף",
    "הפריט",
    "נא",
    "בבקשה",
    "please",
    "the",
    "a",
    "an",
    "to",
    "of",
    "for",
    "this",
    "that",
    "it",
    "and",
    "or",
    "with",
    "from",
    "into",
  ].map((s) => s.toLowerCase()),
);

function contentTokens(text: string): string[] {
  return normalizeForEvidenceMatch(text)
    .split(/[\s"'״״`.,;:!?()[\]{}\-/\\|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function isGenericActionTitle(title: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (GENERIC_TITLE_SIGNAL.test(t)) return true;
  // Pronoun/demonstrative-only object after a verb
  if (
    /^(?:לבדוק|לטפל|להתייחס|לעשות|handle|review|check|follow)\s+(?:את\s+)?(?:זה|הנושא|הבקשה|this|it)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function assessTitleSpecificity(opts: {
  title: string;
  requestEvidence: string;
  businessObjectEvidence?: string | null;
  contextEvidence?: string | null;
  subject?: string | null;
  bodyLead?: string | null;
}): TitleSpecificityChecks {
  const title = opts.title.replace(/\s+/g, " ").trim();
  const actionVerbPresent =
    ACTION_VERB_HE.test(title) || ACTION_VERB_EN.test(title);

  const obj = (opts.businessObjectEvidence ?? "").trim();
  const businessObjectPresent =
    obj.length >= 2 ||
    contentTokens(title).some((tok) => {
      const hay = [
        opts.requestEvidence,
        opts.businessObjectEvidence ?? "",
        opts.contextEvidence ?? "",
        opts.subject ?? "",
        opts.bodyLead ?? "",
      ].join("\n");
      return (
        !ACTION_VERB_HE.test(tok) &&
        !ACTION_VERB_EN.test(tok) &&
        normalizeForEvidenceMatch(hay).includes(tok)
      );
    });

  const generic = isGenericActionTitle(title);
  const standaloneMeaningful =
    !generic &&
    title.length >= 10 &&
    actionVerbPresent &&
    businessObjectPresent;

  const evidenceHay = normalizeForEvidenceMatch(
    [
      opts.requestEvidence,
      opts.businessObjectEvidence ?? "",
      opts.contextEvidence ?? "",
      opts.subject ?? "",
      opts.bodyLead ?? "",
    ].join("\n"),
  );
  const tokens = contentTokens(title);
  const groundedInEvidence =
    tokens.length > 0 &&
    tokens.every((tok) => {
      if (evidenceHay.includes(tok)) return true;
      // Allow closed-set speech verbs when the evidence already carries that speech.
      if (
        /^(?:לאשר|לבדוק|לעיין|להוריד|לשלוח|להשיב|לטפל|לתאם|לעדכן|לשלם|תוריד|תבדוק|תאשר|תשלח|תציץ|approve|review|check|send|download|pay|update|reply|handle)$/i.test(
          tok,
        )
      ) {
        if (ACTION_VERB_HE.test(evidenceHay) || ACTION_VERB_EN.test(evidenceHay)) {
          return true;
        }
        // Morphological variants common in HE request forms.
        if (
          tok === "לאשר" &&
          /לאישור|אשמח\s+לאישור|מבקש\s+אישור/i.test(evidenceHay)
        ) {
          return true;
        }
        if (tok === "לבדוק" && /לבדיק|נא\s+לבדוק/i.test(evidenceHay)) {
          return true;
        }
        return false;
      }
      return false;
    });

  return {
    actionVerbPresent,
    businessObjectPresent,
    standaloneMeaningful,
    groundedInEvidence,
  };
}

export function composeSpecificTitle(opts: {
  speechAct: RequestSpeechAct | null | undefined;
  requestEvidence: string;
  businessObject: string | null;
  subject?: string | null;
  bodyLead?: string | null;
  existingTitle?: string | null;
}): string | null {
  const lead = opts.bodyLead ?? "";
  const evidence = opts.requestEvidence.replace(/\s+/g, " ").trim();
  const subject = (opts.subject ?? "").replace(/\s+/g, " ").trim();
  const obj =
    (opts.businessObject?.trim() ||
      extractBusinessObjectSpan({
        body: `${lead}\n${evidence}`,
        subject: opts.subject,
      }) ||
      "")
      .replace(/\s+/g, " ")
      .trim();

  // 1) Verbatim concrete ask span from evidence (best grounding).
  // Prefer a dual-action window (download + call) when both appear.
  const dual = evidence.match(
    /תוריד[\s\S]{0,100}?שיח(?:ה|ת)|download[\s\S]{0,100}?(?:call|meeting|talk)/i,
  );
  if (dual?.[0]) {
    const span = dual[0].replace(/\s+/g, " ").trim().replace(/[.,!?]+$/g, "");
    if (span.length >= 8) return span.slice(0, 160);
  }
  const verbatim = evidence.match(
    /(?:תוריד|תבדוק|תאשר|תשלח|תטפל|תציץ)[\s\S]{0,100}?(?:שיחה|איתי|[.!?]|בבקשה\.)|(?:נא|בבקשה)\s+(?:לאשר|לבדוק|לשלוח|להוריד|להשיב)[\s\S]{0,80}?(?:[.!?]|$)|(?:please\s+(?:approve|review|check|send|download|pay|update|reply)\s+)[\s\S]{0,80}?(?:[.!?]|$)|לטיפול(?:כם|ך)\s+[^\n.!?،,]{2,60}/i,
  );
  if (verbatim?.[0]) {
    let span = verbatim[0].replace(/\s+/g, " ").trim();
    span = span.replace(/[.,!?]+$/g, "").trim();
    if (span.length >= 8 && !isGenericActionTitle(span)) {
      return span.slice(0, 160);
    }
  }

  // 2) Subject ask that already names the action (review + talk, etc.)
  if (
    /אשמח\s+שת|תציץ|תדבר|please\s+(?:review|approve|check)/i.test(subject) &&
    subject.length >= 12 &&
    subject.length <= 120
  ) {
    const cleaned = subject
      .replace(/^(?:הי|שלום|hi|hello)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 10 && !isGenericActionTitle(cleaned)) {
      return cleaned.slice(0, 160);
    }
  }

  // 3) Combine object with a verb that appears in evidence/subject (no free paraphrase).
  const corpus = `${evidence}\n${subject}\n${lead}`;
  let verb: string | null = null;
  if (/תוריד|להוריד|download/i.test(corpus)) {
    verb = /תוריד/.test(corpus) ? "תוריד" : "להוריד";
  } else if (/תציץ|לעיין|review/i.test(corpus)) {
    verb = /תציץ/.test(corpus)
      ? "תציץ ב"
      : /review/i.test(corpus)
        ? "review"
        : "לעיין ב";
  } else if (/אשמח\s+לאישור|נא\s+לאשר|לאישור|approve/i.test(corpus)) {
    verb = /approve/i.test(corpus) ? "approve" : "לאשר";
  } else if (/לטיפול|לטפל|handle/i.test(corpus)) {
    verb = /לטיפול/.test(corpus)
      ? "לטיפול ב"
      : /handle/i.test(corpus)
        ? "handle"
        : "לטפל ב";
  } else if (/לשלם|pay|payment|invoice/i.test(corpus)) {
    verb = /pay/i.test(corpus) ? "pay" : "לשלם";
  } else if (/לעדכן|update/i.test(corpus)) {
    verb = /update/i.test(corpus) ? "update" : "לעדכן";
  } else if (/להשיב|reply|respond|תדבר/i.test(corpus)) {
    verb = /reply/i.test(corpus)
      ? "reply regarding"
      : /תדבר/.test(corpus)
        ? "תדבר על"
        : "להשיב לגבי";
  } else if (/לשלוח|תשלח|send/i.test(corpus)) {
    verb = /send/i.test(corpus) ? "send" : "לשלוח";
  }

  if (!verb || !obj || obj.length < 2) return null;

  let title: string;
  if (
    verb === "review" ||
    verb === "approve" ||
    verb === "pay" ||
    verb === "update" ||
    verb === "send" ||
    verb === "handle" ||
    verb === "reply regarding"
  ) {
    title = `${verb} ${obj}`;
  } else if (
    verb.endsWith(" ב") ||
    verb.endsWith(" ל") ||
    verb.endsWith(" לגבי") ||
    verb.endsWith(" על")
  ) {
    title = `${verb}${obj}`;
  } else if (/^(לאשר|לבדוק|לשלוח|להוריד|לעדכן|לשלם|תוריד)/.test(verb)) {
    title = `${verb} את ${obj}`;
  } else {
    title = `${verb} ${obj}`;
  }
  title = title.replace(/\s+/g, " ").trim().slice(0, 160);
  if (isGenericActionTitle(title)) return null;

  const objToks = contentTokens(obj);
  const hay = normalizeForEvidenceMatch(corpus);
  if (objToks.length > 0 && !objToks.every((t) => hay.includes(t))) return null;

  return title;
}

export function verifyEvidenceIntegrity(opts: {
  requestEvidence: string;
  body: string;
  subject?: string | null;
}): {
  ok: boolean;
  originalRequestEvidence: string;
  normalizedRequestEvidence: string;
  reason: string | null;
} {
  const original = opts.requestEvidence;
  const normalized = normalizeEvidenceText(original);
  const lead = extractCurrentMessageLead(opts.body);
  const inLead = evidenceMatchesHaystack(original, lead);
  const inSubject =
    !!opts.subject && evidenceMatchesHaystack(original, opts.subject);
  const inBody = evidenceMatchesHaystack(original, opts.body);
  if (!inLead && !inSubject && !inBody) {
    return {
      ok: false,
      originalRequestEvidence: original,
      normalizedRequestEvidence: normalized,
      reason: "evidence_integrity_failed",
    };
  }
  return {
    ok: true,
    originalRequestEvidence: original,
    normalizedRequestEvidence: normalized,
    reason: null,
  };
}

export function applyTitleQualityGate(opts: {
  title: string;
  speechAct: RequestSpeechAct | null | undefined;
  requestEvidence: string;
  businessObjectEvidence?: string | null;
  contextEvidence?: string | null;
  subject?: string | null;
  body: string;
  titleSourceHint?: "model" | "downstream_fallback";
}): TitleQualityResult {
  const lead = extractCurrentMessageLead(opts.body);
  const resolvedObject =
    (opts.businessObjectEvidence ?? "").trim() ||
    extractBusinessObjectSpan({
      body: lead,
      subject: opts.subject,
    }) ||
    null;

  const integrity = verifyEvidenceIntegrity({
    requestEvidence: opts.requestEvidence,
    body: opts.body,
    subject: opts.subject,
  });

  const modelOrFallbackTitle = opts.title.replace(/\s+/g, " ").trim();
  let finalTitle = modelOrFallbackTitle;
  let rewritten = false;
  let titleSource: TitleQualityResult["titleSource"] =
    opts.titleSourceHint ?? "model";

  if (!integrity.ok) {
    const checks = assessTitleSpecificity({
      title: finalTitle,
      requestEvidence: opts.requestEvidence,
      businessObjectEvidence: resolvedObject,
      contextEvidence: opts.contextEvidence,
      subject: opts.subject,
      bodyLead: lead,
    });
    return {
      checks: { ...checks, groundedInEvidence: false },
      pass: false,
      status: "needs_human_review",
      finalTitle,
      rewritten: false,
      modelOrFallbackTitle,
      titleSource,
      evidenceIntegrity: integrity,
      businessObjectEvidence: resolvedObject,
      contextEvidence: opts.contextEvidence ?? null,
    };
  }

  let checks = assessTitleSpecificity({
    title: finalTitle,
    requestEvidence: opts.requestEvidence,
    businessObjectEvidence: resolvedObject,
    contextEvidence: opts.contextEvidence,
    subject: opts.subject,
    bodyLead: lead,
  });

  const needsRewrite =
    isGenericActionTitle(finalTitle) ||
    !checks.standaloneMeaningful ||
    !checks.groundedInEvidence;

  if (needsRewrite) {
    const composed = composeSpecificTitle({
      speechAct: opts.speechAct,
      requestEvidence: opts.requestEvidence,
      businessObject: resolvedObject,
      subject: opts.subject,
      bodyLead: lead,
      existingTitle: finalTitle,
    });
    if (composed) {
      finalTitle = composed;
      rewritten = true;
      titleSource = "downstream_rewrite";
      checks = assessTitleSpecificity({
        title: finalTitle,
        requestEvidence: opts.requestEvidence,
        businessObjectEvidence: resolvedObject,
        contextEvidence: opts.contextEvidence,
        subject: opts.subject,
        bodyLead: lead,
      });
    }
  }

  const pass =
    checks.actionVerbPresent &&
    checks.businessObjectPresent &&
    checks.standaloneMeaningful &&
    checks.groundedInEvidence &&
    !isGenericActionTitle(finalTitle);

  return {
    checks,
    pass,
    status: pass ? "ready_for_persist" : "needs_human_review",
    finalTitle,
    rewritten,
    modelOrFallbackTitle,
    titleSource:
      opts.titleSourceHint === "downstream_fallback" && !rewritten
        ? "downstream_fallback"
        : titleSource,
    evidenceIntegrity: integrity,
    businessObjectEvidence: resolvedObject,
    contextEvidence: opts.contextEvidence ?? null,
  };
}
