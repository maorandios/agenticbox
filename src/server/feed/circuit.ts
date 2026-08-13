import "server-only";

/**
 * In-process circuit breaker for a Feed extraction batch.
 * On model access / auth / quota / schema hard failures — stop all further OpenAI calls.
 */
let open = false;
let tripReason: string | null = null;

const CIRCUIT_ERROR_CODES = new Set([
  "openai_auth",
  "openai_forbidden",
  "openai_not_found",
  "openai_bad_request",
  "openai_model_unavailable",
  "openai_quota",
  "schema_invalid",
  "model_probe_failed",
]);

export function isCircuitBreakerError(errorCode: string): boolean {
  return CIRCUIT_ERROR_CODES.has(errorCode);
}

export function isFeedCircuitOpen(): boolean {
  return open;
}

export function getFeedCircuitReason(): string | null {
  return tripReason;
}

export function tripFeedCircuit(reason: string): void {
  open = true;
  tripReason = reason;
}

export function resetFeedCircuit(): void {
  open = false;
  tripReason = null;
}

/** @deprecated alias — use resetFeedCircuit */
export function resetFeedCircuitForTests(): void {
  resetFeedCircuit();
}

export function mapOpenAiHttpError(opts: {
  status?: number | null;
  message: string;
}): string {
  const status = opts.status ?? null;
  const message = opts.message;
  if (status === 401 || /api.?key|unauthorized|authentication/i.test(message)) {
    return "openai_auth";
  }
  if (status === 403 || /permission|forbidden|access/i.test(message)) {
    if (/model_not_found|does not have access to model/i.test(message)) {
      return "openai_model_unavailable";
    }
    return "openai_forbidden";
  }
  if (status === 404 || /model_not_found|does not have access to model/i.test(message)) {
    return "openai_model_unavailable";
  }
  if (status === 400) {
    return "openai_bad_request";
  }
  if (
    status === 429 ||
    /quota|rate.?limit|billing|insufficient.?quota/i.test(message)
  ) {
    return "openai_quota";
  }
  if (/timeout|AbortError|aborted|ETIMEDOUT|timed out|TimeoutError/i.test(message)) {
    return "openai_timeout";
  }
  if (/refus/i.test(message)) {
    return "openai_refusal";
  }
  return "openai_failed";
}
