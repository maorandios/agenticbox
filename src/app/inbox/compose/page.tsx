"use client";

import { AppShell } from "@/components/shell/AppShell";
import { NewMailPanel } from "@/components/conversation/NewMailPanel";

export default function ComposePage() {
  return (
    <AppShell activeThreadId={null} conversation={<NewMailPanel />} />
  );
}
