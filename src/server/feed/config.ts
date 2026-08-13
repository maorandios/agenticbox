import "server-only";

export type FeedConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  timeoutMs: number;
  pilotMaxThreads: number;
  dailyExtractionLimit: number;
  minConfidence: number;
  minBusinessRelevance: number;
  extractionVersion: string;
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

function parseConfidence(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

export const FEED_PILOT_HARD_CAP = 20;
export const FEED_PREFILTER_SCAN_CAP = 100;
export const DEFAULT_FEED_MODEL = "gpt-4o-mini";
export const DEFAULT_FEED_EXTRACTION_VERSION = "o5a.3";
export const O5A_SUPERSEDE_REASON = "o5a_quality_calibration";
export const O5A2_SUPERSEDE_REASON = "o5a2_attribution_calibration";
export const O5A2_CORRECTION_REASON = "o5a2_attribution_correction";
export const O5A3_NON_BUSINESS_REASON = "o5a3_non_business_change";
export const O5A3_SEMANTICS_REASON = "o5a3_semantics_calibration";
export const FEED_MIN_SEMANTIC_PRECISION = 0.9;

export function getFeedConfig(): FeedConfig {
  return {
    enabled: parseBool(process.env.FEED_AI_ENABLED, false),
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    model: process.env.OPENAI_FEED_MODEL?.trim() || DEFAULT_FEED_MODEL,
    timeoutMs: parsePositiveInt(process.env.FEED_AI_TIMEOUT_MS, 60_000),
    pilotMaxThreads: Math.min(
      FEED_PILOT_HARD_CAP,
      parsePositiveInt(process.env.FEED_PILOT_MAX_THREADS, FEED_PILOT_HARD_CAP),
    ),
    dailyExtractionLimit: parsePositiveInt(
      process.env.FEED_DAILY_EXTRACTION_LIMIT,
      100,
    ),
    minConfidence: parseConfidence(process.env.FEED_MIN_CONFIDENCE, 0.8),
    minBusinessRelevance: parseConfidence(
      process.env.FEED_MIN_BUSINESS_RELEVANCE,
      0.85,
    ),
    extractionVersion:
      process.env.FEED_EXTRACTION_VERSION?.trim() ||
      DEFAULT_FEED_EXTRACTION_VERSION,
  };
}

export function isFeedAiEnabled(): boolean {
  return getFeedConfig().enabled;
}

export function clampPilotLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return FEED_PILOT_HARD_CAP;
  return Math.min(FEED_PILOT_HARD_CAP, Math.floor(n));
}
