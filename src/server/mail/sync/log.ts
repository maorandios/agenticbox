import "server-only";

export type SyncLogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

/** Structured logs without email bodies, subjects, or full addresses. */
export function syncLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: SyncLogFields = {},
) {
  const payload = {
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
