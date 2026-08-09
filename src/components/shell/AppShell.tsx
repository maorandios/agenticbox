"use client";

import type { ReactNode } from "react";
import { NavRail } from "@/components/shell/NavRail";
import { ThreadSidebar } from "@/components/navigation/ThreadSidebar";
import { ThreadSnapshotPanel } from "@/components/agent/ThreadSnapshotPanel";

type AppShellProps = {
  activeThreadId: string | null;
  conversation: ReactNode;
};

export function AppShell({ activeThreadId, conversation }: AppShellProps) {
  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-[var(--background)]">
      <NavRail />

      <section
        className="flex h-full w-[var(--thread-list-width)] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-subtle)]"
        aria-label="תיבת עבודה"
      >
        <ThreadSidebar activeThreadId={activeThreadId} />
      </section>

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface)]" aria-label="השיחה">
        {activeThreadId ? conversation : null}
      </section>

      {activeThreadId ? <ThreadSnapshotPanel threadId={activeThreadId} /> : null}
    </div>
  );
}
