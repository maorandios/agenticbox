import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailAccountForUser } from "@/server/mail/account-service";
import { ask as onyxAsk } from "@/server/onyx/adapter";
import { isOnyxEnabled } from "@/server/onyx/config";
import { getIndexProgress } from "@/server/onyx/index/progress";
import { onyxLog } from "@/server/onyx/log";
import type { SearchAnswerDto, SearchSourceDto } from "@/types/search";

const INSUFFICIENT_HE = "לא מצאתי מספיק מידע בתיבת המייל כדי לענות בביטחון.";
const FAILED_HE = "לא הצלחתי להשלים את החיפוש כרגע. נסו שוב בעוד רגע.";
const LLM_UNAVAILABLE_HE =
  "שירות התשובות של Onyx אינו זמין כרגע (בעיית מודל/מפתח בצד Onyx). בדקו את הגדרות ה־LLM ב־Onyx Cloud ונסו שוב.";
const NO_INDEX_HE = "עדיין אין מספיק מיילים מאונדקסים לחיפוש. השלימו סנכרון ואינדוקס.";
const NO_ACCOUNT_HE = "אין חשבון מייל מחובר. חברו חשבון בהגדרות.";
const ONYX_DISABLED_HE =
  "חיפוש AI מושעה כרגע. AgenticBox מתמקד בפיד ובזיכרון העסקי.";

function truncateSnippet(text: string, max = 180): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function parseMessageIdFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link, "https://agenticbox.local");
    const messageId = url.searchParams.get("message");
    return messageId?.trim() || null;
  } catch {
    return null;
  }
}

type ThreadRow = {
  id: string;
  subject: string | null;
  snippet: string | null;
  latest_message_at: string | null;
  message_count: number | null;
  participants_summary: unknown;
};

function participantsFromSummary(summary: unknown): {
  names: string[];
  emails: string[];
} {
  if (!Array.isArray(summary)) return { names: [], emails: [] };
  const names: string[] = [];
  const emails: string[] = [];
  for (const item of summary) {
    if (!item || typeof item !== "object") continue;
    const row = item as { email?: string; name?: string | null };
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (email) emails.push(email);
    if (name) names.push(name);
  }
  return { names, emails };
}

