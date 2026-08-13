/**
 * O5A.6.2 — Zero-insight false-negative audit (read-only, no OpenAI).
 * Classifies saved O5A.6 outcomes + heuristic text signals only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const O5A62_EVAL_VERSION = "o5a6.2_zero_insight_audit";
export const O5A62_LABELS_FILE = "tmp/o5a62-human-labels.json";
export const O5A62_AUDIT_JSON = "tmp/o5a62-zero-insight-audit.json";
export const O5A62_AUDIT_MD = "tmp/o5a62-zero-insight-audit.md";
export const O5A6_REVIEW_REPORT = "tmp/o5a6-real-inbox-review.json";

export type HumanReviewLabel =
  | "correct_absent"
  | "missing_action"
  | "missing_decision"
  | "missing_change"
  | "missing_due"
  | "missing_alert"
  | "unclear";

export const HUMAN_LABEL_OPTIONS: Array<{
  id: HumanReviewLabel;
  he: string;
}> = [
  { id: "correct_absent", he: "נכון שלא יופיע בפיד" },
  { id: "missing_action", he: "חסרה פעולה" },
  { id: "missing_decision", he: "חסרה החלטה" },
  { id: "missing_change", he: "חסר שינוי" },
  { id: "missing_due", he: "חסר מועד" },
  { id: "missing_alert", he: "חסרה התראה" },
  { id: "unclear", he: "לא ברור" },
];

export type AuditStopReason =
  | "model_returned_no_candidates"
  | "classified_non_business"
  | "speech_act_not_actionable"
  | "already_sent"
  | "evidence_rejected"
  | "safety_suppressed"
  | "identity_or_direction_failed"
  | "below_confidence"
  | "schema_or_incomplete"
  | "other";

export type FilterStage =
  | "model"
  | "schema"
  | "validator"
  | "safety"
  | "evidence"
  | "unknown";

export type TextSignalId =
  | "response_request"
  | "approval_or_review_request"
  | "participant_commitment"
  | "reported_decision"
  | "state_change"
  | "deadline_or_due"
  | "delay_fault_or_exception"
  | "new_business_document_or_version";

export type TypeCoverageFlags = {
  actionCandidate: boolean | null;
  decisionCandidate: boolean | null;
  changeCandidate: boolean | null;
  dueCandidate: boolean | null;
  alertCandidate: boolean | null;
  /** True when a candidate existed but its type was not persisted in the pilot report. */
  unknownCandidateTypePersisted: boolean;
  textSignalsSuggestAction: boolean;
  textSignalsSuggestDecision: boolean;
  textSignalsSuggestChange: boolean;
  textSignalsSuggestDue: boolean;
  textSignalsSuggestAlert: boolean;
};

const RESPONSE_REQUEST =
  /נא\s+התייחסותך|מה\s+(?:דע|אומר|חושב)|(?:איך|האם|מה)\s+(?:אתה|את|אתם|אתן)(?=\s|$|[.,!?])|how\s+(?:should|do)\s+(?:we|I|you)|can\s+you\s+(?:please\s+)?(?:confirm|approve|check|tell)|what\s+do\s+you\s+think|אשמח\s+(?:לתשובה|להתייחסות|לשמוע)/i;

