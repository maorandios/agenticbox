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
      <main
        className="thin-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        aria-label={title}
      >
        {children}
      </main>
    </div>
  );
}
