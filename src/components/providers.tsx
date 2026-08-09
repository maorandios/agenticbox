"use client";

import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/state/workspace";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <TooltipProvider>
        {children}
        <Toaster
          dir="rtl"
          position="bottom-left"
          toastOptions={{
            classNames: {
              toast:
                "border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-toast)] rounded-[15px]",
              title: "text-[14px] font-medium",
              description: "text-[13px] text-[var(--text-secondary)]",
              actionButton:
                "bg-[var(--action-primary)] text-[var(--action-on-primary)] rounded-full px-3",
              cancelButton:
                "bg-[var(--surface-subtle)] text-[var(--text-primary)] rounded-full px-3",
            },
          }}
        />
      </TooltipProvider>
    </WorkspaceProvider>
  );
}