const APPROVAL_OR_REVIEW =
  /לאישור(?:ך|כם)|לבדיקת(?:ך|כם)|לעיונ(?:ך|כם)|נא\s+לאשר|נא\s+לבדוק|מצ["״']?ב[\s\S]{0,80}לאישור|for your (?:approval|review)|please\s+(?:approve|review|check)/i;

const COMMITMENT =
  /(?:אני\s+)?(?:אשלח|אטפל|אאשר|אבדוק)|(?:אנחנו\s+)?נשלח|I(?:'|’)ll |I will |we will /i;

const REPORTED_DECISION =
  /(?:^|[\s])(?:אישר(?:תי|נו|ה|ו)?|אושרה?|דחה|נדחתה|החליט(?:נו|ה|ו)?)\s/i;

const STATE_CHANGE =
  /השתנה מ-|changed from|עלה ל-|ירד ל-|עודכן ל-|הסטטוס\s+(?:השתנה|עודכן)|version\s+\d|גרסה\s+\d/i;

const DEADLINE =
  /עד\s+(?:יום|ה-|סוף)|deadline|due\s+(?:date|by)|בתוך\s+\d+\s*(?:ימים|שעות)|לא יאוחר מ|by\s+(?:EOD|Friday|Monday|\d)/i;

const DELAY_FAULT =
  /עיכוב|תקלה|חריגה תפעולית|operational\s+exception|service\s+disruption|payment\s+failed|invoice\s+overdue|blocked\s+on|project\s+delayed|delay(?:ed|ing)?\s+(?:the|our|your)/i;

const NEW_DOC =
  /(?:מצ["״']?ב|מצורף|attached|גרסה חדשה|rev(?:ision)?\s*\d|DWG|PDF|shop\s*drawing|סככה|תוכנית(?:יות)?)\b/i;

const EXPLICIT_ACTION =
  /(?:נא|בבקשה|please)\s+(?:לשלוח|לאשר|להגיש|לבדוק|לעדכן|להשיב|send|approve|submit|check|update|reply)|חסר\s+\S{2,}/i;

const LEGAL_ALERT =
  /copyright infringement|dmca|cease(?:\s+and\s+desist)?|זכויות יוצרים|דרישה משפטית|מכתב התראה/i;

export type O5a6ThreadRow = {
  threadId: string;
  threadIdMasked?: string;
  outcome: string;
  prefilterClassification?: string | null;
  modelThreadClassification?: string | null;
  openaiCalled?: boolean;
  gateOk?: boolean | null;
  gateReason?: string | null;
  rawCandidateCount?: number | null;
  acceptedCount?: number | null;
  rejectedCount?: number | null;
  inserted?: number | null;
  rejectionReasons?: string[] | null;
  cards?: Array<Record<string, unknown>> | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  sourceRoute?: string | null;
  phase?: string | null;
};

export type ThreadTextBundle = {
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  toNames: string[];
  lastMessageAt: string | null;
  currentMessageClean: string;
  direction: "inbound" | "outbound" | null;
};

export function detectTextSignals(text: string): TextSignalId[] {
  const blob = text;
  const out: TextSignalId[] = [];
  if (RESPONSE_REQUEST.test(blob)) out.push("response_request");
  if (APPROVAL_OR_REVIEW.test(blob)) out.push("approval_or_review_request");
  if (COMMITMENT.test(blob)) out.push("participant_commitment");
  if (REPORTED_DECISION.test(blob)) out.push("reported_decision");
  if (STATE_CHANGE.test(blob)) out.push("state_change");
  if (DEADLINE.test(blob)) out.push("deadline_or_due");
  if (DELAY_FAULT.test(blob)) out.push("delay_fault_or_exception");
  if (NEW_DOC.test(blob)) out.push("new_business_document_or_version");
  return out;
}

export function classifyStopReason(row: O5a6ThreadRow): {
  reason: AuditStopReason;
  stage: FilterStage;
  detail: string;
} {
  const gateOk = row.gateOk;
  const gateReason = row.gateReason ?? null;
  const raw = Number(row.rawCandidateCount ?? 0);
  const rejections = Array.isArray(row.rejectionReasons)
    ? row.rejectionReasons
    : [];

  if (gateOk === false && gateReason === "thread_not_business") {
    return {
      reason: "classified_non_business",
      stage: "model",
      detail: `modelThreadClassification=${row.modelThreadClassification ?? "unknown"}`,
    };
  }
  if (gateOk === false && gateReason === "disposition_suppress") {
    return {
      reason: "safety_suppressed",
      stage: "safety",
      detail: "gate disposition_suppress",
    };
  }
  if (gateOk === false && gateReason) {
    return {
      reason: "other",
      stage: "validator",
      detail: `gateReason=${gateReason}`,
    };
  }

  if (raw === 0 && rejections.length === 0) {
    return {
      reason: "model_returned_no_candidates",
      stage: "model",
      detail: "gateOk; rawCandidateCount=0",
    };
  }

  const primary = rejections[0] ?? null;
  if (!primary) {
    return {
      reason: "other",
      stage: "unknown",
      detail: `raw=${raw}; no rejection reasons recorded`,
    };
  }

  if (
    primary === "already_sent" ||
    primary === "already_sent_not_action"
  ) {
    return {
      reason: "already_sent",
      stage: "safety",
      detail: primary,
    };
  }
  if (primary === "disposition_suppress") {
    return {
      reason: "safety_suppressed",
      stage: "safety",
      detail: primary,
    };
  }
  if (
    primary === "evidence_not_found" ||
    primary === "due_evidence_not_found" ||
    primary === "request_evidence_missing" ||
    primary === "request_evidence_greeting" ||
    primary === "request_evidence_semantic_mismatch"
  ) {
    return {
      reason: "evidence_rejected",
      stage: "evidence",
      detail: primary,
    };
  }
  if (
    primary === "confidence_low" ||
    primary === "business_relevance_low" ||
    primary === "semantic_precision_low" ||
    primary === "attribution_confidence_low"
  ) {
    return {
      reason: "below_confidence",
      stage: "validator",
      detail: primary,
    };
  }
  if (primary === "speech_act_not_actionable") {
    return {
      reason: "speech_act_not_actionable",
      stage: "validator",
      detail: primary,
    };
  }
  if (
    primary.includes("requester") ||
    primary.includes("assignee") ||
    primary.includes("actor_email") ||
    primary.includes("direction") ||
    primary.includes("relation") ||
    primary === "action_unknown_responsibility"
  ) {
    return {
      reason: "identity_or_direction_failed",
      stage: "validator",
      detail: primary,
    };
  }
  if (
    primary.includes("schema") ||
    primary === "openai_incomplete" ||
    primary === "openai_unparsed"
  ) {
    return {
      reason: "schema_or_incomplete",
      stage: "schema",
      detail: primary,
    };
  }
  if (
    primary === "verification_solicitation" ||
    primary === "cold_outreach" ||
    primary === "marketing_cta" ||
    primary === "legal_consolidated_to_alert"
  ) {
    return {
      reason: "safety_suppressed",
      stage: "safety",
      detail: primary,
    };
  }

  return {
    reason: "other",
    stage: "validator",
    detail: primary,
  };
}

export function buildTypeCoverage(opts: {
  row: O5a6ThreadRow;
  text: string;
}): TypeCoverageFlags {
  const signals = detectTextSignals(opts.text);
  const cards = Array.isArray(opts.row.cards) ? opts.row.cards : [];
  const types = new Set(
    cards.map((c) => String(c.type ?? "")).filter(Boolean),
  );
  const raw = Number(opts.row.rawCandidateCount ?? 0);
  const accepted = Number(opts.row.acceptedCount ?? 0);
  const unknownCandidateTypePersisted =
    raw > 0 && accepted === 0 && types.size === 0;

  const fromSaved = (t: string) => (types.has(t) ? true : null);

  return {
    actionCandidate:
      types.has("action") || accepted > 0
        ? types.has("action") || null
        : unknownCandidateTypePersisted
          ? null
          : false,
    decisionCandidate: fromSaved("decision") ?? false,
    changeCandidate: fromSaved("change") ?? false,
    dueCandidate: fromSaved("due") ?? false,
    alertCandidate: fromSaved("alert") ?? false,
    unknownCandidateTypePersisted,
    textSignalsSuggestAction:
      signals.includes("response_request") ||
      signals.includes("approval_or_review_request") ||
      EXPLICIT_ACTION.test(opts.text),
    textSignalsSuggestDecision: signals.includes("reported_decision"),
    textSignalsSuggestChange: signals.includes("state_change"),
    textSignalsSuggestDue: signals.includes("deadline_or_due"),
    textSignalsSuggestAlert:
      signals.includes("delay_fault_or_exception") ||
      LEGAL_ALERT.test(opts.text),
  };
}

export function loadO5a6Report(cwd = process.cwd()): {
  perThread: O5a6ThreadRow[];
  persistedCards: Array<Record<string, unknown>>;
  extraction: Record<string, unknown>;
  openai: Record<string, unknown>;
  status: string;
} {
  const p = path.resolve(cwd, O5A6_REVIEW_REPORT);
  if (!existsSync(p)) {
    throw new Error(`missing_${O5A6_REVIEW_REPORT}`);
  }
  const raw = JSON.parse(readFileSync(p, "utf8")) as {
    perThread: O5a6ThreadRow[];
    persistedCards?: Array<Record<string, unknown>>;
    extraction?: Record<string, unknown>;
    openai?: Record<string, unknown>;
    status?: string;
  };
  return {
    perThread: raw.perThread ?? [],
    persistedCards: raw.persistedCards ?? [],
    extraction: raw.extraction ?? {},
    openai: raw.openai ?? {},
    status: raw.status ?? "",
  };
}

export function selectZeroInsightThreads(
  perThread: O5a6ThreadRow[],
): O5a6ThreadRow[] {
  return perThread.filter((t) => t.outcome === "completed_zero_insight");
}

export function selectFailedTimeoutThread(
  perThread: O5a6ThreadRow[],
): O5a6ThreadRow | null {
  return (
    perThread.find(
      (t) => t.outcome === "failed" && t.errorCode === "openai_timeout",
    ) ?? null
  );
}

export function loadHumanLabels(cwd = process.cwd()): {
  evaluationVersion: string;
  updatedAt: string | null;
  labels: Record<
    string,
    { label: HumanReviewLabel; updatedAt: string; note?: string }
  >;
} {
  const p = path.resolve(cwd, O5A62_LABELS_FILE);
  if (!existsSync(p)) {
    return {
      evaluationVersion: O5A62_EVAL_VERSION,
      updatedAt: null,
      labels: {},
    };
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveHumanLabel(opts: {
  threadId: string;
  label: HumanReviewLabel;
  note?: string;
  cwd?: string;
}) {
  const cwd = opts.cwd ?? process.cwd();
  const current = loadHumanLabels(cwd);
  const now = new Date().toISOString();
  current.evaluationVersion = O5A62_EVAL_VERSION;
  current.updatedAt = now;
  current.labels[opts.threadId] = {
    label: opts.label,
    updatedAt: now,
    ...(opts.note ? { note: opts.note } : {}),
  };
  const p = path.resolve(cwd, O5A62_LABELS_FILE);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(current, null, 2), "utf8");
  return current;
}

export type ZeroInsightAuditCard = {
  threadId: string;
  threadIdMasked: string;
  outcome: string;
  sourceRoute: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  toNames: string[];
  lastMessageAt: string | null;
  currentMessageClean: string;
  direction: "inbound" | "outbound" | null;
  prefilterClassification: string | null;
  modelThreadClassification: string | null;
  gateOk: boolean | null;
  gateReason: string | null;
  rawCandidateCount: number;
  candidatesNote: string;
  rejectionReasons: string[];
  stopReason: AuditStopReason;
  filterStage: FilterStage;
  stopDetail: string;
  textSignals: TextSignalId[];
  typeCoverage: TypeCoverageFlags;
  possibleFalseNegative: boolean;
  suggestedMissingInsightType: HumanReviewLabel | "none";
  humanLabel: HumanReviewLabel | null;
};

export function auditZeroInsightCard(opts: {
  row: O5a6ThreadRow;
  text: ThreadTextBundle;
  humanLabel?: HumanReviewLabel | null;
}): ZeroInsightAuditCard {
  const stop = classifyStopReason(opts.row);
  const blob = [
    opts.text.subject ?? "",
    opts.text.currentMessageClean,
  ].join("\n");
  const textSignals = detectTextSignals(blob);
  const typeCoverage = buildTypeCoverage({ row: opts.row, text: blob });
  const raw = Number(opts.row.rawCandidateCount ?? 0);

  const actionableSignal =
    textSignals.includes("approval_or_review_request") ||
    textSignals.includes("participant_commitment") ||
    textSignals.includes("reported_decision") ||
    textSignals.includes("state_change") ||
    textSignals.includes("deadline_or_due") ||
    textSignals.includes("response_request") ||
    EXPLICIT_ACTION.test(blob);

  const modelClass = String(opts.row.modelThreadClassification ?? "");
  const marketingOrSystem =
    modelClass === "marketing" || modelClass === "system";
  const strongBusinessAsk =
    textSignals.includes("approval_or_review_request") ||
    EXPLICIT_ACTION.test(blob) ||
    textSignals.includes("reported_decision") ||
    textSignals.includes("deadline_or_due");

  const possibleFalseNegative =
    actionableSignal &&
    !(marketingOrSystem && !strongBusinessAsk) &&
    (stop.reason === "model_returned_no_candidates" ||
      stop.reason === "evidence_rejected" ||
      stop.reason === "below_confidence" ||
      stop.reason === "speech_act_not_actionable" ||
      stop.reason === "safety_suppressed" ||
      (stop.reason === "classified_non_business" && strongBusinessAsk));

  let suggestedMissingInsightType: HumanReviewLabel | "none" = "none";
  if (possibleFalseNegative) {
    if (textSignals.includes("deadline_or_due")) {
      suggestedMissingInsightType = "missing_due";
    } else if (textSignals.includes("reported_decision")) {
      suggestedMissingInsightType = "missing_decision";
    } else if (textSignals.includes("state_change")) {
      suggestedMissingInsightType = "missing_change";
    } else if (
      textSignals.includes("delay_fault_or_exception") ||
      LEGAL_ALERT.test(blob)
    ) {
      suggestedMissingInsightType = "missing_alert";
    } else {
      suggestedMissingInsightType = "missing_action";
    }
  }

  return {
    threadId: opts.row.threadId,
    threadIdMasked:
      opts.row.threadIdMasked ??
      `${opts.row.threadId.slice(0, 8)}…${opts.row.threadId.slice(-4)}`,
    outcome: opts.row.outcome,
    sourceRoute:
      opts.row.sourceRoute ?? `/inbox?threadId=${opts.row.threadId}`,
    subject: opts.text.subject,
    fromEmail: opts.text.fromEmail,
    fromName: opts.text.fromName,
    toEmails: opts.text.toEmails,
    toNames: opts.text.toNames,
    lastMessageAt: opts.text.lastMessageAt,
    currentMessageClean: opts.text.currentMessageClean,
    direction: opts.text.direction,
    prefilterClassification: opts.row.prefilterClassification ?? null,
    modelThreadClassification: opts.row.modelThreadClassification ?? null,
    gateOk: opts.row.gateOk ?? null,
    gateReason: opts.row.gateReason ?? null,
    rawCandidateCount: raw,
    candidatesNote:
      raw === 0
        ? "המודל לא החזיר candidates (או gate רוקן אותם)."
        : "Candidate payloads לא נשמרו בדוח הפיילוט — נשמרו רק count ו־rejection reason.",
    rejectionReasons: Array.isArray(opts.row.rejectionReasons)
      ? opts.row.rejectionReasons
      : [],
    stopReason: stop.reason,
    filterStage: stop.stage,
    stopDetail: stop.detail,
    textSignals,
    typeCoverage,
    possibleFalseNegative,
    suggestedMissingInsightType,
    humanLabel: opts.humanLabel ?? null,
  };
}

export function summarizeAudit(cards: ZeroInsightAuditCard[]) {
  const byStopReason: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  const byRejection: Record<string, number> = {};
  for (const c of cards) {
    byStopReason[c.stopReason] = (byStopReason[c.stopReason] ?? 0) + 1;
    byStage[c.filterStage] = (byStage[c.filterStage] ?? 0) + 1;
    if (c.rejectionReasons.length === 0) {
      byRejection["(none)"] = (byRejection["(none)"] ?? 0) + 1;
    } else {
      for (const r of c.rejectionReasons) {
        byRejection[r] = (byRejection[r] ?? 0) + 1;
      }
    }
  }
  const modelStopped = cards.filter((c) => c.filterStage === "model").length;
  const validatorStopped = cards.filter((c) =>
    ["validator", "evidence", "safety"].includes(c.filterStage),
  ).length;
  const possibleFns = cards.filter((c) => c.possibleFalseNegative);
  return {
    byStopReason,
    byStage,
    byRejection,
    modelStopped,
    validatorStopped,
    possibleFalseNegatives: possibleFns.length,
    possibleFnThreadIds: possibleFns.map((c) => c.threadId),
  };
}

export function formatAuditMarkdown(report: {
  status: string;
  zeroCount: number;
  summary: ReturnType<typeof summarizeAudit>;
  cards: ZeroInsightAuditCard[];
  failedTimeout: Record<string, unknown> | null;
  coverage: Array<Record<string, unknown>>;
  actionBias: Record<string, unknown>;
  recommendations: string[];
}): string {
  const md: string[] = [];
  md.push("# O5A.6.2 — Zero-Insight False-Negative Audit");
  md.push("");
  md.push(`Status: **${report.status}**`);
  md.push("");
  md.push("Read-only. No OpenAI. No feed_items writes. No engine changes.");
  md.push("");
  md.push("## Distribution (20 zero insights)");
  md.push("");
  md.push(`- model-stopped: ${report.summary.modelStopped}`);
  md.push(`- validator/safety/evidence-stopped: ${report.summary.validatorStopped}`);
  md.push(`- possible false negatives (heuristic): ${report.summary.possibleFalseNegatives}`);
  md.push("");
  md.push("### By stop reason");
  md.push("");
  for (const [k, v] of Object.entries(report.summary.byStopReason).sort()) {
    md.push(`- \`${k}\`: ${v}`);
  }
  md.push("");
  md.push("### By rejection reason (saved)");
  md.push("");
  for (const [k, v] of Object.entries(report.summary.byRejection).sort()) {
    md.push(`- \`${k}\`: ${v}`);
  }
  md.push("");
  md.push("### By filter stage");
  md.push("");
  for (const [k, v] of Object.entries(report.summary.byStage).sort()) {
    md.push(`- \`${k}\`: ${v}`);
  }
  md.push("");
  md.push("## Possible false negatives");
  md.push("");
  const fns = report.cards.filter((c) => c.possibleFalseNegative);
  if (!fns.length) {
    md.push("_None flagged by text-signal heuristic._");
  } else {
    for (const c of fns) {
      md.push(`### ${c.threadIdMasked}`);
      md.push(`- subject: ${c.subject ?? "—"}`);
      md.push(`- stop: \`${c.stopReason}\` @ \`${c.filterStage}\` (${c.stopDetail})`);
      md.push(`- suggested missing: \`${c.suggestedMissingInsightType}\``);
      md.push(`- textSignals: ${c.textSignals.join(", ") || "—"}`);
      md.push(`- source: ${c.sourceRoute}`);
      md.push("");
    }
  }
  md.push("## Action bias");
  md.push("");
  md.push(`- persisted byType: ${JSON.stringify(report.actionBias.persistedByType)}`);
  md.push(
    `- threads with saved non-action candidates: ${report.actionBias.threadsWithSavedNonActionCandidates}`,
  );
  md.push(
    `- text-signal threads suggesting non-action types among zeros: ${report.actionBias.zeroThreadsWithNonActionTextSignals}`,
  );
  md.push(`- assessment: ${report.actionBias.assessment}`);
  md.push("");
  md.push("## Failed timeout (separate)");
  md.push("");
  if (!report.failedTimeout) {
    md.push("_No failed timeout thread._");
  } else {
    md.push(`- thread: \`${report.failedTimeout.threadId}\``);
    md.push(`- error: \`${report.failedTimeout.errorCode}\``);
    md.push(`- latencyMs: ${report.failedTimeout.latencyMs}`);
    md.push(`- note: ${report.failedTimeout.note}`);
  }
  md.push("");
  md.push("## Recommendations (general only)");
  md.push("");
  for (const r of report.recommendations) md.push(`- ${r}`);
  md.push("");
  md.push("## Per zero-insight thread");
  md.push("");
  for (const c of report.cards) {
    md.push(`### ${c.threadIdMasked}`);
    md.push(`- subject: ${c.subject ?? "—"}`);
    md.push(
      `- from: ${c.fromName ?? "—"} <${c.fromEmail ?? "—"}> → ${(c.toEmails ?? []).join(", ") || "—"}`,
    );
    md.push(`- prefilter: ${c.prefilterClassification}; model: ${c.modelThreadClassification}`);
    md.push(`- stop: \`${c.stopReason}\` / stage \`${c.filterStage}\``);
    md.push(`- rawCandidates: ${c.rawCandidateCount}; rejections: ${c.rejectionReasons.join(", ") || "—"}`);
    md.push(`- textSignals: ${c.textSignals.join(", ") || "—"}`);
    md.push(`- possibleFN: ${c.possibleFalseNegative}`);
    md.push(`- source: ${c.sourceRoute}`);
    md.push("");
  }
  md.push("**AWAITING HUMAN LABELING OF O5A.6 ZERO-INSIGHT THREADS**");
  md.push("");
  return md.join("\n");
}
