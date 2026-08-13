/**
 * O5A.4B model comparison reports — no extraction engine changes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BlindReviewRecord } from "./report";

export type ModelRunSnapshot = {
  model: string;
  actualModel: string | null;
  openai: {
    probeCount: number;
    extractionAttempts: number;
    successes: number;
    failures: number;
    circuitBreaker: boolean;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    latencyTotalMs: number;
    latencyAvgMs: number;
    latencyMinMs: number | null;
    latencyMaxMs: number | null;
  };
  extraction: {
    zeroInsightThreads: number;
    candidates: number;
    accepted: number;
    rejected: number;
    rejectionReasons: Record<string, number>;
    byType: { action: number; change: number; decision: number; alert: number };
  };
  reviews: BlindReviewRecord[];
};

export type SideBySideThread = {
  threadIdMasked: string;
  sourceRoute: string;
  prefilterClassification: string;
  baseline: {
    model: string;
    status: string;
    modelClassification: string;
    acceptedCount: number;
    rejectedCount: number;
    rejectionReasons: string[];
    cards: BlindReviewRecord["candidateSummaries"];
    flags: string[];
  };
  challenger: {
    model: string;
    status: string;
    modelClassification: string;
    acceptedCount: number;
    rejectedCount: number;
    rejectionReasons: string[];
    cards: BlindReviewRecord["candidateSummaries"];
    flags: string[];
  };
};

export type ModelComparisonReport = {
  evaluationVersion: string;
  status: "AWAITING HUMAN MODEL COMPARISON";
  selectionSource: string;
  selectionSeed: string;
  threadCount: number;
  engineHashesMatchO5A4: boolean;
  engineCombinedHash: string;
  feedItemsUnchanged: boolean;
  feedItemsBefore: number;
  feedItemsAfter: number;
  baseline: ModelRunSnapshot;
  challenger: ModelRunSnapshot;
  sideBySide: SideBySideThread[];
  deltas: {
    acceptedDelta: number;
    candidatesDelta: number;
    rejectedDelta: number;
    zeroInsightDelta: number;
    inventedDeadlineBaseline: number;
    inventedDeadlineChallenger: number;
    verificationSuspectBaseline: number;
    verificationSuspectChallenger: number;
    marketingZeroBaseline: number;
    marketingZeroChallenger: number;
  };
  timestamp: string;
  note: string;
};

const VERIFICATION_RE =
  /תג האימות|appsheet|verified ai|noreply@appsheet|support verified/i;
const COLD_OUTREACH_RE =
  /share technical documents|cad-ready|unpause the project|cold outreach/i;

export function estimateTokenCostUsd(opts: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const rates: Record<string, { in: number; out: number }> = {
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gpt-5-mini": { in: 0.25, out: 2.0 },
  };
  const key = opts.model.startsWith("gpt-5-mini")
    ? "gpt-5-mini"
    : opts.model.startsWith("gpt-4o-mini")
      ? "gpt-4o-mini"
      : "gpt-4o-mini";
  const r = rates[key]!;
  return (opts.inputTokens * r.in + opts.outputTokens * r.out) / 1_000_000;
}

export function flagReviewCards(review: BlindReviewRecord): string[] {
  const flags: string[] = [];
  if (review.acceptedCount === 0) flags.push("zero_insight");
  if (review.modelThreadClassification === "marketing") {
    flags.push("model_classified_marketing");
  }
  for (const c of review.candidateSummaries) {
    const blob = `${c.requestedAction ?? ""} ${c.requesterDisplayName ?? ""} ${c.evidenceExcerpt}`;
    if (VERIFICATION_RE.test(blob) || VERIFICATION_RE.test(c.requesterDisplayName ?? "")) {
      flags.push("verification_or_system_suspect");
    }
    if (COLD_OUTREACH_RE.test(blob)) flags.push("cold_outreach_suspect");
    if (c.dueAt) flags.push("has_due");
    if (c.automatedValidation === "fail") flags.push("auto_validation_fail");
  }
  if (review.rejectionReasons.includes("evidence_not_found")) {
    flags.push("evidence_rejected");
  }
  return [...new Set(flags)];
}

export function buildSideBySide(opts: {
  baselineModel: string;
  challengerModel: string;
  baselineReviews: BlindReviewRecord[];
  challengerReviews: BlindReviewRecord[];
}): SideBySideThread[] {
  const byMasked = new Map(
    opts.challengerReviews.map((r) => [r.threadIdMasked, r]),
  );
  return opts.baselineReviews.map((b) => {
    const c =
      byMasked.get(b.threadIdMasked) ??
      ({
        threadIdMasked: b.threadIdMasked,
        sourceRoute: b.sourceRoute,
        prefilterClassification: b.prefilterClassification,
        modelThreadClassification: "n/a",
        producedCandidateCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        rejectionReasons: ["missing_challenger_result"],
        candidateSummaries: [],
        humanReview: b.humanReview,
        status: "missing",
        errorCode: "missing",
      } satisfies BlindReviewRecord);
    return {
      threadIdMasked: b.threadIdMasked,
      sourceRoute: b.sourceRoute,
      prefilterClassification: b.prefilterClassification,
      baseline: {
        model: opts.baselineModel,
        status: b.status,
        modelClassification: b.modelThreadClassification,
        acceptedCount: b.acceptedCount,
        rejectedCount: b.rejectedCount,
        rejectionReasons: b.rejectionReasons,
        cards: b.candidateSummaries,
        flags: flagReviewCards(b),
      },
      challenger: {
        model: opts.challengerModel,
        status: c.status,
        modelClassification: c.modelThreadClassification,
        acceptedCount: c.acceptedCount,
        rejectedCount: c.rejectedCount,
        rejectionReasons: c.rejectionReasons,
        cards: c.candidateSummaries,
        flags: flagReviewCards(c),
      },
    };
  });
}

export function writeModelComparisonReports(
  report: ModelComparisonReport,
): { jsonPath: string; mdPath: string } {
  const dir = path.resolve(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "o5a4b-gpt5mini-comparison.json");
  const mdPath = path.join(dir, "o5a4b-gpt5mini-comparison.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, renderComparisonMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function renderComparisonMarkdown(report: ModelComparisonReport): string {
  const lines: string[] = [];
  lines.push(`# O5A.4B Model Comparison`);
  lines.push("");
  lines.push(`**Status:** \`${report.status}\``);
  lines.push(`**Selection:** \`${report.selectionSource}\` (${report.threadCount} threads)`);
  lines.push(`**Seed:** ${report.selectionSeed}`);
  lines.push(
    `**Engine hashes match O5A.4:** ${report.engineHashesMatchO5A4 ? "yes" : "NO"}`,
  );
  lines.push(
    `**feed_items unchanged:** ${report.feedItemsUnchanged} (${report.feedItemsBefore} → ${report.feedItemsAfter})`,
  );
  lines.push("");
  lines.push(`## Totals`);
  lines.push("");
  lines.push(`| Metric | ${report.baseline.model} | ${report.challenger.model} | Δ |`);
  lines.push(`|---|---:|---:|---:|`);
  lines.push(
    `| accepted | ${report.baseline.extraction.accepted} | ${report.challenger.extraction.accepted} | ${report.deltas.acceptedDelta} |`,
  );
  lines.push(
    `| candidates | ${report.baseline.extraction.candidates} | ${report.challenger.extraction.candidates} | ${report.deltas.candidatesDelta} |`,
  );
  lines.push(
    `| rejected | ${report.baseline.extraction.rejected} | ${report.challenger.extraction.rejected} | ${report.deltas.rejectedDelta} |`,
  );
  lines.push(
    `| zero-insight | ${report.baseline.extraction.zeroInsightThreads} | ${report.challenger.extraction.zeroInsightThreads} | ${report.deltas.zeroInsightDelta} |`,
  );
  lines.push(
    `| tokens in/out | ${report.baseline.openai.inputTokens}/${report.baseline.openai.outputTokens} | ${report.challenger.openai.inputTokens}/${report.challenger.openai.outputTokens} | |`,
  );
  lines.push(
    `| est. cost USD | ${report.baseline.openai.estimatedCostUsd.toFixed(4)} | ${report.challenger.openai.estimatedCostUsd.toFixed(4)} | |`,
  );
  lines.push(
    `| latency avg ms | ${report.baseline.openai.latencyAvgMs} | ${report.challenger.openai.latencyAvgMs} | |`,
  );
  lines.push(
    `| verification-suspect flags | ${report.deltas.verificationSuspectBaseline} | ${report.deltas.verificationSuspectChallenger} | |`,
  );
  lines.push(
    `| marketing-zero threads | ${report.deltas.marketingZeroBaseline} | ${report.deltas.marketingZeroChallenger} | |`,
  );
  lines.push("");
  lines.push(`## Side-by-side (same thread IDs)`);
  lines.push("");
  for (const row of report.sideBySide) {
    lines.push(`### ${row.threadIdMasked}`);
    lines.push(`- Pre-Filter: ${row.prefilterClassification}`);
    lines.push(`- [פתח מקור](${row.sourceRoute})`);
    lines.push(
      `- **${row.baseline.model}**: status=${row.baseline.status}; class=${row.baseline.modelClassification}; accepted=${row.baseline.acceptedCount}; flags=${row.baseline.flags.join("|") || "—"}`,
    );
    for (const c of row.baseline.cards) {
      lines.push(
        `  - ${c.relationLabel} · ${c.requestedAction ?? "—"} · ${c.requesterDisplayName ?? "?"} → ${c.assigneeDisplayName ?? "?"} · due=${c.dueAt ?? "none"}`,
      );
    }
    lines.push(
      `- **${row.challenger.model}**: status=${row.challenger.status}; class=${row.challenger.modelClassification}; accepted=${row.challenger.acceptedCount}; flags=${row.challenger.flags.join("|") || "—"}`,
    );
    for (const c of row.challenger.cards) {
      lines.push(
        `  - ${c.relationLabel} · ${c.requestedAction ?? "—"} · ${c.requesterDisplayName ?? "?"} → ${c.assigneeDisplayName ?? "?"} · due=${c.dueAt ?? "none"}`,
      );
    }
    lines.push("");
  }
  lines.push(`---`);
  lines.push(report.note);
  lines.push(`\`${report.status}\``);
  return lines.join("\n");
}
