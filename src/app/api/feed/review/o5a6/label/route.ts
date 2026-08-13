import { requireUser } from "@/server/auth/require-user";
import { jsonPrivate } from "@/server/mail/read/http";
import { isO5a62ReviewEnabled } from "@/server/feed/blind/o5a62-audit";
import {
  HUMAN_LABEL_OPTIONS,
  saveHumanLabel,
  type HumanReviewLabel,
} from "@/server/feed/blind/o5a62-audit-core";

const LABEL_IDS = new Set(HUMAN_LABEL_OPTIONS.map((o) => o.id));

export async function POST(request: Request) {
  if (!isO5a62ReviewEnabled()) {
    return jsonPrivate({ error: "not_found" }, { status: 404 });
  }
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  let body: { threadId?: string; label?: string; note?: string };
  try {
    body = (await request.json()) as {
      threadId?: string;
      label?: string;
      note?: string;
    };
  } catch {
    return jsonPrivate({ error: "invalid_json" }, { status: 400 });
  }

  const threadId = String(body.threadId ?? "").trim().toLowerCase();
  const label = String(body.label ?? "").trim() as HumanReviewLabel;
  if (!/^[0-9a-f-]{36}$/.test(threadId)) {
    return jsonPrivate({ error: "invalid_thread" }, { status: 400 });
  }
  if (!LABEL_IDS.has(label)) {
    return jsonPrivate({ error: "invalid_label" }, { status: 400 });
  }

  try {
    const saved = saveHumanLabel({
      threadId,
      label,
      note: body.note ? String(body.note).slice(0, 500) : undefined,
    });
    return jsonPrivate({
      ok: true,
      threadId,
      label,
      updatedAt: saved.labels[threadId]?.updatedAt ?? null,
      storage: "tmp/o5a62-human-labels.json",
      feedItemsUntouched: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return jsonPrivate({ error: message }, { status: 500 });
  }
}
