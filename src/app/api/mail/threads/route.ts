import type { MailboxView } from "@/types/domain";
import { requireUser } from "@/server/auth/require-user";
import { assertNoSecretLeak } from "@/server/mail/account-dto";
import { jsonPrivate } from "@/server/mail/read/http";
import { listThreadsForUser } from "@/server/mail/read/threads";

const MAILBOX_VIEWS = new Set<MailboxView>([
  "inbox",
  "unread",
  "starred",
  "sent",
  "drafts",
  "archive",
  "trash",
]);

export async function GET(request: Request) {
  const { user } = await requireUser();
  if (!user) {
    return jsonPrivate({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mailboxParam = (url.searchParams.get("mailbox") ?? "inbox") as MailboxView;
  const mailboxView = MAILBOX_VIEWS.has(mailboxParam) ? mailboxParam : "inbox";
  const cursor = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const result = await listThreadsForUser({
      userId: user.id,
      mailboxView,
      cursor,
      limit,
    });
    const body = {
      threads: result.threads,
      participants: result.participants,
      nextCursor: result.nextCursor,
    };
    assertNoSecretLeak(body);
    return jsonPrivate(body);
  } catch {
    return jsonPrivate({ error: "failed" }, { status: 500 });
  }
}
