/**
 * O5C.3 — Live Context Completion (one Structured Output call, no tools).
 */

import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import { getFeedConfig } from "./config";
import { getFeedOpenAiClient } from "./openai-client";
import {
  ContextResolutionSchema,
  type ContextResolution,
  type FeedExtractionResult,
  type SupportingSource,
} from "./schemas";
import type { ContextPack } from "./cross-thread-context";
import {
  currenciesConflict,
  evaluateSupportedCalculation,
} from "./context-calc";
import {
  assertAttributionBoundaries,
  historicalCannotCreateActionWithoutCurrentSpeechAct,
} from "./extract-with-context-guards";

export const CONTEXT_COMPLETION_MODEL = "gpt-5-mini";
/** Preferred pin when the project has snapshot access; live pilot saw 403 on dated id. */
export const CONTEXT_COMPLETION_MODEL_PIN = "gpt-5-mini-2025-08-07";

const CONTEXT_COMPLETION_SYSTEM = `You resolve cross-thread business context for a mail feed.
Return ContextResolution only.
Rules:
- status must be resolved | insufficient | conflicting.
- Use ONLY provided source thread IDs. Never invent source IDs.
- resolved requires clear business link, trigger evidence, historical evidence, sensible timeline, no unresolved conflict.
- Every material claim needs supportingSources (trigger + at least one historical when combining threads).
- Do NOT create a new Action from history alone. Do NOT invent requester/assignee, deadlines, prices, or versions.
- For numeric updates, emit SupportedCalculation operands+sources; do NOT trust your own final arithmetic as authoritative.
- Prefer insufficient over guessing.`;

export type ContextCompletionLiveResult = {
  ok: boolean;
  resolution: ContextResolution | null;
  errorCode?: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  model: string;
  actualModel: string | null;
  responseId: string | null;
};

function allowedThreadIds(opts: {
  triggerSources: SupportingSource[];
  contextPack: ContextPack;
}): Set<string> {
  const ids = new Set<string>();
  for (const s of opts.triggerSources) ids.add(s.threadId.toLowerCase());
  for (const s of opts.contextPack.sources) ids.add(s.threadId.toLowerCase());
  return ids;
}

/** Drop invented sources / illegal actions; recompute derived calculations server-side. */
export function sanitizeContextResolution(opts: {
  resolution: ContextResolution;
  allowedThreadIds: Set<string>;
  triggerRequesterEmail: string | null;
  triggerAssigneeEmail: string | null;
  currentSpeechAct: string | null;
}): ContextResolution {
  const allowed = opts.allowedThreadIds;
  const supportingSources = opts.resolution.supportingSources.filter((s) =>
    allowed.has(s.threadId.toLowerCase()),
  );

  const calculations = [];
  for (const calc of opts.resolution.calculations) {
    if (
      !allowed.has(calc.leftSource.threadId.toLowerCase()) ||
      !allowed.has(calc.rightSource.threadId.toLowerCase())
    ) {
      continue;
    }
    if (
      currenciesConflict(calc.leftSource.evidence, calc.rightSource.evidence)
    ) {
      return {
        status: "conflicting",
        items: [],
        supportingSources,
        calculations: [],
      };
    }
    const evaluated = evaluateSupportedCalculation(calc);
    if (evaluated.status !== "ok") {
      return {
        status: evaluated.status === "conflicting" ? "conflicting" : "insufficient",
        items: [],
        supportingSources,
        calculations: [],
      };
    }
    calculations.push(calc);
  }

  const items = [];
  for (const item of opts.resolution.items) {
    if (
      !historicalCannotCreateActionWithoutCurrentSpeechAct({
        currentSpeechAct: opts.currentSpeechAct,
        proposedType: item.type,
      })
    ) {
      continue;
    }
    if (
      !assertAttributionBoundaries({
        triggerRequesterEmail: opts.triggerRequesterEmail,
        triggerAssigneeEmail: opts.triggerAssigneeEmail,
        resolvedItem: item,
      })
    ) {
      // Force CURRENT envelope attribution — drop illegal rewrite.
      continue;
    }
    const itemSources = (item.supportingSources ?? []).filter((s) =>
      allowed.has(s.threadId.toLowerCase()),
    );
    items.push({
      ...item,
      supportingSources: itemSources,
      derived: calculations.length > 0 ? true : item.derived,
    });
  }

  let status = opts.resolution.status;
  if (status === "resolved") {
    const hasTrigger = supportingSources.some((s) => s.role === "trigger");
    const hasHist = supportingSources.some((s) => s.role === "historical");
    if (!hasTrigger || !hasHist) status = "insufficient";
  }

  return {
    status,
    items,
    supportingSources,
    calculations,
  };
}

