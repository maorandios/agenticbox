import type {
  Attachment,
  Message,
  Participant,
  Thread,
  ThreadStatus,
} from "@/types/domain";
import { getDisplayInitials } from "@/lib/initials";

export function participantIdFromEmail(email: string) {
  return `p:${email.trim().toLowerCase()}`;
}

export function emailFromParticipantId(id: string) {
  return id.startsWith("p:") ? id.slice(2) : id;
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0] ?? email;
  const cleaned = local.replace(/[._+-]+/g, " ").trim();
  return cleaned || email;
}

export function toParticipant(params: {
  email: string;
  name?: string | null;
}): Participant {
  const email = params.email.trim().toLowerCase();
  const name =
    params.name?.trim() || nameFromEmail(email) || email || "ללא שם";
  return {
    id: participantIdFromEmail(email),
    name,
    email,
    initials: getDisplayInitials(name),
  };
}

function formatSizeLabel(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function toAttachmentDto(row: {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_inline: boolean;
  content_id: string | null;
}): Attachment {
  const id = row.id as string;
  return {
    id,
    fileName: row.filename || "attachment",
    mimeType: row.mime_type || "application/octet-stream",
    sizeLabel: formatSizeLabel(row.size_bytes),
    messageId: row.message_id,
    inlineInBody: Boolean(row.is_inline),
    src: `/api/mail/attachments/${id}`,
    alt: row.filename || undefined,
  };
}

type SummaryParticipant = { email?: string; name?: string | null };

export function participantsFromThreadSummary(
  summary: unknown,
): Participant[] {
  if (!Array.isArray(summary)) return [];
  const out: Participant[] = [];
  const seen = new Set<string>();
  for (const item of summary as SummaryParticipant[]) {
    const email = (item?.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(toParticipant({ email, name: item?.name }));
  }
  return out;
}

function detectLanguage(text: string): Thread["language"] {
  const he = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (he && en) return "mixed";
  if (he) return "he";
  return "en";
}

export function toThreadDto(row: {
  id: string;
  subject: string | null;
  snippet: string | null;
  unread: boolean;
  latest_message_at: string | null;
  participants_summary: unknown;
  folders?: string[] | null;
}): Thread {
  const participants = participantsFromThreadSummary(row.participants_summary);
  const subject = row.subject?.trim() || "(ללא נושא)";
  const snippet = row.snippet?.trim() || "";
  const status: ThreadStatus = row.unread ? "unread" : "done";
  return {
    id: row.id,
    subject,
    snippet,
    participantIds: participants.map((p) => p.id),
    status,
    unread: Boolean(row.unread),
    updatedAt: row.latest_message_at ?? new Date(0).toISOString(),
    language: detectLanguage(`${subject} ${snippet}`),
  };
}

/**
 * Rewrite CID → authenticated proxy URLs; strip auto-loading of remote http(s) images.
 * Returns HTML safe for dangerouslySetInnerHTML (already sanitized at persist time).
 */
export function rewriteSanitizedHtmlForClient(params: {
  html: string | null | undefined;
  cidToAttachmentId: Map<string, string>;
}): { html: string | null; blockedExternalImageCount: number } {
  if (!params.html) return { html: null, blockedExternalImageCount: 0 };
  let blocked = 0;
  const html = params.html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (full, prefix: string, quote: string, src: string) => {
      const trimmed = src.trim();
      if (/^cid:/i.test(trimmed)) {
        const cid = trimmed.slice(4).replace(/^<|>$/g, "").trim().toLowerCase();
        const attachmentId =
          params.cidToAttachmentId.get(cid) ??
          params.cidToAttachmentId.get(`<${cid}>`);
        if (attachmentId) {
          return `${prefix}${quote}/api/mail/attachments/${attachmentId}${quote}`;
        }
        blocked += 1;
        return `${prefix}${quote}${quote} data-blocked-cid=${quote}${cid}${quote}`;
      }
      if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
        blocked += 1;
        return `${prefix}${quote}${quote} data-blocked-src=${quote}${trimmed}${quote}`;
      }
      return full;
    },
  );
  return { html, blockedExternalImageCount: blocked };
}

export function toMessageDto(params: {
  row: {
    id: string;
    thread_id: string;
    subject: string | null;
    snippet: string | null;
    plain_text: string | null;
    sanitized_html: string | null;
    provider_date_at: string | null;
    direction: "inbound" | "outbound";
    quoted_text?: string | null;
  };
  from: Participant | null;
  to: Participant[];
  cc: Participant[];
  attachmentIds: string[];
  cidToAttachmentId: Map<string, string>;
}): Message {
  const { html } = rewriteSanitizedHtmlForClient({
    html: params.row.sanitized_html,
    cidToAttachmentId: params.cidToAttachmentId,
  });
  const body =
    params.row.plain_text?.trim() ||
    params.row.snippet?.trim() ||
    "";

  return {
    id: params.row.id,
    threadId: params.row.thread_id,
    fromId: params.from?.id ?? participantIdFromEmail("unknown@invalid"),
    toIds: params.to.map((p) => p.id),
    ccIds: params.cc.length ? params.cc.map((p) => p.id) : undefined,
    sentAt: params.row.provider_date_at ?? new Date(0).toISOString(),
    subject: params.row.subject ?? undefined,
    body,
    sanitizedHtml: html,
    isOutbound: params.row.direction === "outbound",
    quotedText: params.row.quoted_text ?? undefined,
    attachmentIds: params.attachmentIds.length
      ? params.attachmentIds
      : undefined,
  };
}
