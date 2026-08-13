import { requireUser } from "@/server/auth/require-user";
import { jsonPrivate } from "@/server/mail/read/http";
import {
  buildO5a62AuditPayload,
  isO5a62ReviewEnabled,
} from "@/server/feed/blind/o5a62-audit";
import { HUMAN_LABEL_OPTIONS } from "@/server/feed/blind/o5a62-audit-core";

export async function GET() {
  if (!isO5a62ReviewEnabled()) {
    return jsonPrivate({ error: "not_found" }, { status: 404 });
  }
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const payload = await buildO5a62AuditPayload();
    return jsonPrivate({
      ...payload,
      labelOptions: HUMAN_LABEL_OPTIONS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return jsonPrivate({ error: message }, { status: 500 });
  }
}
