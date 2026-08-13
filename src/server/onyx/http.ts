import "server-only";
import { z } from "zod";
import { isOnyxEnabled } from "./config";
import { classifyHttpError, OnyxError } from "./errors";
import { onyxLog } from "./log";
import { redactSecrets, safeErrorMessage } from "./redact";

export type OnyxHttpPurpose = "ingestion" | "chat" | "health";

export type OnyxHttpClient = {
  purpose: OnyxHttpPurpose;
  request: <T = unknown>(opts: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: unknown;
    requestId: string;
    schema?: { parse: (data: unknown) => T };
    /** When true, 404 is returned as null instead of throwing. */
    acceptNotFound?: boolean;
  }) => Promise<{ data: T | null; status: number; latencyMs: number }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const asNum = Number(retryAfterHeader);
    if (!Number.isNaN(asNum)) {
      return asNum < 100 ? asNum * 1000 : asNum;
    }
    const dateMs = Date.parse(retryAfterHeader);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

export function createOnyxHttpClient(opts: {
  purpose: OnyxHttpPurpose;
  baseUrl: string;
  apiKey?: string | null;
  timeoutMs: number;
  maxRetries: number;
}): OnyxHttpClient {
  const { purpose, baseUrl, apiKey, timeoutMs, maxRetries } = opts;

  async function requestOnce(args: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: unknown;
    requestId: string;
    signal: AbortSignal;
  }): Promise<{ status: number; text: string; retryAfter: string | null }> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    let bodyInit: string | undefined;
    if (args.body !== undefined) {
      bodyInit = JSON.stringify(args.body);
      headers["Content-Type"] = "application/json; charset=utf-8";
    }

    const res = await fetch(`${baseUrl}${args.path}`, {
      method: args.method,
      headers,
      body: bodyInit,
      signal: args.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      text,
      retryAfter: res.headers.get("retry-after"),
    };
  }

  return {
    purpose,
    async request<T>(opts: {
      method: "GET" | "POST" | "DELETE";
      path: string;
      body?: unknown;
      requestId: string;
      schema?: { parse: (data: unknown) => T };
      acceptNotFound?: boolean;
    }): Promise<{ data: T | null; status: number; latencyMs: number }> {
      const { method, path, body, requestId, schema, acceptNotFound } = opts;

      // O5D — central runtime guard: never open HTTP when Onyx is suspended.
      if (!isOnyxEnabled()) {
        throw new OnyxError({
          code: "disabled",
          message: "onyx_disabled",
          retryable: false,
          requestId,
        });
      }

      let attempt = 0;
      const started = Date.now();

      while (true) {
        attempt += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const result = await requestOnce({
            method,
            path,
            body,
            requestId,
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (result.status === 404 && acceptNotFound) {
            return {
              data: null,
              status: 404,
              latencyMs: Date.now() - started,
            };
          }

          if (result.status >= 400) {
            const err = classifyHttpError({
              status: result.status,
              bodyText: result.text,
              requestId,
            });
            const canRetry =
              err.retryable && attempt <= maxRetries && (err.code === "rate_limit" || err.code === "server");
            if (!canRetry) throw err;

            const waitMs = backoffMs(attempt, result.retryAfter);
            onyxLog("warn", "onyx_http_retry", {
              purpose,
              requestId,
              attempt,
              status: result.status,
              waitMs,
              code: err.code,
            });
            await sleep(waitMs);
            continue;
          }

          let parsed: unknown = null;
          if (result.text.trim()) {
            try {
              parsed = JSON.parse(result.text) as unknown;
            } catch (error) {
              throw new OnyxError({
                code: "malformed",
                message: `onyx_malformed_json:${safeErrorMessage(error)}`,
                status: result.status,
                retryable: false,
                requestId,
              });
            }
          }

          const data = schema ? schema.parse(parsed) : (parsed as T);
          return {
            data,
            status: result.status,
            latencyMs: Date.now() - started,
          };
        } catch (error) {
          clearTimeout(timer);

          if (error instanceof z.ZodError) {
            throw new OnyxError({
              code: "malformed",
              message: "onyx_response_schema_mismatch",
              status: null,
              retryable: false,
              requestId,
              cause: error,
            });
          }

          if (error instanceof OnyxError) {
            if (
              error.retryable &&
              attempt <= maxRetries &&
              (error.code === "rate_limit" || error.code === "server")
            ) {
              const waitMs = backoffMs(attempt, null);
              onyxLog("warn", "onyx_http_retry", {
                purpose,
                requestId,
                attempt,
                waitMs,
                code: error.code,
              });
              await sleep(waitMs);
              continue;
            }
            throw error;
          }

          const isAbort =
            (error instanceof Error && error.name === "AbortError") ||
            (typeof error === "object" &&
              error !== null &&
              "name" in error &&
              (error as { name?: string }).name === "AbortError");

          // Timeouts must not retry: 60s×4 left the Ask UI spinning for minutes.
          const wrapped = new OnyxError({
            code: isAbort ? "timeout" : "network",
            message: isAbort
              ? "onyx_timeout"
              : `onyx_network:${redactSecrets(safeErrorMessage(error))}`,
            retryable: !isAbort,
            requestId,
            cause: error,
          });

          if (!isAbort && attempt <= maxRetries) {
            const waitMs = backoffMs(attempt, null);
            onyxLog("warn", "onyx_http_retry", {
              purpose,
              requestId,
              attempt,
              waitMs,
              code: wrapped.code,
            });
            await sleep(waitMs);
            continue;
          }
          throw wrapped;
        }
      }
    },
  };
}
