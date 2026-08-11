import { requireUser } from "@/server/auth/require-user";
import { assertNoSecretLeak } from "@/server/mail/account-dto";
import { jsonPrivate } from "@/server/mail/read/http";
import {
  countAttachmentsForThread,
  getThreadForUser,
} from "@/server/mail/read/threads";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  const { threadId } = await context.params;
  if (!threadId) {
    return jsonPrivate({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await getThreadForUser({ userId: user.id, threadId });
    if (!result) {
      return jsonPrivate({ error: "not_found" }, { status: 404 });
    }
    const attachmentCount = await countAttachmentsForThread({
      userId: user.id,
      threadId,
    });
    const body = {
      thread: result.thread,
      participants: result.participants,
      attachmentCount,
    };
    assertNoSecretLeak(body);
    return jsonPrivate(body);
  } catch {
    return jsonPrivate({ error: "failed" }, { status: 500 });
  }
}
