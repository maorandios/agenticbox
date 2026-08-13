/**
 * Deterministic evidence normalization / matching for Feed validation.
 * No fuzzy semantic / free paraphrase matching.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Strip bidi/control chars, decode common HTML entities, NFKC, collapse space. */
export function normalizeEvidenceText(text: string): string {
  let out = text.normalize("NFKC");
  out = out.replace(
    /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g,
    "",
  );
  out = out.replace(
    /&(?:lt|gt|amp|quot|apos|nbsp|#39);/gi,
    (m) => HTML_ENTITIES[m.toLowerCase()] ?? m,
  );
  out = out.replace(/\u00A0/g, " ");
  // Unify quotes / dashes / geresh
  out = out
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036«»]/g, '"')
    .replace(/[\u2010-\u2015\u2212־]/g, "-")
    .replace(/[״″]/g, '"')
    .replace(/[׳′]/g, "'");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/** Lowercased normalized form for substring matching. */
export function normalizeForEvidenceMatch(text: string): string {
  return normalizeEvidenceText(text).toLowerCase();
}

/**
 * Match evidence as an exact substring after normalization.
 * Also tries a punctuation-light form for short Hebrew spans (no free paraphrase).
 */
export function evidenceMatchesHaystack(
  evidence: string,
  haystack: string,
): boolean {
  const ev = normalizeForEvidenceMatch(evidence);
  const hay = normalizeForEvidenceMatch(haystack);
  if (!ev) return false;
  if (hay.includes(ev)) return true;

  // Punctuation-light pass (keep letters/digits/currency; drop edge punctuation).
  const soft = (s: string) =>
    s
      .replace(/[.,;:!?\u061B\u06D4״"']+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const evSoft = soft(ev);
  const haySoft = soft(hay);
  if (evSoft.length >= 2 && haySoft.includes(evSoft)) return true;

  return false;
}

/** Forward / quote markers that separate CURRENT lead-in from history. */
const FORWARD_OR_QUOTE_MARKERS = [
  /-{2,}\s*Forwarded message\s*-{2,}/i,
  /-{2,}\s*Original Message\s*-{2,}/i,
  // Outlook / Gmail headers — allow compressed single-line forwards (no newlines).
  /(?:^|[\s>])From:\s+[^\n]{0,200}?\sSent:\s+/i,
  /\nFrom:\s.+\nSent:\s/i,
  /(?:^|[\s>])מאת:\s+[^\n]{0,200}?\s(?:נשלח|Sent):\s+/i,
  /(?<![A-Za-z])On\s+[A-Z][a-z]{2},?\s+[A-Z][a-z]{2}\s+\d{1,2}.+?\bwrote:\s*/i,
  /(?<![A-Za-z])On\s+.+?\bwrote:\s*/i,
  /\nמאת:\s.+\nנשלח:\s/i,
  /בתאריך יום .{0,120}?מאת\s+/i,
];

/**
 * Prefer the lead-in before a forward/quote block for CURRENT_MESSAGE speech.
 * Falls back to the full body when no marker / lead too short.
 */
export function extractCurrentMessageLead(body: string): string {
  const text = body.replace(/\r\n/g, "\n");
  for (const marker of FORWARD_OR_QUOTE_MARKERS) {
    const idx = text.search(marker);
    if (idx >= 0) {
      const lead = text.slice(0, idx).trim();
      if (lead.length >= 2) return lead;
    }
  }
  // Inline concatenated Gmail: "...בבקשה.---------- Forwarded"
  const inline = text.search(/-{5,}\s*Forwarded message\s*-{5,}/i);
  if (inline >= 0) {
    const lead = text.slice(0, inline).trim();
    if (lead.length >= 2) return lead;
  }
  return text.trim();
}

export type RejectedCandidateAudit = {
  type: string | null;
  title: string | null;
  speechAct: string | null;
  actionState: string | null;
  requesterEmail: string | null;
  requesterName: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  requestEvidence: string | null;
  businessObjectEvidence: string | null;
  rejectionStage: string;
  rejectionReason: string;
};

export function buildRejectedCandidateAudit(opts: {
  candidate: {
    type?: string | null;
    headline?: string | null;
    requestedAction?: string | null;
    requestSpeechAct?: string | null;
    actionState?: string | null;
    requester?: { email?: string | null; name?: string | null } | null;
    assignee?: { email?: string | null; name?: string | null } | null;
    requestEvidence?: { evidenceText?: string | null } | null;
    businessObjectEvidence?: { evidenceText?: string | null } | null;
    evidenceText?: string | null;
  };
  reason: string;
  stage?: string;
}): RejectedCandidateAudit {
  const c = opts.candidate;
  return {
    type: c.type ?? null,
    title: c.requestedAction ?? c.headline ?? null,
    speechAct: c.requestSpeechAct ?? null,
    actionState: c.actionState ?? null,
    requesterEmail: c.requester?.email ?? null,
    requesterName: c.requester?.name ?? null,
    assigneeEmail: c.assignee?.email ?? null,
    assigneeName: c.assignee?.name ?? null,
    requestEvidence:
      c.requestEvidence?.evidenceText ?? c.evidenceText ?? null,
    businessObjectEvidence: c.businessObjectEvidence?.evidenceText ?? null,
    rejectionStage: opts.stage ?? "validator",
    rejectionReason: opts.reason,
  };
}

export function rejectionStageForReason(reason: string): string {
  if (
    reason === "disposition_suppress" ||
    reason === "verification_solicitation" ||
    reason === "cold_outreach" ||
    reason === "already_sent_not_action" ||
    reason === "marketing_cta"
  ) {
    return "safety";
  }
  if (
    reason === "evidence_not_found" ||
    reason === "evidence_from_removed_section" ||
    reason === "due_evidence_not_found" ||
    reason === "request_evidence_missing" ||
    reason === "request_evidence_greeting" ||
    reason === "request_evidence_semantic_mismatch"
  ) {
    return "evidence";
  }
  if (
    reason === "confidence_low" ||
    reason === "business_relevance_low" ||
    reason === "semantic_precision_low" ||
    reason === "attribution_confidence_low"
  ) {
    return "confidence";
  }
  if (reason === "thread_not_business") return "model";
  return "validator";
}
