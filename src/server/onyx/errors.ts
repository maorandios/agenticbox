import "server-only";
import { safeErrorMessage } from "./redact";

export type OnyxErrorCode =
  | "disabled"
  | "config"
  | "auth"
  | "forbidden"
  | "rate_limit"
  | "timeout"
  | "server"
  | "network"
  | "malformed"
  | "not_found"
  | "unknown";

export class OnyxError extends Error {
  readonly code: OnyxErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly requestId: string;

  constructor(opts: {
    code: OnyxErrorCode;
    message: string;
    status?: number | null;
    retryable?: boolean;
    requestId: string;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "OnyxError";
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.retryable = Boolean(opts.retryable);
    this.requestId = opts.requestId;
  }
}

export function classifyHttpError(opts: {
  status: number;
  bodyText: string;
  requestId: string;
}): OnyxError {
  const { status, bodyText, requestId } = opts;
  const safe = safeErrorMessage(bodyText).slice(0, 240);

  if (status === 401) {
    return new OnyxError({
      code: "auth",
      message: `onyx_auth_failed:${safe}`,
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 403) {
    return new OnyxError({
      code: "forbidden",
      message: `onyx_forbidden:${safe}`,
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 404) {
    return new OnyxError({
      code: "not_found",
      message: `onyx_not_found:${safe}`,
      status,
      retryable: false,
      requestId,
    });
  }
  if (status === 429) {
    return new OnyxError({
      code: "rate_limit",
      message: `onyx_rate_limited:${safe}`,
      status,
      retryable: true,
      requestId,
    });
  }
  if (status >= 500) {
    return new OnyxError({
      code: "server",
      message: `onyx_server_error:${status}`,
      status,
      retryable: true,
      requestId,
    });
  }
  return new OnyxError({
    code: "unknown",
    message: `onyx_http_${status}:${safe}`,
    status,
    retryable: false,
    requestId,
  });
}
