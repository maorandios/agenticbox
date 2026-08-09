"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type MonoPillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "sm" | "md";
};

export function MonoPill({
  className,
  active = false,
  size = "md",
  type = "button",
  ...props
}: MonoPillProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] px-3.5 text-[13px] font-medium",
        size === "sm" ? "h-8" : "h-9",
        active
          ? "bg-[var(--surface-selected)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
