import "server-only";
import type { OnyxConfig } from "./config";
import type { OnyxHttpClient } from "./http";
import { createOnyxHttpClient } from "./http";
import { onyxLog } from "./log";
import { normalizeAnswer } from "./normalize";
import {
  onyxAskInputSchema,
  onyxChatFullResponseSchema,
  type OnyxAskInput,
} from "./schemas";
import type { OnyxAskResult } from "./types";

/** Internal Search tool id verified in O1. */
export const ONYX_INTERNAL_SEARCH_TOOL_ID = 1;

export function createChatClient(config: OnyxConfig): OnyxHttpClient {
  return createOnyxHttpClient({
    purpose: "chat",
    baseUrl: config.baseUrl,
    apiKey: config.chatApiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
}

export async function ask(opts: {
  config: OnyxConfig;
  client: OnyxHttpClient;
  input: OnyxAskInput;
  requestId: string;
}): Promise<OnyxAskResult> {
  const input = onyxAskInputSchema.parse(opts.input);

  const body: Record<string, unknown> = {
    message: input.question,
    stream: false,
    include_citations: true,
    deep_research: false,
    allowed_tool_ids: [ONYX_INTERNAL_SEARCH_TOOL_ID],
  };

  if (input.chatSessionId) {
    body.chat_session_id = input.chatSessionId;
  } else {
    body.chat_session_info = { persona_id: opts.config.personaId };
  }

  onyxLog("info", "onyx_question_started", {
    requestId: opts.requestId,
    questionLength: input.question.length,
    hasSession: Boolean(input.chatSessionId),
    personaId: opts.config.personaId,
  });

  const { data, latencyMs } = await opts.client.request({
    method: "POST",
    path: "/chat/send-chat-message",
    body,
    requestId: opts.requestId,
    schema: onyxChatFullResponseSchema,
  });

  if (!data) {
    return {
      status: "failed",
      answer: "",
      sources: [],
      chatSessionId: null,
      requestId: opts.requestId,
      latencyMs,
      errorCode: "empty_response",
    };
  }

  const normalized = normalizeAnswer({
    raw: data,
    requestId: opts.requestId,
    latencyMs,
  });

  onyxLog("info", "onyx_question_completed", {
    requestId: opts.requestId,
    status: normalized.status,
    sourceCount: normalized.sources.length,
    latencyMs,
    hasSession: Boolean(normalized.chatSessionId),
  });

  return normalized;
}
