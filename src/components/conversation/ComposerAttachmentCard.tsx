"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { AttachmentTypeIcon } from "@/components/conversation/AttachmentTypeIcon";

export function ComposerAttachmentCard({
  fileName,
  mimeType,
  sizeLabel,
  progress,
  onRemove,
}: {
  fileName: string;
  mimeType: string;
  sizeLabel: string;
  progress: number;
  onRemove: () => void;
}) {
  const uploading = progress < 100;

  return (
    <div
      className="relative size-[76px] shrink-0"
      title={fileName}
    >
      <button
        type="button"
        aria-label={`הסר את ${fileName}`}
        onClick={onRemove}
        className="absolute -top-1.5 -left-1.5 z-[2] inline-flex size-4 items-center justify-center rounded-full bg-white text-[var(--text-muted)] shadow-sm ring-1 ring-[var(--border)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="size-2.5" strokeWidth={2} />
      </button>

      <div className="relative flex size-full flex-col items-center overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface-subtle)] p-1.5">
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pt-1">
          <AttachmentTypeIcon
            file={{ fileName, mimeType }}
            className="size-4 shrink-0 text-[var(--text-secondary)]"
          />
          <span className="line-clamp-2 w-full min-w-0 overflow-hidden px-0.5 text-center text-[9.5px] leading-tight font-medium break-all text-[var(--text-primary)]">
            {fileName}
          </span>
        </div>

        <span className="shrink-0 truncate text-[9px] text-[var(--text-muted)]">
          {uploading ? `${progress}%` : sizeLabel}
        </span>

        {uploading ? (
          <span
            className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-[var(--border)]"
            aria-hidden
          >
            <span
              className={cn(
                "block h-full rounded-full bg-[var(--action-primary)] transition-[width] duration-150",
              )}
              style={{ width: `${progress}%` }}
            />
          </span>
        ) : null}
      </div>
    </div>
  );
}
