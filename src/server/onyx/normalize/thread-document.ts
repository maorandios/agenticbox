import "server-only";
import { stableJsonHash } from "./hash";

export type NormalizeBodySource = "clean_conversation" | "plain_text" | "empty";

export type ThreadMessageInput = {
  id: string;
  subject: string;
  plainText: string | null;
  cleanConversation: string | null;
  direction: "inbound" | "outbound";
  providerDateAt: string | null;
  participants: Array<{
    role: "from" | "to" | "cc" | "bcc" | "reply_to";
    email: string;
    name: string | null;
  }>;
  attachments: Array<{
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
  }>;
};

export type ThreadNormalizeInput = {
  userId: string;
  mailAccountId: string;
  threadId: string;
  providerThreadId: string;
  subject: string;
  messages: ThreadMessageInput[];
};

export type NormalizedThreadDocument = {
  id: string;
  semanticIdentifier: string;
  title: string;
  sections: Array<{ text: string; link: string }>;
  metadata: Record<string, string | string[]>;
  contentHash: string;
  quality: {
    messageCount: number;
    sectionCount: number;
    cleanConversationCount: number;
    plainTextFallbackCount: number;
    emptyBodyCount: number;
  };
};

export function buildOnyxDocumentId(userId: string, threadId: string): string {
  return `user:${userId}:thread:${threadId}`;
}

function formatParticipant(
  p: { email: string; name: string | null },
): string {
  const email = p.email.trim();
  const name = p.name?.trim();
  if (name) return `${name} <${email}>`;
  return email;
}

function formatDate(iso: string | null): string {
  if (!iso) return "לא ידוע";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Stable UTC ISO without milliseconds
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function directionLabel(direction: "inbound" | "outbound"): string {
  return direction === "inbound" ? "נכנס" : "יוצא";
}

export function selectMessageBody(message: ThreadMessageInput): {
  text: string;
  source: NormalizeBodySource;
} {
  const clean = message.cleanConversation?.trim() ?? "";
  if (clean) return { text: clean, source: "clean_conversation" };

  const plain = message.plainText?.trim() ?? "";
  if (plain) return { text: plain, source: "plain_text" };

  return { text: "(אין תוכן טקסט)", source: "empty" };
}

function buildSectionText(
  index: number,
  message: ThreadMessageInput,
  threadSubject: string,
): { text: string; source: NormalizeBodySource } {
  const from = message.participants.filter((p) => p.role === "from");
  const to = message.participants.filter((p) => p.role === "to");
  const cc = message.participants.filter((p) => p.role === "cc");
  const body = selectMessageBody(message);

  const subjectLine =
    message.subject.trim() && message.subject.trim() !== threadSubject.trim()
      ? message.subject.trim()
      : threadSubject.trim() || "ללא נושא";

  const attachmentLines =
    message.attachments.length > 0
      ? [
          "קבצים מצורפים (metadata בלבד):",
          ...message.attachments.map((a) => {
            const size =
              typeof a.sizeBytes === "number" ? `${a.sizeBytes}B` : "unknown";
            const mime = a.mimeType?.trim() || "unknown";
            return `- ${a.filename} | ${mime} | ${size}`;
          }),
        ]
      : [];

  const lines = [
    `הודעה: ${index}`,
    `מאת: ${from.map(formatParticipant).join(", ") || "לא ידוע"}`,
    `אל: ${to.map(formatParticipant).join(", ") || "לא ידוע"}`,
    `עותק: ${cc.map(formatParticipant).join(", ") || "—"}`,
    `נשלח בתאריך: ${formatDate(message.providerDateAt)}`,
    `כיוון: ${directionLabel(message.direction)}`,
    `נושא: ${subjectLine}`,
    "תוכן:",
    body.text,
    ...attachmentLines,
  ];

  return { text: lines.join("\n"), source: body.source };
}

export function normalizeThreadDocument(
  input: ThreadNormalizeInput,
): NormalizedThreadDocument {
  const sorted = [...input.messages].sort((a, b) => {
    const at = a.providerDateAt ? Date.parse(a.providerDateAt) : 0;
    const bt = b.providerDateAt ? Date.parse(b.providerDateAt) : 0;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });

  const subject = input.subject.trim() || "ללא נושא";
  const documentId = buildOnyxDocumentId(input.userId, input.threadId);

  let cleanConversationCount = 0;
  let plainTextFallbackCount = 0;
  let emptyBodyCount = 0;

  const sections = sorted.map((message, idx) => {
    const built = buildSectionText(idx + 1, message, subject);
    if (built.source === "clean_conversation") cleanConversationCount += 1;
    else if (built.source === "plain_text") plainTextFallbackCount += 1;
    else emptyBodyCount += 1;

    return {
      text: built.text,
      link: `/source/thread/${input.threadId}?message=${message.id}`,
    };
  });

  const participantEmails = Array.from(
    new Set(
      sorted.flatMap((m) =>
        m.participants.map((p) => p.email.trim().toLowerCase()).filter(Boolean),
      ),
    ),
  ).sort();

  const firstMessageAt = sorted[0]?.providerDateAt ?? "";
  const lastMessageAt = sorted[sorted.length - 1]?.providerDateAt ?? "";
  const attachmentCount = sorted.reduce((n, m) => n + m.attachments.length, 0);

  const metadata: Record<string, string | string[]> = {
    source_type: "email_thread",
    user_id: input.userId,
    thread_id: input.threadId,
    mail_account_id: input.mailAccountId,
    provider_thread_id: input.providerThreadId,
    participant_emails: participantEmails,
    first_message_at: firstMessageAt,
    last_message_at: lastMessageAt,
    message_count: String(sorted.length),
    has_attachments: attachmentCount > 0 ? "true" : "false",
    attachment_count: String(attachmentCount),
  };

  const canonical = {
    id: documentId,
    semanticIdentifier: subject,
    title: subject,
    sections,
    metadata,
    source: "ingestion_api",
  };

  return {
    id: documentId,
    semanticIdentifier: subject,
    title: subject,
    sections,
    metadata,
    contentHash: stableJsonHash(canonical),
    quality: {
      messageCount: sorted.length,
      sectionCount: sections.length,
      cleanConversationCount,
      plainTextFallbackCount,
      emptyBodyCount,
    },
  };
}
