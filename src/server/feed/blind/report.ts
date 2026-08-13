import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EngineHashSnapshot } from "./engine-hash";
import type { BlindSelectionResult } from "./selection";
import type { CandidateQualitySummary } from "./quality";
import type { BlindAutomatedQualityTotals } from "./quality";

export type BlindReviewRecord = {
  threadIdMasked: string;
  sourceRoute: string;
  prefilterClassification: string;
  modelThreadClassification: string;
  producedCandidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectionReasons: string[];
  candidateSummaries: Array<{
    type: string;
    relationLabel: string;
    requestedAction: string | null;
    requesterDisplayName: string | null;
    assigneeDisplayName: string | null;
    requestedAt: string | null;
    dueAt: string | null;
    evidenceExcerpt: string;
    automatedValidation: "pass" | "fail";
  }>;
  humanReview: {
    businessRelevant: "pending";
    missingImportantItem: "pending";
    requesterCorrect: "pending";
    assigneeCorrect: "pending";
    meaningExact: "pending";
    dueDateCorrect: "pending";
    usefulInFeed: "pending";
  };
  status: string;
  errorCode: string | null;
};

export type BlindEvaluationReport = {
  evaluationVersion: string;
  selectionSeed: string;
  status: "AWAITING HUMAN REVIEW" | "INSUFFICIENT OUTPUT SAMPLE";
  gitCommitSha: string;
  model: string;
  actualModel: string | null;
  engineHashesBefore: EngineHashSnapshot;
  engineHashesAfter: EngineHashSnapshot;
  engineHashesUnchanged: boolean;
  selection: BlindSelectionResult & {
    mailAccountIdMasked: string;
  };
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
    byType: { action: number; change: number; decision: number; alert?: number };
  };
  automatedQuality: BlindAutomatedQualityTotals;
  safety: {
    feedItemsBefore: number;
    feedItemsAfter: number;
    feedItemsUnchanged: boolean;
    statusTransitions: number;
    supersededBefore: number;
    supersededAfter: number;
    supersededUnchanged: boolean;
    replacement: false;
    o5b: false;
    onyxChat: false;
  };
  reviews: BlindReviewRecord[];
  timestamp: string;
};

/** gpt-4o-mini list prices (approx USD / 1M tokens). */
export function estimateGpt4oMiniCost(opts: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return (opts.inputTokens * 0.15 + opts.outputTokens * 0.6) / 1_000_000;
}

export function writeBlindManifest(opts: {
  evaluationVersion: string;
  selectionSeed: string;
  selected: Array<{
    threadId: string;
    selectionHash: string;
    prefilterClassification: string;
  }>;
  engineHashes: EngineHashSnapshot;
  mailAccountIdMasked: string;
  gitCommitSha: string;
  model: string;
}): string {
  const dir = path.resolve(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "o5a4-blind-selection.json");
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...opts,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return file;
}

