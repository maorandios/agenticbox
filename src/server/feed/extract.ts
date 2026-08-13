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
    };

/**
 * Exactly one Responses API call per extraction attempt.
 * No tools, no web search, no file search, no agent loop, maxRetries: 0.
 * No automatic model fallback.
 */
export async function extractFeedFromContext(
  ctx: FeedThreadContext,
): Promise<FeedOpenAiCallResult> {
  const config = getFeedConfig();
  const model = config.model;
  const started = Date.now();
  const client = getFeedOpenAiClient();

  try {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: FEED_SYSTEM_PROMPT },
        { role: "user", content: buildFeedUserPayload(ctx) },
      ],
      text: {
        format: zodTextFormat(FeedExtractionResultSchema, "feed_extraction"),
      },
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
        : model;

    if (response.status === "incomplete" || response.error) {
      return {
        ok: false,
        errorCode: "openai_incomplete",
        latencyMs,
        model,
        actualModel,
        responseId: response.id ?? null,
        circuitTripped: false,
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
      };
    }

    return {
      ok: true,
      parsed: validated.data,
      responseId: response.id ?? null,
      inputTokens,
      outputTokens,
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
    const errorCode = mapOpenAiHttpError({ status, message });
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
