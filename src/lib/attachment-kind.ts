import type { Attachment } from "@/types/domain";

export type AttachmentKind =
  | "word"
  | "excel"
  | "pdf"
  | "archive"
  | "image"
  | "other";

const WORD_EXT = new Set(["doc", "docx", "dot", "dotx", "odt", "rtf"]);
const EXCEL_EXT = new Set([
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "csv",
  "ods",
  "tsv",
]);
const PDF_EXT = new Set(["pdf"]);
const ARCHIVE_EXT = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
]);
const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "tif",
  "tiff",
]);

function extensionOf(fileName: string): string | null {
  const parts = fileName.trim().split(".");
  if (parts.length < 2) return null;
  const ext = parts.pop()?.toLowerCase();
  return ext || null;
}

export function getAttachmentKind(
  file: Pick<Attachment, "fileName" | "mimeType">,
): AttachmentKind {
  const ext = extensionOf(file.fileName);
  const mime = file.mimeType.toLowerCase();

  if (ext && WORD_EXT.has(ext)) return "word";
  if (ext && EXCEL_EXT.has(ext)) return "excel";
  if (ext && PDF_EXT.has(ext)) return "pdf";
  if (ext && ARCHIVE_EXT.has(ext)) return "archive";
  if (ext && IMAGE_EXT.has(ext)) return "image";

  if (
    mime.includes("word") ||
    mime.includes("msword") ||
    mime === "application/rtf"
  ) {
    return "word";
  }
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  ) {
    return "excel";
  }
  if (mime === "application/pdf") return "pdf";
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    mime.includes("compressed") ||
    mime.includes("tar") ||
    mime === "application/x-7z-compressed" ||
    mime === "application/gzip"
  ) {
    return "archive";
  }
  if (mime.startsWith("image/")) return "image";

  return "other";
}

/** Short type label shown next to size (extension when known). */
export function getAttachmentTypeLabel(
  file: Pick<Attachment, "fileName" | "mimeType">,
): string {
  const ext = extensionOf(file.fileName);
  if (ext) return ext.toUpperCase();

  switch (getAttachmentKind(file)) {
    case "word":
      return "WORD";
    case "excel":
      return "EXCEL";
    case "pdf":
      return "PDF";
    case "archive":
      return "ZIP";
    case "image":
      return "IMG";
    default:
      return "FILE";
  }
}
