import type { NylasAttachment } from "./nylas-types";

export const ATTACHMENTS_ON_CONFLICT = "message_id,provider_attachment_id";

export type NormalizedAttachmentRow = {
  provider_attachment_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_inline: boolean;
  content_id: string | null;
  disposition: string | null;
};

export type AttachmentNormalizeResult = {
  rows: NormalizedAttachmentRow[];
  duplicatesNeutralized: number;
  skippedMissingId: number;
};

function richness(row: NormalizedAttachmentRow): number {
  let score = 0;
  if (row.filename && row.filename !== "attachment") score += 2;
  if (row.mime_type) score += 1;
  if (row.size_bytes != null && row.size_bytes > 0) score += 1;
  if (row.content_id) score += 1;
  if (row.disposition) score += 1;
  return score;
}

function mergeAttachmentRows(
  a: NormalizedAttachmentRow,
  b: NormalizedAttachmentRow,
): NormalizedAttachmentRow {
  const preferB = richness(b) >= richness(a);
  const primary = preferB ? b : a;
  const secondary = preferB ? a : b;
  return {
    provider_attachment_id: primary.provider_attachment_id,
    filename:
      primary.filename !== "attachment"
        ? primary.filename
        : secondary.filename !== "attachment"
          ? secondary.filename
          : primary.filename,
    mime_type: primary.mime_type ?? secondary.mime_type,
    size_bytes: Math.max(primary.size_bytes ?? 0, secondary.size_bytes ?? 0) || null,
    is_inline: primary.is_inline || secondary.is_inline,
    content_id: primary.content_id ?? secondary.content_id,
    disposition: primary.disposition ?? secondary.disposition,
  };
}

function toRow(att: NylasAttachment): NormalizedAttachmentRow | null {
  const id = typeof att.id === "string" ? att.id.trim() : "";
  if (!id) return null;
  return {
    provider_attachment_id: id,
    filename: (att.filename && att.filename.trim()) || "attachment",
    mime_type: att.contentType ?? null,
    size_bytes: typeof att.size === "number" ? att.size : null,
    is_inline: Boolean(att.isInline),
    content_id: att.contentId ?? null,
    disposition: att.contentDisposition ?? null,
  };
}

/**
 * Deterministic dedupe by (provider_attachment_id) within one message payload.
 * DB unique is (message_id, provider_attachment_id); message_id is fixed by caller.
 * Does NOT dedupe by filename alone.
 */
export function normalizeAttachmentsForMessage(
  attachments: NylasAttachment[] | undefined | null,
): AttachmentNormalizeResult {
  let skippedMissingId = 0;
  let duplicatesNeutralized = 0;
  const byId = new Map<string, NormalizedAttachmentRow>();

  for (const att of attachments ?? []) {
    const row = toRow(att);
    if (!row) {
      skippedMissingId += 1;
      continue;
    }
    const existing = byId.get(row.provider_attachment_id);
    if (!existing) {
      byId.set(row.provider_attachment_id, row);
      continue;
    }
    duplicatesNeutralized += 1;
    byId.set(row.provider_attachment_id, mergeAttachmentRows(existing, row));
  }

  // Stable order by provider_attachment_id for deterministic upserts/tests.
  const rows = [...byId.values()].sort((a, b) =>
    a.provider_attachment_id.localeCompare(b.provider_attachment_id),
  );

  return { rows, duplicatesNeutralized, skippedMissingId };
}
