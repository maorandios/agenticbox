import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { jsonPrivate } from "@/server/mail/read/http";
import { patchFeedItemForUser } from "@/server/feed/list";

const bodySchema = z.object({
  status: z.enum(["handled", "irrelevant", "open"]),
});

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ feedItemId: string }> },
) {
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  const { feedItemId } = await ctx.params;
  if (!feedItemId) {
    return jsonPrivate({ error: "invalid_id" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonPrivate({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonPrivate({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const result = await patchFeedItemForUser({
      userId: user.id,
      feedItemId,
      status: parsed.data.status,
    });
    if (result === "no_account") {
      return jsonPrivate({ error: "no_account" }, { status: 404 });
    }
    if (result === "not_found") {
      return jsonPrivate({ error: "not_found" }, { status: 404 });
    }
    return jsonPrivate({ ok: true, status: parsed.data.status });
  } catch {
    return jsonPrivate({ error: "failed" }, { status: 500 });
  }
}
