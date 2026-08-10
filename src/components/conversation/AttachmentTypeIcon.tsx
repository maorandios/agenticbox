"use client";

import type { ComponentType } from "react";
import {
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getAttachmentKind,
  type AttachmentKind,
} from "@/lib/attachment-kind";
import type { Attachment } from "@/types/domain";

const KIND_ICON: Record<
  AttachmentKind,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  word: FileText,
  excel: FileSpreadsheet,
  pdf: FileType,
  archive: FileArchive,
  image: FileImage,
  other: File,
};

export function AttachmentTypeIcon({
  file,
  className,
  strokeWidth = 1.75,
}: {
  file: Pick<Attachment, "fileName" | "mimeType">;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = KIND_ICON[getAttachmentKind(file)];
  return <Icon className={cn("size-4 shrink-0", className)} strokeWidth={strokeWidth} />;
}