export async function completeContextResolutionLive(opts: {
  extraction: FeedExtractionResult;
  contextPack: ContextPack;
  triggerSources: SupportingSource[];
  currentSubject?: string | null;
  currentMessageCleanText?: string | null;
}): Promise<ContextCompletionLiveResult> {
  const started = Date.now();
  const model = CONTEXT_COMPLETION_MODEL;
  const config = getFeedConfig();
  if (!config.apiKey) {
    return {
      ok: false,
      resolution: null,
      errorCode: "openai_api_key_missing",
      latencyMs: 0,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      model,
      actualModel: null,
      responseId: null,
    };
  }

  const allowed = [...allowedThreadIds(opts)];
  const userPayload = JSON.stringify(
    {
      subject: opts.currentSubject ?? null,
      currentMessage: (opts.currentMessageCleanText ?? "").slice(0, 4000),
      stage1: {
        threadClassification: opts.extraction.threadClassification,
        communicationNature: opts.extraction.communicationNature,
        disposition: opts.extraction.disposition,
        contextRequest: opts.extraction.contextRequest,
        items: opts.extraction.items.map((i) => ({
          type: i.type,
          headline: i.headline,
          requestedAction: i.requestedAction,
          evidenceText: i.evidenceText,
          requestSpeechAct: i.requestSpeechAct,
          requesterEmail: i.requester?.email ?? null,
          assigneeEmail: i.assignee?.email ?? null,
          previousValue: i.previousValue,
          currentValue: i.currentValue,
          businessObject: i.businessObject,
          occurredAt: i.occurredAt,
        })),
      },
      contextPack: opts.contextPack.sources.map((s) => ({
        threadId: s.threadId,
        documentId: s.documentId,
        occurredAt: s.occurredAt,
        excerpt: s.excerpt.slice(0, 2400),
        sourceLink: s.sourceLink,
      })),
      allowedSourceThreadIds: allowed,
      triggerSources: opts.triggerSources,
    },
    null,
    0,
  );

  try {
    const client = getFeedOpenAiClient();
    const response = await client.responses.parse({
      model,
      reasoning: { effort: "low" as const },
      text: {
        format: zodTextFormat(ContextResolutionSchema, "context_resolution"),
        verbosity: "low" as const,
      },
      input: [
        { role: "system" as const, content: CONTEXT_COMPLETION_SYSTEM },
        { role: "user" as const, content: userPayload },
      ],
    });

    const latencyMs = Date.now() - started;
    const usage = response.usage;
    const inputTokens = usage?.input_tokens ?? null;
    const outputTokens = usage?.output_tokens ?? null;
    const totalTokens =
      usage?.total_tokens ??
      (inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : null);
    const actualModel =
      typeof response.model === "string" && response.model.trim()
        ? response.model.trim()
        : null;

    const parsed = response.output_parsed;
    if (!parsed) {
      return {
        ok: false,
        resolution: null,
        errorCode: "empty_parsed_output",
        latencyMs,
        inputTokens,
        outputTokens,
        totalTokens,
        model,
        actualModel,
        responseId: response.id ?? null,
      };
    }

    const first = opts.extraction.items[0];
    const sanitized = sanitizeContextResolution({
      resolution: parsed,
      allowedThreadIds: new Set(allowed),
      triggerRequesterEmail: first?.requester?.email ?? null,
      triggerAssigneeEmail: first?.assignee?.email ?? null,
      currentSpeechAct: first?.requestSpeechAct ?? null,
    });

    return {
      ok: true,
      resolution: sanitized,
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      model,
      actualModel,
      responseId: response.id ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      resolution: null,
      errorCode: err instanceof Error ? err.message.slice(0, 120) : "completion_failed",
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      model,
      actualModel: null,
      responseId: null,
    };
  }
}