export async function askMailboxQuestion(opts: {
  userId: string;
  question: string;
  chatSessionId?: string | null;
}): Promise<SearchAnswerDto> {
  if (!isOnyxEnabled()) {
    return {
      status: "failed",
      answer: ONYX_DISABLED_HE,
      chatSessionId: null,
      requestId: "local",
      latencyMs: 0,
      sources: [],
      errorCode: "onyx_disabled",
    };
  }

  const question = opts.question.trim();
  if (!question) {
    return {
      status: "failed",
      answer: FAILED_HE,
      chatSessionId: null,
      requestId: "local",
      latencyMs: 0,
      sources: [],
      errorCode: "empty_question",
    };
  }

  const account = await getMailAccountForUser(opts.userId);
  if (!account || account.syncStatus === "disconnected") {
    return {
      status: "no_account",
      answer: NO_ACCOUNT_HE,
      chatSessionId: null,
      requestId: "local",
      latencyMs: 0,
      sources: [],
      errorCode: "no_account",
    };
  }

  const progress = await getIndexProgress({
    userId: opts.userId,
    mailAccountId: account.id,
  });
  if (progress.indexed < 1) {
    return {
      status: "no_indexed_data",
      answer: NO_INDEX_HE,
      chatSessionId: null,
      requestId: "local",
      latencyMs: 0,
      sources: [],
      errorCode: "no_indexed_data",
    };
  }

  const raw = await onyxAsk({
    question,
    chatSessionId: opts.chatSessionId ?? null,
    metadataFilters: [
      { tag_key: "user_id", tag_value: opts.userId },
      { tag_key: "mail_account_id", tag_value: account.id },
    ],
  });

  if (raw.status === "failed") {
    const llmDown = raw.errorCode === "onyx_llm_unavailable";
    return {
      status: "failed",
      answer: llmDown ? LLM_UNAVAILABLE_HE : FAILED_HE,
      chatSessionId: raw.chatSessionId,
      requestId: raw.requestId,
      latencyMs: raw.latencyMs,
      sources: [],
      errorCode: raw.errorCode ?? "onyx_failed",
    };
  }

  const admin = createAdminClient();
  const documentIds = [
    ...new Set(raw.sources.map((s) => s.documentId).filter(Boolean)),
  ];

  if (documentIds.length === 0) {
    return {
      status: "insufficient_evidence",
      answer: INSUFFICIENT_HE,
      chatSessionId: raw.chatSessionId,
      requestId: raw.requestId,
      latencyMs: raw.latencyMs,
      sources: [],
    };
  }

  const { data: indexRows, error: indexError } = await admin
    .from("onyx_index_state")
    .select("onyx_document_id,thread_id,mail_account_id,user_id,status")
    .eq("user_id", opts.userId)
    .eq("mail_account_id", account.id)
    .in("onyx_document_id", documentIds);

  if (indexError) {
    onyxLog("error", "search_citation_lookup_failed", {
      requestId: raw.requestId,
      code: indexError.code,
    });
    return {
      status: "failed",
      answer: FAILED_HE,
      chatSessionId: raw.chatSessionId,
      requestId: raw.requestId,
      latencyMs: raw.latencyMs,
      sources: [],
      errorCode: "citation_lookup_failed",
    };
  }

  const byDoc = new Map(
    (indexRows ?? [])
      .filter((r) => r.status === "indexed")
      .map((r) => [r.onyx_document_id as string, r]),
  );

  const ownedSources = raw.sources.filter((s) => byDoc.has(s.documentId));
  if (ownedSources.length === 0) {
    onyxLog("warn", "search_citations_unmapped", {
      requestId: raw.requestId,
      rawCount: raw.sources.length,
    });
    return {
      status: "insufficient_evidence",
      answer: INSUFFICIENT_HE,
      chatSessionId: raw.chatSessionId,
      requestId: raw.requestId,
      latencyMs: raw.latencyMs,
      sources: [],
    };
  }

  const threadIds = [
    ...new Set(ownedSources.map((s) => byDoc.get(s.documentId)!.thread_id as string)),
  ];
  const { data: threads, error: threadsError } = await admin
    .from("threads")
    .select(
      "id,subject,snippet,latest_message_at,message_count,participants_summary",
    )
    .eq("user_id", opts.userId)
    .eq("mail_account_id", account.id)
    .in("id", threadIds);

  if (threadsError) {
    return {
      status: "failed",
      answer: FAILED_HE,
      chatSessionId: raw.chatSessionId,
      requestId: raw.requestId,
      latencyMs: raw.latencyMs,
      sources: [],
      errorCode: "thread_lookup_failed",
    };
  }

  const threadById = new Map(
    ((threads ?? []) as ThreadRow[]).map((t) => [t.id, t]),
  );

  const sources: SearchSourceDto[] = [];
  for (const src of ownedSources) {
    const indexRow = byDoc.get(src.documentId)!;
    const threadId = indexRow.thread_id as string;
    const thread = threadById.get(threadId);
    if (!thread) continue;
    const parts = participantsFromSummary(thread.participants_summary);
    const messageId = parseMessageIdFromLink(src.link);
    const snippet = truncateSnippet(
      src.blurb || thread.snippet || thread.subject || "",
    );
    sources.push({
      id: `src_${threadId}`,
      threadId,
      messageId,
      title: (thread.subject || "ללא נושא").trim() || "ללא נושא",
      senderNames: parts.names.slice(0, 4),
      senderEmails: parts.emails.slice(0, 4),
      lastMessageAt: thread.latest_message_at || new Date(0).toISOString(),
      messageCount: Number(thread.message_count ?? 0),
      snippet,
      sourceUrl: messageId
        ? `/source/thread/${threadId}?message=${encodeURIComponent(messageId)}`
        : `/source/thread/${threadId}`,
    });
  }

  // De-dupe by thread for UI stability
  const deduped: SearchSourceDto[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.threadId)) continue;
    seen.add(s.threadId);
    deduped.push(s);
  }

  if (deduped.length === 0) {
    return {
      status: "insufficient_evidence",
      answer: INSUFFICIENT_HE,
      chatSessionId: raw.chatSessionId,
      requestId: raw.requestId,
      latencyMs: raw.latencyMs,
      sources: [],
    };
  }

  const answerText =
    raw.status === "answered" && raw.answer.trim()
      ? raw.answer.trim()
      : INSUFFICIENT_HE;

  return {
    status: raw.status === "answered" && answerText !== INSUFFICIENT_HE
      ? "answered"
      : "insufficient_evidence",
    answer:
      raw.status === "answered" && answerText !== INSUFFICIENT_HE
        ? answerText
        : INSUFFICIENT_HE,
    chatSessionId: raw.chatSessionId,
    requestId: raw.requestId,
    latencyMs: raw.latencyMs,
    sources: deduped,
  };
}
