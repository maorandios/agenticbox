import "server-only";

const KEYISH =
  /on_tenant_[A-Za-z0-9._\-]+|Bearer\s+[A-Za-z0-9._\-]+|Authorization["']?\s*[:=]\s*["']?[^"'\s]+/gi;

export function collectSecretValues(extra: Array<string | undefined | null> = []): string[] {
  const values = [
    process.env.ONYX_INGESTION_API_KEY,
    process.env.ONYX_CHAT_API_KEY,
    ...extra,
  ];
  return values
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v && v.length > 0));
}

export function redactSecrets(
  input: string,
  extraSecrets: Array<string | undefined | null> = [],
): string {
  let out = input;
  for (const secret of collectSecretValues(extraSecrets)) {
    out = out.split(secret).join("[REDACTED]");
  }
  out = out.replace(KEYISH, "[REDACTED]");
  return out;
}

export function safeErrorMessage(
  error: unknown,
  extraSecrets: Array<string | undefined | null> = [],
): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "unknown_error";
  return redactSecrets(raw, extraSecrets).slice(0, 400);
}
