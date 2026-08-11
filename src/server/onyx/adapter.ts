import "server-only";
import { randomUUID } from "node:crypto";
import { getOnyxConfig, requireOnyxEnabled } from "./config";
import { OnyxError } from "./errors";
import { ask as askChat, createChatClient } from "./chat";
import {
  createIngestionClient,
  deleteDocument as deleteIngestedDocument,
  upsertDocument as upsertIngestedDocument,
} from "./ingest";
import { createOnyxHttpClient } from "./http";
import { onyxLog } from "./log";
import { normalizeAnswer, normalizeCitations } from "./normalize";
import { onyxHealthSchema } from "./schemas";
import type { OnyxAskInput, OnyxUpsertDocumentInput } from "./schemas";
import type {
  OnyxAskResult,
  OnyxDeleteResult,
  OnyxHealthResult,
  OnyxUpsertResult,
} from "./types";

function newRequestId(): string {
  return randomUUID();
}

export async function healthCheck(): Promise<OnyxHealthResult> {
  const requestId = newRequestId();
  const started = Date.now();
  const config = getOnyxConfig(requestId);

  // Health is public — do not attach API keys.
  const client = createOnyxHttpClient({
    purpose: "health",
    baseUrl: config.baseUrl,
    apiKey: null,
    timeoutMs: config.timeoutMs,
    maxRetries: 1,
  });

  try {
    const { data, latencyMs } = await client.request({
      method: "GET",
      path: "/health",
      requestId,
      schema: onyxHealthSchema,
    });
    onyxLog("info", "onyx_health_check", {
      requestId,
      ok: Boolean(data?.success),
      latencyMs,
      enabled: config.enabled,
    });
    return {
      ok: Boolean(data?.success),
      message: data?.message ?? null,
      requestId,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    onyxLog("warn", "onyx_health_check", {
      requestId,
      ok: false,
      latencyMs,
      code: error instanceof OnyxError ? error.code : "unknown",
    });
    return {
      ok: false,
      message: error instanceof OnyxError ? error.message : "health_failed",
      requestId,
      latencyMs,
    };
  }
}

export async function upsertDocument(
  input: OnyxUpsertDocumentInput,
): Promise<OnyxUpsertResult> {
  const requestId = newRequestId();
  const config = requireOnyxEnabled(requestId);
  const client = createIngestionClient(config);
  return upsertIngestedDocument({ config, client, input, requestId });
}

export async function deleteDocument(documentId: string): Promise<OnyxDeleteResult> {
  const requestId = newRequestId();
  const config = requireOnyxEnabled(requestId);
  const client = createIngestionClient(config);
  return deleteIngestedDocument({ client, documentId, requestId });
}

export async function ask(input: OnyxAskInput): Promise<OnyxAskResult> {
  const requestId = newRequestId();
  try {
    const config = requireOnyxEnabled(requestId);
    const client = createChatClient(config);
    return await askChat({ config, client, input, requestId });
  } catch (error) {
    if (error instanceof OnyxError && error.code === "disabled") {
      return {
        status: "failed",
        answer: "",
        sources: [],
        chatSessionId: null,
        requestId,
        latencyMs: 0,
        errorCode: "disabled",
      };
    }
    if (error instanceof OnyxError) {
      onyxLog("error", "onyx_question_failed", {
        requestId,
        code: error.code,
        status: error.status,
      });
      return {
        status: "failed",
        answer: "",
        sources: [],
        chatSessionId: null,
        requestId,
        latencyMs: 0,
        errorCode: error.code,
      };
    }
    throw error;
  }
}

export { normalizeAnswer, normalizeCitations, OnyxError };