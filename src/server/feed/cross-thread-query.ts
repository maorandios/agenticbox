/**
 * O5C.1 — Deterministic cross-thread search query builder.
 * Domain-agnostic, HE/EN aware. No AI. No hard-coded domains/threads.
 */

export type CrossThreadSearchQueryInput = {
  subject?: string | null;
  currentMessageCleanText?: string | null;
  participants?: Array<{ email?: string | null; name?: string | null }>;
  referenceIdentifiers?: string[];
  dates?: string[];
  currentThreadId?: string | null;
};

const REF_ID =
  /(?:\b(?:PO|INV|SO|WO|RFQ|PR)[\s#:_-]*[A-Z0-9][A-Z0-9/-]{2,}\b|\b[A-Z]{1,5}[-_]?\d{3,}[A-Z0-9/-]*\b|\b\d{4,}[-/]\d{2,}(?:[-/]\d+)?\b)/giu;

const CURRENCY =
  /(?:\$|€|£|₪|USD|EUR|ILS|NIS)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:\$|€|£|₪|USD|EUR|ILS|NIS)/giu;

const HE_STOP = new Set([
  "של",
  "את",
  "על",
  "עם",
  "אל",
  "או",
  "גם",
  "רק",
  "זה",
  "זו",
  "הוא",
  "היא",
  "אני",
  "אנחנו",
  "בבקשה",
  "שלום",
  "היי",
  "תודה",
  "נא",
  "לגבי",
  "עבור",
  "מאת",
]);

const EN_STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "for",
  "and",
  "or",
  "with",
  "from",
  "please",
  "hi",
  "hello",
  "thanks",
  "thank",
  "you",
  "re",
  "fw",
  "fwd",
]);

function uniqPreserve(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function stripSubjectNoise(subject: string): string {
  return subject
    .replace(/^(?:(?:re|fw|fwd|השב|העבר)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function topicPhrases(text: string): string[] {
  const cleaned = text
    .replace(/[<>[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}\s@._+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(" ").filter((t) => {
    if (t.length < 3) return false;
    if (t.includes("@")) return false;
    const lower = t.toLowerCase();
    if (HE_STOP.has(lower) || EN_STOP.has(lower)) return false;
    return true;
  });
  return uniqPreserve(tokens).slice(0, 8);
}

function participantTerms(
  participants: CrossThreadSearchQueryInput["participants"],
): string[] {
  const out: string[] = [];
  for (const p of participants ?? []) {
    const email = (p.email ?? "").trim().toLowerCase();
    const name = (p.name ?? "").replace(/\s+/g, " ").trim();
    if (email && email.includes("@")) {
      out.push(email);
      const local = email.split("@")[0];
      if (local && local.length >= 3) out.push(local);
    }
    if (name) {
      const parts = name.split(/[\s|]+/).filter((x) => x.length >= 2);
      out.push(...parts.slice(0, 3));
    }
  }
  return uniqPreserve(out).slice(0, 8);
}

/**
 * Build a deterministic lexical query for Onyx Document Search.
 * Does not include currentThreadId (used only by callers for filtering).
 */
export function buildCrossThreadSearchQuery(
  input: CrossThreadSearchQueryInput,
): string {
  const subject = stripSubjectNoise(input.subject ?? "");
  const body = (input.currentMessageCleanText ?? "").replace(/\s+/g, " ").trim();
  const corpus = `${subject}\n${body}`;

  const refs = uniqPreserve([
    ...(input.referenceIdentifiers ?? []),
    ...(corpus.match(REF_ID) ?? []),
  ]).slice(0, 6);

  const money = uniqPreserve(corpus.match(CURRENCY) ?? []).slice(0, 3);
  const people = participantTerms(input.participants);
  const dates = uniqPreserve(input.dates ?? []).slice(0, 3);
  const topics = topicPhrases(`${subject} ${body.slice(0, 400)}`);

  // Prefer precise identifiers; otherwise fall back to people + subject topics.
  const parts = uniqPreserve([
    ...refs,
    ...money,
    ...people,
    ...dates,
    ...topics,
  ]);

  const query = parts.join(" ").trim().slice(0, 2048);
  return query;
}
