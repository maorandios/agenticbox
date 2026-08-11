"use client";

import type { ReactNode } from "react";
import { NavRail } from "@/components/shell/NavRail";

export function SecondaryShell({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-[var(--background)]">
      <NavRail />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={title}>
        {children}
      </main>
    </div>
  );
}
