/**
 * O5C.3.1 — Locked selection harness helpers (no OpenAI).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const O5C3_LIVE_SELECTION_PATH = path.resolve(
  process.cwd(),
  "tmp",
  "o5c3-live-selection.json",
);

export function loadLockedSelectionThreadIds(
  selectionPath: string = O5C3_LIVE_SELECTION_PATH,
): string[] {
  const raw = JSON.parse(readFileSync(selectionPath, "utf8")) as {
    selected?: Array<{ threadId?: string }>;
  };
  return (raw.selected ?? [])
    .map((s) => s.threadId)
    .filter((id): id is string => Boolean(id));
}

/** Contract: every event threadId must equal the locked selection set (order-insensitive). */
export function assertPilotEventsMatchSelection(opts: {
  selectionThreadIds: string[];
  eventThreadIds: string[];
}): void {
  const sel = [...opts.selectionThreadIds].map((s) => s.toLowerCase()).sort();
  const ev = [...opts.eventThreadIds].map((s) => s.toLowerCase()).sort();
  if (sel.length === 0) {
    throw new Error("selection_empty");
  }
  if (sel.join("|") !== ev.join("|")) {
    throw new Error(
      `selection_events_mismatch sel=${sel.join(",")} ev=${ev.join(",")}`,
    );
  }
}
