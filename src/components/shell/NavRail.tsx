"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  ListTodo,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const mainItems = [
  { href: "/feed", label: "פיד", icon: ListTodo },
  { href: "/inbox", label: "תיבה", icon: Inbox },
] as const;


export function NavRail() {
  const pathname = usePathname();

  return (
    <nav
      className="flex h-full w-[var(--rail-width)] shrink-0 flex-col items-center border-l border-[var(--border)] bg-[var(--surface-rail)] py-4"
      aria-label="ניווט ראשי"
    >
      <Link
        href="/feed"
        className="mb-5 flex size-10 items-center justify-center rounded-[var(--radius-icon)] bg-[var(--action-primary)] text-[12px] font-semibold text-[var(--action-on-primary)]"
        aria-label="AgenticBox"
        title="AgenticBox"
      >
        AB
      </Link>

      <div className="flex w-full flex-1 flex-col items-center gap-1 px-2">
        {mainItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Tooltip key={href}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  className={cn(
                    "relative flex w-full flex-col items-center gap-1 rounded-[var(--radius-icon)] px-1 py-2 text-center",
                    active
                      ? "bg-[var(--surface-selected)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                  )}
                  aria-current={active ? "page" : undefined}
                  title={label}
                >
                  {active ? (
                    <span className="absolute top-2 bottom-2 right-0 w-[2px] rounded-full bg-[var(--action-primary)]" />
                  ) : null}
                  <span className="flex size-10 items-center justify-center rounded-[var(--radius-icon)]">
                    <Icon className="size-[20px]" strokeWidth={1.75} />
                  </span>
                  <span className="text-[11px] font-medium leading-none">{label}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="left">{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="mt-auto flex w-full flex-col items-center gap-2 px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/settings"
              className={cn(
                "relative flex w-full flex-col items-center gap-1 rounded-[var(--radius-icon)] px-1 py-2 text-center",
                pathname.startsWith("/settings")
                  ? "bg-[var(--surface-selected)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
              )}
            >
              <span className="flex size-10 items-center justify-center rounded-[var(--radius-icon)]">
                <Settings className="size-[20px]" strokeWidth={1.75} />
              </span>
              <span className="text-[11px] font-medium leading-none">הגדרות</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="left">הגדרות</TooltipContent>
        </Tooltip>

        <div
          className="flex size-10 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--surface-selected)] text-[12px] font-semibold text-[var(--text-primary)]"
          title="מאור אלון"
          aria-label="מאור אלון"
        >
          מא
        </div>
      </div>
    </nav>
  );
}
