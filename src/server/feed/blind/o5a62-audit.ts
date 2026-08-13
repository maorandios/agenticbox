/**
 * O5A.6.2 — load thread text + assemble review/audit payloads (no OpenAI).
 */
import "server-only";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanFeedMessageBody } from "@/server/feed/clean-content";
import {
  auditZeroInsightCard,
  formatAuditMarkdown,
  loadHumanLabels,
  loadO5a6Report,
  selectFailedTimeoutThread,
  selectZeroInsightThreads,
  summarizeAudit,
  type O5a6ThreadRow,
  type ThreadTextBundle,
  type ZeroInsightAuditCard,
  O5A62_AUDIT_JSON,
  O5A62_AUDIT_MD,
  O5A62_EVAL_VERSION,
} from "./o5a62-audit-core";

const USER_ID = "7b897ada-7b9d-4730-b662-028830e55259";

export async function loadThreadTextBundle(
  threadId: string,
): Promise<ThreadTextBundle> {
  const sb = createAdminClient();
  const { data: messages, error } = await sb
    .from("messages")
    .select(
      "id,subject,plain_text,clean_conversation,direction,provider_date_at",
    )
    .eq("user_id", USER_ID)
    .eq("thread_id", threadId)
    .order("provider_date_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw new Error(`o5a62_messages_failed:${error.message}`);
  const rows = messages ?? [];
  const last = rows.at(-1);
  if (!last) {
    return {
      subject: null,
      fromEmail: null,
      fromName: null,
      toEmails: [],
      toNames: [],
      lastMessageAt: null,
      currentMessageClean: "",
      direction: null,
    };
  }

  const { data: parts } = await sb
    .from("message_participants")
    .select("role,email,name")
    .eq("user_id", USER_ID)
    .eq("message_id", last.id as string);

  const fromPart = (parts ?? []).find((p) => p.role === "from");
  const toParts = (parts ?? []).filter(
    (p) => p.role === "to" || p.role === "cc",
  );
  const raw =
    String(last.clean_conversation ?? "").trim() ||
    String(last.plain_text ?? "").trim();
  const cleaned = cleanFeedMessageBody(raw).cleanText;

  return {
    subject: (last.subject as string | null) ?? null,
    fromEmail: (fromPart?.email as string | null) ?? null,
    fromName: (fromPart?.name as string | null) ?? null,
    toEmails: toParts.map((p) => String(p.email ?? "")).filter(Boolean),
    toNames: toParts
      .map((p) => String(p.name ?? "").trim())
      .filter(Boolean),
    lastMessageAt: (last.provider_date_at as string | null) ?? null,
    currentMessageClean: cleaned,
    direction: last.direction === "outbound" ? "outbound" : "inbound",
  };
}

export async function buildO5a62AuditPayload(cwd = process.cwd()) {
  const report = loadO5a6Report(cwd);
  const zeros = selectZeroInsightThreads(report.perThread);
  const failed = selectFailedTimeoutThread(report.perThread);
  const labels = loadHumanLabels(cwd);

  if (zeros.length !== 20) {
    throw new Error(`expected_20_zero_insights_got_${zeros.length}`);
  }

  const cards: ZeroInsightAuditCard[] = [];
  for (const row of zeros) {
    const text = await loadThreadTextBundle(row.threadId);
    cards.push(
      auditZeroInsightCard({
        row,
        text,
        humanLabel: labels.labels[row.threadId]?.label ?? null,
      }),
    );
  }

  const coverage: Array<Record<string, unknown>> = [];
  for (const row of report.perThread) {
    const text = await loadThreadTextBundle(row.threadId);
    const card = auditZeroInsightCard({ row, text });
    const persistedTypes = (Array.isArray(row.cards) ? row.cards : [])
      .map((c) => String(c.type ?? ""))
      .filter(Boolean);
    coverage.push({
      threadId: row.threadId,
      threadIdMasked: card.threadIdMasked,
      outcome: row.outcome,
      savedCandidateTypes: persistedTypes,
      rawCandidateCount: Number(row.rawCandidateCount ?? 0),
      typeCoverage: card.typeCoverage,
      textSignals: card.textSignals,
    });
  }

  const summary = summarizeAudit(cards);
  const persistedByType = { action: 0, change: 0, decision: 0, alert: 0, due: 0 };
  for (const c of report.persistedCards) {
    const t = String(c.type ?? "");
    if (t in persistedByType) {
      persistedByType[t as keyof typeof persistedByType] += 1;
    }
  }

  const zeroWithNonActionText = cards.filter(
    (c) =>
      c.typeCoverage.textSignalsSuggestDecision ||
      c.typeCoverage.textSignalsSuggestChange ||
      c.typeCoverage.textSignalsSuggestDue ||
      c.typeCoverage.textSignalsSuggestAlert,
  ).length;

  const threadsWithSavedNonAction = coverage.filter((c) =>
    (c.savedCandidateTypes as string[]).some((t) => t !== "action"),
  ).length;

  const actionBias = {
    persistedByType,
    threadsWithSavedNonActionCandidates: threadsWithSavedNonAction,
    zeroThreadsWithNonActionTextSignals: zeroWithNonActionText,
    assessment:
      persistedByType.action > 0 &&
      persistedByType.change === 0 &&
      persistedByType.decision === 0 &&
      persistedByType.alert === 0 &&
      persistedByType.due === 0
        ? "Strong observed bias toward explicit Actions in persisted O5A.6 output; non-action types were not persisted in this pilot sample."
        : "Mixed type persistence observed.",
  };

  const recommendations = [
    "When model returns zero candidates on business_conversation threads that still carry approval/review/response cues, treat as a candidate-recall gap — not as proof the thread is empty.",
    "Persist rejected candidate payloads (type + evidence + speechAct) in pilot reports so validator FNs can be audited without re-calling the model.",
    "Revisit disposition_suppress / already_sent interactions on attachment+ask threads so safety does not collapse recoverable approval requests.",
    "Evidence matching should be stress-tested on short Hebrew asks and paraphrases before raising thresholds further.",
    "Decision/change/due/alert coverage needs dedicated evaluation samples; Action-heavy pilots alone cannot prove multi-type recall.",
    "Do not hardcode sender- or thread-specific exceptions; fix via general speech-act, evidence, and disposition rules.",
  ];

  let failedTimeout: Record<string, unknown> | null = null;
  if (failed) {
    const text = await loadThreadTextBundle(failed.threadId);
    failedTimeout = {
      threadId: failed.threadId,
      threadIdMasked: failed.threadIdMasked,
      errorCode: failed.errorCode,
      latencyMs: failed.latencyMs,
      sourceRoute: failed.sourceRoute,
      subject: text.subject,
      fromEmail: text.fromEmail,
      currentMessageClean: text.currentMessageClean,
      note: "Timeout during resume — no model output available for FN classification. Listed separately; not part of the 20 zero-insight labels.",
      textSignals: auditZeroInsightCard({ row: failed, text }).textSignals,
    };
  }

  const payload = {
    evaluationVersion: O5A62_EVAL_VERSION,
    status: "AWAITING HUMAN LABELING OF O5A.6 ZERO-INSIGHT THREADS",
    constraints: {
      noOpenAI: true,
      noFeedWrites: true,
      noEngineChanges: true,
      noO5B: true,
      noWebhooks: true,
      noPush: true,
    },
    sourceReport: "tmp/o5a6-real-inbox-review.json",
    zeroInsightCount: cards.length,
    summary,
    actionBias,
    recommendations,
    failedTimeout,
    cards,
    coverageAll30: coverage,
    humanLabelsFile: "tmp/o5a62-human-labels.json",
    reviewRoute: "/feed/review/o5a6",
  };

  return payload;
}

export async function writeO5a62AuditFiles(cwd = process.cwd()) {
  const payload = await buildO5a62AuditPayload(cwd);
  const tmpDir = path.resolve(cwd, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    path.join(tmpDir, path.basename(O5A62_AUDIT_JSON)),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join(tmpDir, path.basename(O5A62_AUDIT_MD)),
    formatAuditMarkdown({
      status: payload.status,
      zeroCount: payload.zeroInsightCount,
      summary: payload.summary,
      cards: payload.cards,
      failedTimeout: payload.failedTimeout,
      coverage: payload.coverageAll30,
      actionBias: payload.actionBias,
      recommendations: payload.recommendations,
    }),
    "utf8",
  );
  return payload;
}

export function isO5a62ReviewEnabled() {
  return process.env.NODE_ENV !== "production";
}

export type { O5a6ThreadRow, ZeroInsightAuditCard };
