import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailAccountForUser } from "@/server/mail/account-service";
import { getMessagesForThreadOwned } from "@/server/mail/read/messages";
import { getThreadForUser } from "@/server/mail/read/threads";

export async function loadSourceThreadForUser(opts: {
  userId: string;
  threadId: string;
}) {
  const account = await getMailAccountForUser(opts.userId);
  if (!account) return { status: "no_account" as const };

  const admin = createAdminClient();
  const { data: owned, error } = await admin
    .from("threads")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", account.id)
    .eq("id", opts.threadId)
    .maybeSingle();
  if (error) throw new Error(`source_thread_lookup_failed:${error.message}`);
  if (!owned) return { status: "not_found" as const };

  const thread = await getThreadForUser({
    userId: opts.userId,
    threadId: opts.threadId,
  });
  if (!thread) return { status: "not_found" as const };

  const messages = await getMessagesForThreadOwned({
    userId: opts.userId,
    threadId: opts.threadId,
  });
  if (!messages) return { status: "not_found" as const };

  return {
    status: "ok" as const,
    accountId: account.id,
    thread: thread.thread,
    participants: thread.participants,
    messages: messages.messages,
    messageParticipants: messages.participants,
    attachments: messages.attachments,
  };
}
