import "server-only";

export function feedLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
) {
  const safe: Record<string, unknown> = { event, ts: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (
      /prompt|body|html|email|subject|authorization|api.?key|evidence|content/i.test(
        k,
      )
    ) {
      continue;
    }
    if (typeof v === "string" && v.length > 240) {
      safe[k] = `${v.slice(0, 240)}…`;
      continue;
    }
    safe[k] = v;
  }
  const line = JSON.stringify(safe);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
