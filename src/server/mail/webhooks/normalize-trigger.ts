export type WebhookSuffixFlags = {
  transformed?: boolean;
  truncated?: boolean;
  cleaned?: boolean;
  metadata?: boolean;
};

export type NormalizedWebhookType = {
  eventType: string;
  eventTypeBase: string;
  suffixFlags: WebhookSuffixFlags;
};

const SUFFIXES = [
  { token: ".transformed", key: "transformed" as const },
  { token: ".truncated", key: "truncated" as const },
  { token: ".cleaned", key: "cleaned" as const },
  { token: ".metadata", key: "metadata" as const },
];

/**
 * Normalize Nylas webhook `type` values such as
 * `message.created.cleaned.transformed.truncated`.
 * Mirrors private.normalize_webhook_type in SQL.
 */
export function normalizeWebhookType(eventType: string): NormalizedWebhookType {
  let base = (eventType ?? "").trim().toLowerCase();
  const suffixFlags: WebhookSuffixFlags = {};

  let changed = true;
  while (changed) {
    changed = false;
    for (const { token, key } of SUFFIXES) {
      if (base.endsWith(token)) {
        suffixFlags[key] = true;
        base = base.slice(0, -token.length);
        changed = true;
        break;
      }
    }
  }

  return {
    eventType: (eventType ?? "").trim(),
    eventTypeBase: base,
    suffixFlags,
  };
}
