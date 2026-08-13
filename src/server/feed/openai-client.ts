import "server-only";
import OpenAI from "openai";
import { getFeedConfig } from "./config";

let client: OpenAI | null = null;

/**
 * Server-only OpenAI client for Feed extraction.
 * maxRetries: 0 — one attempt only; no automatic AI retry.
 */
export function getFeedOpenAiClient(): OpenAI {
  const config = getFeedConfig();
  if (!config.apiKey) {
    throw new Error("openai_api_key_missing");
  }
  if (!client) {
    client = new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }
  return client;
}

/** Test helper — resets singleton between unit tests. */
export function resetFeedOpenAiClientForTests() {
  client = null;
}
