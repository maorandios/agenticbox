import { redirect } from "next/navigation";
import {
  getEmailDataSource,
  isApiEmailDataSource,
} from "@/lib/email-data-source";
import { requireUser } from "@/server/auth/require-user";
import { getDefaultThreadIdForUser } from "@/server/mail/read/threads";

export default async function InboxIndexPage() {
  if (isApiEmailDataSource()) {
    const { user } = await requireUser();
    if (!user) redirect("/login?next=/inbox");
    const threadId = await getDefaultThreadIdForUser(user.id);
    redirect(threadId ? `/inbox/${threadId}` : "/search");
  }

  const threadId = await getEmailDataSource().getDefaultInboxThreadId();
  redirect(threadId ? `/inbox/${threadId}` : "/search");
}
