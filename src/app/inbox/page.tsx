import { redirect } from "next/navigation";
import { getDefaultInboxThreadId } from "@/mocks";

export default function InboxIndexPage() {
  const threadId = getDefaultInboxThreadId();
  redirect(threadId ? `/inbox/${threadId}` : "/search");
}
