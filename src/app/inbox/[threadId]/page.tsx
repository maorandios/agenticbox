import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { ConversationPanel } from "@/components/conversation/ConversationPanel";
import { getThread } from "@/mocks";

type PageProps = {
  params: Promise<{ threadId: string }>;
};

export default async function InboxThreadPage({ params }: PageProps) {
  const { threadId } = await params;
  const thread = getThread(threadId);
  if (!thread) notFound();

  return (
    <AppShell
      activeThreadId={thread.id}
      conversation={<ConversationPanel threadId={thread.id} />}
    />
  );
}
