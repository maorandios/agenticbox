/**
 * O5C.3.2 — Material gain classification after Context Completion (no Persist).
 */

export type MaterialGain =
  | "material"
  | "restatement_only"
  | "unrelated_context"
  | "insufficient";

export type FactSpan = {
  fact: string;
  source: "trigger" | "historical";
  threadId: string | null;
  evidence: string;
};

const MATERIAL_PATTERNS =
  /(?:ביקש|התבקש|נשלח|בוצע|אושר|סוכם|התחיי|תנאי|החלט|גרסה|סטטוס|הצעה|מסמך|REV[-\s]?\d|requested|sent|approved|agreed|commit(?:ment|ted)?|terms|decision|version|status|quote|proposal)/iu;

/**
 * Compare trigger-visible text vs historical-only evidence spans.
 * Does not invent business conclusions — structural gain only.
 */
export function classifyMaterialGain(opts: {
  triggerText: string;
  currentThreadText: string;
  historicalExcerpts: Array<{ threadId: string; excerpt: string }>;
  resolution: {
    status: "resolved" | "insufficient" | "conflicting";
    items: Array<{
      type: string;
      headline: string;
      evidenceText?: string | null;
      supportingSources?: Array<{
        role: "trigger" | "historical";
        threadId: string;
        evidence: string;
      }>;
    }>;
    supportingSources: Array<{
      role: "trigger" | "historical";
      threadId: string;
      evidence: string;
    }>;
  } | null;
}): {
  materialGain: MaterialGain;
  triggerOnlyFacts: FactSpan[];
  historicalOnlyFacts: FactSpan[];
  combinedInsight: string[];
  reason: string;
  wouldAddFeedValue: boolean;
  displayStatus: "resolved" | "insufficient" | "conflicting" | "not_needed";
} {
  const triggerBlob = `${opts.triggerText}\n${opts.currentThreadText}`.toLowerCase();
  const triggerOnlyFacts: FactSpan[] = [];
  const historicalOnlyFacts: FactSpan[] = [];

  // Trigger-facing facts from current message (coarse chunks).
  for (const chunk of opts.triggerText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20)
    .slice(0, 6)) {
    triggerOnlyFacts.push({
      fact: chunk.slice(0, 160),
      source: "trigger",
      threadId: null,
      evidence: chunk.slice(0, 160),
    });
  }

  for (const h of opts.historicalExcerpts) {
    const tokens = h.excerpt
      .split(/\s+/)
      .filter((t) => t.length >= 5)
      .slice(0, 40);
    const novel = tokens.filter((t) => !triggerBlob.includes(t.toLowerCase()));
    if (novel.length < 3) continue;
    const evidence = h.excerpt.slice(0, 220);
    // Restatement of "plans attached/sent" alone is weak.
    const restatementOnly =
      /תוכני(?:ות|ם)|מצורפ|נשלח|plans?|attached|sent/i.test(evidence) &&
      !MATERIAL_PATTERNS.test(evidence.replace(/תוכני(?:ות|ם)|מצורפ|נשלח|plans?|attached|sent/gi, " "));
    if (restatementOnly) continue;
    historicalOnlyFacts.push({
      fact: evidence.slice(0, 160),
      source: "historical",
      threadId: h.threadId,
      evidence,
    });
  }

  // Also pull historical supportingSources from resolution.
  for (const s of opts.resolution?.supportingSources ?? []) {
    if (s.role !== "historical") continue;
    if (triggerBlob.includes(s.evidence.toLowerCase().slice(0, 40))) continue;
    if (
      !historicalOnlyFacts.some(
        (f) => f.threadId === s.threadId && f.evidence.includes(s.evidence.slice(0, 40)),
      )
    ) {
      historicalOnlyFacts.push({
        fact: s.evidence.slice(0, 160),
        source: "historical",
        threadId: s.threadId,
        evidence: s.evidence.slice(0, 220),
      });
    }
  }

  const combinedInsight =
    opts.resolution?.items.map((i) => i.headline).filter(Boolean) ?? [];

  if (!opts.resolution || opts.resolution.status === "insufficient") {
    return {
      materialGain: "insufficient",
      triggerOnlyFacts,
      historicalOnlyFacts,
      combinedInsight,
      reason: "Completion returned insufficient or empty resolution.",
      wouldAddFeedValue: false,
      displayStatus: "insufficient",
    };
  }

  if (opts.resolution.status === "conflicting") {
    return {
      materialGain: "insufficient",
      triggerOnlyFacts,
      historicalOnlyFacts,
      combinedInsight,
      reason: "Conflicting sources — no stable material gain.",
      wouldAddFeedValue: false,
      displayStatus: "conflicting",
    };
  }

  // Unrelated: historical excerpts share almost no subject tokens with trigger,
  // AND the resolution did not jointly cite trigger+historical.
  const triggerTokens = new Set(
    opts.triggerText
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ""))
      .filter((t) => t.length >= 4),
  );
  let overlap = 0;
  for (const h of opts.historicalExcerpts) {
    for (const t of h.excerpt.toLowerCase().split(/\s+/)) {
      const n = t.replace(/[^\p{L}\p{N}-]/gu, "");
      if (n.length >= 4 && triggerTokens.has(n)) overlap += 1;
    }
  }
  const jointlyCited = (opts.resolution.supportingSources ?? []).some(
    (s) => s.role === "historical",
  ) &&
    ((opts.resolution.supportingSources ?? []).some((s) => s.role === "trigger") ||
      opts.resolution.items.some((i) =>
        (i.supportingSources ?? []).some((s) => s.role === "trigger"),
      ));
  if (opts.historicalExcerpts.length > 0 && overlap < 2 && !jointlyCited) {
    return {
      materialGain: "unrelated_context",
      triggerOnlyFacts,
      historicalOnlyFacts,
      combinedInsight,
      reason: "Mapped sources look topically unrelated to the trigger event.",
      wouldAddFeedValue: false,
      displayStatus: "not_needed",
    };
  }

  const hasMaterialHistorical = historicalOnlyFacts.some((f) =>
    MATERIAL_PATTERNS.test(f.evidence),
  );
  const onlyPlansRestatement =
    historicalOnlyFacts.length === 0 &&
    opts.historicalExcerpts.some((h) =>
      /תוכני|מצורפ|נשלח|plans?|attached/i.test(h.excerpt),
    );

  if (onlyPlansRestatement || (!hasMaterialHistorical && historicalOnlyFacts.length === 0)) {
    return {
      materialGain: "restatement_only",
      triggerOnlyFacts,
      historicalOnlyFacts,
      combinedInsight,
      reason:
        "History mainly restates that plans were sent/attached — already clear from the trigger.",
      wouldAddFeedValue: false,
      displayStatus: "not_needed",
    };
  }

  if (hasMaterialHistorical || historicalOnlyFacts.length > 0) {
    // Require combined claim to cite both roles when items exist.
    const itemsOk =
      (opts.resolution.items.length === 0 && historicalOnlyFacts.length > 0) ||
      opts.resolution.items.every((item) => {
        if (item.type === "action") return false; // history must not create Action
        const srcs = item.supportingSources ?? opts.resolution!.supportingSources;
        const hasT = srcs.some((s) => s.role === "trigger");
        const hasH = srcs.some((s) => s.role === "historical");
        return hasT && hasH;
      });

    if (!itemsOk && opts.resolution.items.some((i) => i.type === "action")) {
      return {
        materialGain: "insufficient",
        triggerOnlyFacts,
        historicalOnlyFacts,
        combinedInsight,
        reason: "Blocked: historical context attempted to create an Action.",
        wouldAddFeedValue: false,
        displayStatus: "insufficient",
      };
    }

    if (hasMaterialHistorical && itemsOk) {
      return {
        materialGain: "material",
        triggerOnlyFacts,
        historicalOnlyFacts,
        combinedInsight,
        reason:
          "Historical source adds a prior ask/status/object/version not present in the trigger alone.",
        wouldAddFeedValue: true,
        displayStatus: "resolved",
      };
    }
  }

  return {
    materialGain: "restatement_only",
    triggerOnlyFacts,
    historicalOnlyFacts,
    combinedInsight,
    reason: "No proven historical-only material fact beyond the trigger message.",
    wouldAddFeedValue: false,
    displayStatus: "not_needed",
  };
}
