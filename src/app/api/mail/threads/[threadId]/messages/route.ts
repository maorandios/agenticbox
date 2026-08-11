import { requireUser } from "@/server/auth/require-user";
import { assertNoSecretLeak } from "@/server/mail/account-dto";
import { jsonPrivate } from "@/server/mail/read/http";
import { getMessagesForThreadOwned } from "@/server/mail/read/messages";

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
    const result = await getMessagesForThreadOwned({
      userId: user.id,
      threadId,
    });
    if (!result) {
      return jsonPrivate({ error: "not_found" }, { status: 404 });
    }
    const body = {
      messages: result.messages,
      participants: result.participants,
      attachments: result.attachments,
    };
    assertNoSecretLeak(body);
    return jsonPrivate(body);
  } catch {
    return jsonPrivate({ error: "failed" }, { status: 500 });
  }
}
