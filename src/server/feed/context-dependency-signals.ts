/**
 * O5C.3.1 — Deterministic cross-thread dependency signals (no business conclusion).
 * Domain-agnostic, HE/EN. Never invents cards or resolves facts.
 */

export type CrossThreadDependencySignalKind =
  | "reference_id"
  | "change_without_baseline"
  | "prior_state_reference"
  | "continuation_subject"
  | "commitment_or_approval_missing_object";

export type CrossThreadDependencySignal = {
  kind: CrossThreadDependencySignalKind;
  strength: "strong" | "moderate";
  evidence: string;
};

export type DetectCrossThreadDependencyInput = {
  subject?: string | null;
  currentMessageCleanText?: string | null;
  /** Concatenated prior messages in the CURRENT thread only. */
  currentThreadHistoryText?: string | null;
  referenceIdsFromModel?: string[];
};

const REF_ID =
  /(?:\b(?:PO|INV|SO|WO|RFQ|PR|Q)[\s#:_-]*[A-Z0-9][A-Z0-9/-]{2,}\b|\b[A-Z]{1,5}[-_/]?\d{3,}[A-Z0-9/-]*\b|\b\d{4,}[-/]\d{2,}(?:[-/]\d+)?\b)/giu;

const CHANGE_COMPARE =
  /(?:הנחה|העלאה|הורדה|שינוי|עדכון|במקום|במקום\s+זאת|instead\s+of|replaces?|updated?\s+(?:to|from)|%\s*(?:off|הנחה)|discount|increase|decrease|revision|גרסה\s+\d|version\s+\d)/iu;

const BASELINE_HINT =
  /(?:מחיר\s+בסיס\s*[:\s]*\d|מחיר\s+קודם\s*[:\s]*\d|הסכום\s+הקודם\s*[:\s]*\d|was\s+\$?\d|from\s+\$?\d|מ\s*\$?\d[\d,]|previous\s+(?:price|amount|quote)\s*(?:of|=|:)?\s*\$?\d|prior\s+(?:price|amount)\s*\$?\d|[\d,]+\s*(?:₪|\$|€|ILS|USD)|(?:₪|\$|€)\s*[\d,]+)/iu;

const PRIOR_STATE =
  /(?:כפי\s+ש(?:סוכם|נשלח|אושר|דיברנו|סוכם)|מה\s+ש(?:סוכם|נשלח|אושר)|לפי\s+(?:התנאים|ההסכם|מה\s+ש)|as\s+(?:agreed|discussed|previously)|per\s+(?:our|the)\s+(?:previous|prior|last)|previous(?:ly)?\s+(?:terms|decision|commitment|offer|quote|version)|prior\s+(?:terms|decision|commitment)|שסיכמנו\s+קודם|שנשלח\s+קודם)/iu;

const CONTINUATION_SUBJECT =
  /(?:מייל\s*\d|חלק\s+(?:ראשון|שני|\d)|המשך\s+(?:ל|של)|part\s+\d|follow[\s-]?up|continuation|בהמשך\s+ל)/iu;

const COMMIT_APPROVE =
  /(?:מאשר|אישור|מאושר|מתחייב|תקף|approve[ds]?|approval|confirm(?:ed|ation)?|commit(?:ment|ted)?)/iu;

const OBJECT_PRESENT =
  /(?:הצעה|הזמנה|חוזה|הסכם|מסמך|גרסה|quote|offer|proposal|order|contract|version|invoice|PO\b)/iu;

function hasDigitRef(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(REF_ID)) {
    const v = m[0]!.trim();
    if (!/\d/.test(v)) continue;
    // Avoid WO+word false positives by requiring digit (already) and length.
    if (v.length < 4) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 8);
}

function inHistory(needle: string, history: string): boolean {
  if (!needle.trim() || !history.trim()) return false;
  return history.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Structural signals only. Does not decide business outcomes.
 */
export function detectCrossThreadDependencySignals(
  input: DetectCrossThreadDependencyInput,
): CrossThreadDependencySignal[] {
  const subject = (input.subject ?? "").trim();
  const current = (input.currentMessageCleanText ?? "").trim();
  const history = (input.currentThreadHistoryText ?? "").trim();
  const blob = `${subject}\n${current}`;
  const signals: CrossThreadDependencySignal[] = [];

  const refs = [
    ...hasDigitRef(blob),
    ...(input.referenceIdsFromModel ?? []).filter((r) => /\d/.test(r)),
  ];
  for (const ref of [...new Set(refs.map((r) => r.trim()).filter(Boolean))]) {
    if (!inHistory(ref, history)) {
      signals.push({
        kind: "reference_id",
        strength: "strong",
        evidence: ref.slice(0, 80),
      });
    }
  }

  if (CHANGE_COMPARE.test(blob) && !BASELINE_HINT.test(blob)) {
    const hasBaselineInThread =
      BASELINE_HINT.test(history) ||
      /(?:₪|\$|€|ILS|USD)\s*[\d,]/.test(history) ||
      /[\d,]+\s*(?:₪|\$|€)/.test(history);
    if (!hasBaselineInThread) {
      const m = blob.match(CHANGE_COMPARE);
      signals.push({
        kind: "change_without_baseline",
        strength: "strong",
        evidence: (m?.[0] ?? "change").slice(0, 80),
      });
    }
  }

  if (PRIOR_STATE.test(blob)) {
    const m = blob.match(PRIOR_STATE);
    const span = (m?.[0] ?? "prior").slice(0, 80);
    // If the antecedent phrase's object isn't substantiated in-thread, flag.
    const antecedentLikelyMissing =
      !OBJECT_PRESENT.test(history) || history.length < 40;
    signals.push({
      kind: "prior_state_reference",
      strength: antecedentLikelyMissing ? "strong" : "moderate",
      evidence: span,
    });
  }

  if (CONTINUATION_SUBJECT.test(subject) || CONTINUATION_SUBJECT.test(blob)) {
    const m = `${subject} ${current}`.match(CONTINUATION_SUBJECT);
    const span = (m?.[0] ?? "continuation").slice(0, 80);
    // Continuation is strong when history is empty/short (part 1 elsewhere).
    signals.push({
      kind: "continuation_subject",
      strength: history.length < 80 ? "strong" : "moderate",
      evidence: span,
    });
  }

  if (COMMIT_APPROVE.test(blob) && OBJECT_PRESENT.test(blob)) {
    const obj = blob.match(OBJECT_PRESENT)?.[0] ?? "object";
    if (!inHistory(obj, history) && hasDigitRef(blob).some((r) => !inHistory(r, history))) {
      signals.push({
        kind: "commitment_or_approval_missing_object",
        strength: "strong",
        evidence: obj.slice(0, 80),
      });
    } else if (!inHistory(obj, history) && history.length < 120) {
      signals.push({
        kind: "commitment_or_approval_missing_object",
        strength: "moderate",
        evidence: obj.slice(0, 80),
      });
    }
  }

  // Dedupe by kind+evidence
  const seen = new Set<string>();
  return signals.filter((s) => {
    const k = `${s.kind}:${s.evidence.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function hasStrongCrossThreadDependencySignals(
  signals: CrossThreadDependencySignal[],
): boolean {
  return signals.some((s) => s.strength === "strong");
}
