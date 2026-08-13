import { requireUser } from "@/server/auth/require-user";
import { jsonPrivate } from "@/server/mail/read/http";
import { listFeedForUser } from "@/server/feed/list";

export async function GET(request: Request) {
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const status = url.searchParams.get("status");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 30;

  try {
    const result = await listFeedForUser({
      userId: user.id,
      cursor,
      limit,
      status,
    });
    if ("error" in result) {
      return jsonPrivate({ error: result.error }, { status: 404 });
    }
    return jsonPrivate(result);
  } catch {
    return jsonPrivate({ error: "failed" }, { status: 500 });
  }
}