export function writeBlindReports(report: BlindEvaluationReport): {
  jsonPath: string;
  mdPath: string;
} {
  const dir = path.resolve(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "o5a4-blind-evaluation-report.json");
  const mdPath = path.join(dir, "o5a4-blind-evaluation-report.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdPath, renderBlindMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

export function buildReviewRecord(opts: {
  threadId: string;
  threadIdMasked: string;
  prefilterClassification: string;
  modelThreadClassification: string | null;
  status: string;
  errorCode: string | null;
  rawCandidateCount: number;
  acceptedSummaries: CandidateQualitySummary[];
  rejectionReasons: string[];
}): BlindReviewRecord {
  return {
    threadIdMasked: opts.threadIdMasked,
    sourceRoute: `/inbox?threadId=${opts.threadId}`,
    prefilterClassification: opts.prefilterClassification,
    modelThreadClassification: opts.modelThreadClassification ?? "n/a",
    producedCandidateCount: opts.rawCandidateCount,
    acceptedCount: opts.acceptedSummaries.length,
    rejectedCount: opts.rejectionReasons.length,
    rejectionReasons: opts.rejectionReasons,
    candidateSummaries: opts.acceptedSummaries.map((s) => ({
      type: s.type,
      relationLabel: s.relationLabel,
      requestedAction: s.requestedAction,
      requesterDisplayName: s.requesterDisplayName,
      assigneeDisplayName: s.assigneeDisplayName,
      requestedAt: s.requestedAt,
      dueAt: s.dueAt,
      evidenceExcerpt: s.evidenceExcerpt,
      automatedValidation: s.automatedValidation,
    })),
    humanReview: {
      businessRelevant: "pending",
      missingImportantItem: "pending",
      requesterCorrect: "pending",
      assigneeCorrect: "pending",
      meaningExact: "pending",
      dueDateCorrect: "pending",
      usefulInFeed: "pending",
    },
    status: opts.status,
    errorCode: opts.errorCode,
  };
}

function renderBlindMarkdown(report: BlindEvaluationReport): string {
  const lines: string[] = [];
  lines.push(`# O5A.4 Blind Evaluation Report`);
  lines.push("");
  lines.push(`**Status:** \`${report.status}\``);
  lines.push(`**evaluationVersion:** ${report.evaluationVersion}`);
  lines.push(`**selectionSeed:** ${report.selectionSeed}`);
  lines.push(`**git:** \`${report.gitCommitSha}\``);
  lines.push(
    `**model:** ${report.model} (actual: ${report.actualModel ?? "n/a"})`,
  );
  lines.push(
    `**engine hashes unchanged:** ${report.engineHashesUnchanged ? "yes" : "NO"}`,
  );
  lines.push("");
  lines.push(`## Selection`);
  lines.push(`- scanned: ${report.selection.scanned}`);
  lines.push(
    `- previously seen removed: ${report.selection.previouslySeenRemoved}`,
  );
  lines.push(`- golden excluded: ${report.selection.goldenExcluded}`);
  lines.push(
    `- prefilter: ${JSON.stringify(report.selection.prefilterCounts)}`,
  );
  lines.push(`- eligible unseen: ${report.selection.eligibleUnseen}`);
  lines.push(`- selected: ${report.selection.selected.length}`);
  lines.push(
    `- sample < cap: ${report.selection.sampleSmallerThanCap ? "yes" : "no"}`,
  );
  lines.push("");
  lines.push(`## OpenAI`);
  lines.push(`- probe: ${report.openai.probeCount}`);
  lines.push(
    `- attempts: ${report.openai.extractionAttempts} (ok ${report.openai.successes} / fail ${report.openai.failures})`,
  );
  lines.push(`- circuit: ${report.openai.circuitBreaker}`);
  lines.push(
    `- tokens in/out/total: ${report.openai.inputTokens}/${report.openai.outputTokens}/${report.openai.totalTokens}`,
  );
  lines.push(
    `- est. cost: $${report.openai.estimatedCostUsd.toFixed(4)}`,
  );
  lines.push(
    `- latency total/avg/min/max ms: ${report.openai.latencyTotalMs}/${report.openai.latencyAvgMs}/${report.openai.latencyMinMs}/${report.openai.latencyMaxMs}`,
  );
  lines.push("");
  lines.push(`## Safety`);
  lines.push(
    `- feed_items ${report.safety.feedItemsBefore} → ${report.safety.feedItemsAfter} (unchanged: ${report.safety.feedItemsUnchanged})`,
  );
  lines.push(
    `- superseded ${report.safety.supersededBefore} → ${report.safety.supersededAfter}`,
  );
  lines.push(`- O5B/Onyx/replacement: false`);
  lines.push("");
  lines.push(`## Automated quality`);
  lines.push("```json");
  lines.push(JSON.stringify(report.automatedQuality, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`## Review Records`);
  lines.push("");

  for (const r of report.reviews) {
    lines.push(`### ${r.threadIdMasked}`);
    lines.push(`- Pre-Filter: ${r.prefilterClassification}`);
    lines.push(`- Model classification: ${r.modelThreadClassification}`);
    lines.push(`- Status: ${r.status}${r.errorCode ? ` (${r.errorCode})` : ""}`);
    lines.push(
      `- Cards: produced=${r.producedCandidateCount} accepted=${r.acceptedCount} rejected=${r.rejectedCount}`,
    );
    if (r.rejectionReasons.length) {
      lines.push(`- Rejection reasons: ${r.rejectionReasons.join(", ")}`);
    }
    if (r.acceptedCount === 0) {
      lines.push(
        `- **Zero cards** — check for false negative. [פתח מקור](${r.sourceRoute})`,
      );
    }
    for (const c of r.candidateSummaries) {
      lines.push(
        `- **${c.relationLabel}** (${c.type}) · auto=${c.automatedValidation}`,
      );
      lines.push(`  - action: ${c.requestedAction ?? "—"}`);
      lines.push(
        `  - ${c.requesterDisplayName ?? "?"} → ${c.assigneeDisplayName ?? "?"}`,
      );
      lines.push(`  - requestedAt: ${c.requestedAt ?? "—"}`);
      lines.push(
        `  - dueAt: ${c.dueAt ?? "ללא מועד מפורש"}`,
      );
      lines.push(`  - evidence: ${c.evidenceExcerpt}`);
    }
    lines.push(`- Human review: all fields pending`);
    lines.push(`- [פתח מקור](${r.sourceRoute})`);
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`\`${report.status}\` — do not start O5B without explicit approval.`);
  return lines.join("\n");
}
