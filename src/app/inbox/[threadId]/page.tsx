import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { ConversationPanel } from "@/components/conversation/ConversationPanel";
import {
  getEmailDataSource,
  isApiEmailDataSource,
} from "@/lib/email-data-source";
import { requireUser } from "@/server/auth/require-user";
import { getThreadForUser } from "@/server/mail/read/threads";

type PageProps = {
  params: Promise<{ threadId: string }>;
};

export default async function InboxThreadPage({ params }: PageProps) {
  const { threadId } = await params;

  if (isApiEmailDataSource()) {
    const { user } = await requireUser();
    if (!user) redirect(`/login?next=/inbox/${encodeURIComponent(threadId)}`);
    const result = await getThreadForUser({ userId: user.id, threadId });
    if (!result) notFound();

    return (
      <AppShell
        activeThreadId={result.thread.id}
        conversation={<ConversationPanel threadId={result.thread.id} />}
      />
    );
  }

  const thread = await getEmailDataSource().getThread(threadId);
  if (!thread) notFound();

  return (
    <AppShell
      activeThreadId={thread.id}
      conversation={<ConversationPanel threadId={thread.id} />}
    />
  );
}
