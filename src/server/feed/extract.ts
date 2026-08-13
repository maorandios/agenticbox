import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import {
  isCircuitBreakerError,
  mapOpenAiHttpError,
  tripFeedCircuit,
} from "./circuit";
import { getFeedConfig } from "./config";
import { buildFeedUserPayload, type FeedThreadContext } from "./context";
import { getFeedOpenAiClient } from "./openai-client";
import { FEED_SYSTEM_PROMPT } from "./prompt";
import {
  FeedExtractionResultSchema,
  type FeedExtractionResult,
} from "./schemas";

export type FeedOpenAiCallResult =
  | {
      ok: true;
      parsed: FeedExtractionResult;
      responseId: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      reasoningTokens: number | null;
      totalTokens: number | null;
      latencyMs: number;
      model: string;
      actualModel: string;
    }
  | {
      ok: false;
      errorCode: string;
      latencyMs: number;
      model: string;
      actualModel: string | null;
      responseId: string | null;
      circuitTripped: boolean;
      incompleteReason?: string | null;
      outputTokens?: number | null;
      reasoningTokens?: number | null;
    };

/** Request options shared by live extract + contract tests. */
export function buildFeedResponsesParseParams(opts: {
  model: string;
  system: string;
  user: string;
}) {
  return {
    model: opts.model,
    reasoning: { effort: "low" as const },
    // Visible structured JSON only — keep terse; does not change schema.
    text: {
      format: zodTextFormat(FeedExtractionResultSchema, "feed_extraction"),
      verbosity: "low" as const,
    },
    input: [
      { role: "system" as const, content: opts.system },
      { role: "user" as const, content: opts.user },
    ],
  };
}

/**
 * Exactly one Responses API call per extraction attempt.
 * No tools, no web search, no file search, no agent loop, maxRetries: 0.
 * No automatic model fallback / retry.
 */
export async function extractFeedFromContext(
  ctx: FeedThreadContext,
): Promise<FeedOpenAiCallResult> {
  const config = getFeedConfig();
  const model = config.model;
  const started = Date.now();
  const client = getFeedOpenAiClient();

  try {
    const response = await client.responses.parse(
      buildFeedResponsesParseParams({
        model,
        system: FEED_SYSTEM_PROMPT,
        user: buildFeedUserPayload(ctx),
      }),
    );

    const latencyMs = Date.now() - started;
    const usage = response.usage;
    const inputTokens = usage?.input_tokens ?? null;
    const outputTokens = usage?.output_tokens ?? null;
    const reasoningTokens =
      usage?.output_tokens_details?.reasoning_tokens ?? null;
    const totalTokens =
      usage?.total_tokens ??
      (inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : null);

    const actualModel =
      typeof response.model === "string" && response.model.trim()
        ? response.model.trim()
        : model;

    if (response.status === "incomplete" || response.error) {
      const incompleteReason =
        response.incomplete_details?.reason ??
        (response.error ? "error" : "incomplete");
      return {
        ok: false,
        errorCode: "openai_incomplete",
        latencyMs,
        model,
        actualModel,
        responseId: response.id ?? null,
        circuitTripped: false,
        incompleteReason,
        outputTokens,
        reasoningTokens,
      };
    }

    const parsed = response.output_parsed;
    if (!parsed) {
      return {
        ok: false,
        errorCode: "openai_unparsed",
        latencyMs,
        model,
        actualModel,
        responseId: response.id ?? null,
        circuitTripped: false,
        outputTokens,
        reasoningTokens,
      };
    }

    const validated = FeedExtractionResultSchema.safeParse(parsed);
    if (!validated.success) {
      tripFeedCircuit("schema_invalid");
      return {
        ok: false,
        errorCode: "schema_invalid",
        latencyMs,
        model,
        actualModel,
        responseId: response.id ?? null,
        circuitTripped: true,
        outputTokens,
        reasoningTokens,
      };
    }

    return {
      ok: true,
      parsed: validated.data,
      responseId: response.id ?? null,
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      latencyMs,
      model,
      actualModel,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status)
        : null;
    const message = error instanceof Error ? error.message : "unknown";
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: string }).name)
        : "";
    const errorCode = mapOpenAiHttpError({
      status,
      message: `${name} ${message}`,
    });
    const circuitTripped = isCircuitBreakerError(errorCode);
    if (circuitTripped) tripFeedCircuit(errorCode);

    return {
      ok: false,
      errorCode,
      latencyMs,
      model,
      actualModel: null,
      responseId: null,
      circuitTripped,
    };
  }
}
