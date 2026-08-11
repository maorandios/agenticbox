import "server-only";

export type OnyxLogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Structured logs — never log document bodies, full questions, or answers. */
export function onyxLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: OnyxLogFields = {},
) {
  const payload = {
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
