import "server-only";
import { OnyxError } from "./errors";

export type OnyxConfig = {
  enabled: boolean;
  baseUrl: string;
  ingestionApiKey: string;
  chatApiKey: string;
  personaId: number;
  ccPairId: number;
  timeoutMs: number;
  maxRetries: number;
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function isOnyxEnabled(): boolean {
  return parseBool(process.env.ONYX_ENABLED, false);
}

/**
 * Soft read for diagnostics. Does not throw when disabled.
 * When enabled, validates required secrets and cc_pair_id.
 */
export function getOnyxConfig(requestId = "config"): OnyxConfig {
  const enabled = isOnyxEnabled();
  const baseUrl = (process.env.ONYX_BASE_URL ?? "https://cloud.onyx.app/api")
    .trim()
    .replace(/\/+$/, "");
  const ingestionApiKey = process.env.ONYX_INGESTION_API_KEY?.trim() ?? "";
  const chatApiKey = process.env.ONYX_CHAT_API_KEY?.trim() ?? "";
  const personaParsed = Number(process.env.ONYX_PERSONA_ID ?? "0");
  const personaId = Number.isFinite(personaParsed) ? Math.floor(personaParsed) : 0;
  const ccPairRaw = process.env.ONYX_CC_PAIR_ID?.trim() ?? "";
  const ccPairId = Number(ccPairRaw);
  // Ask latency on 100 threads is often 18–75s; 120s avoids aborting slow answers.
  const timeoutMs = parsePositiveInt(process.env.ONYX_TIMEOUT_MS, 120_000);
  const maxRetries = parsePositiveInt(process.env.ONYX_MAX_RETRIES, 3);

  if (!enabled) {
    return {
      enabled: false,
      baseUrl,
      ingestionApiKey,
      chatApiKey,
      personaId,
      ccPairId: Number.isFinite(ccPairId) ? ccPairId : 0,
      timeoutMs,
      maxRetries,
    };
  }

  const missing: string[] = [];
  if (!baseUrl) missing.push("ONYX_BASE_URL");
  if (!ingestionApiKey) missing.push("ONYX_INGESTION_API_KEY");
  if (!chatApiKey) missing.push("ONYX_CHAT_API_KEY");
  if (!ccPairRaw || !Number.isFinite(ccPairId) || ccPairId <= 0) {
    missing.push("ONYX_CC_PAIR_ID");
  }
  if (missing.length > 0) {
    throw new OnyxError({
      code: "config",
      message: `onyx_config_missing:${missing.join(",")}`,
      retryable: false,
      requestId,
    });
  }

  return {
    enabled: true,
    baseUrl,
    ingestionApiKey,
    chatApiKey,
    personaId,
    ccPairId,
    timeoutMs,
    maxRetries,
  };
}

export function requireOnyxEnabled(requestId: string): OnyxConfig {
  if (!isOnyxEnabled()) {
    throw new OnyxError({
      code: "disabled",
      message: "onyx_disabled",
      retryable: false,
      requestId,
    });
  }
  return getOnyxConfig(requestId);
}
