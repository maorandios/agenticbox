import "server-only";
import type { OnyxChatFullResponse } from "./schemas";
import type { OnyxAskResult, OnyxAskStatus, OnyxSourceRef } from "./types";

const INSUFFICIENT_HE =
  "לא מצאתי מספיק מידע בתיבת המייל כדי לענות בביטחון.";

function asMetadata(
  value: Record<string, string | string[]> | null | undefined,
): Record<string, string | string[]> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v;
  }
  return out;
}

export function normalizeCitations(raw: OnyxChatFullResponse): OnyxSourceRef[] {
  const byId = new Map<string, OnyxSourceRef>();

  const canonId = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  for (const doc of raw.top_documents ?? []) {
    if (!doc?.document_id) continue;
    const documentId = canonId(doc.document_id);
    byId.set(documentId, {
      documentId,
      citationNumber: null,
      semanticIdentifier: doc.semantic_identifier ?? null,
      blurb: doc.blurb ?? null,
      link: doc.link ?? null,
      metadata: asMetadata(doc.metadata),
    });
  }

  for (const cite of raw.citation_info ?? []) {
    if (!cite?.document_id) continue;
    const documentId = canonId(cite.document_id);
    const existing = byId.get(documentId);
    if (existing) {
      existing.citationNumber =
        typeof cite.citation_number === "number" ? cite.citation_number : existing.citationNumber;
      continue;
    }
    byId.set(documentId, {
      documentId,
      citationNumber:
        typeof cite.citation_number === "number" ? cite.citation_number : null,
      semanticIdentifier: null,
      blurb: null,
      link: null,
      metadata: {},
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const an = a.citationNumber ?? Number.MAX_SAFE_INTEGER;
    const bn = b.citationNumber ?? Number.MAX_SAFE_INTEGER;
    return an - bn;
  });
}

export function normalizeAnswer(opts: {
  raw: OnyxChatFullResponse;
  requestId: string;
  latencyMs: number;
}): OnyxAskResult {
  const { raw, requestId, latencyMs } = opts;
  const sources = normalizeCitations(raw);
  const chatSessionId = raw.chat_session_id ?? null;

  if (raw.error_msg && !raw.answer?.trim()) {
    const err = raw.error_msg.toLowerCase();
    const llmUnavailable =
      err.includes("no cred") ||
      err.includes("apierror") ||
      err.includes("litellm") ||
      err.includes("openai service error") ||
      err.includes("anthropic") ||
      err.includes("model");
    return {
      status: "failed",
      answer: "",
      sources: [],
      chatSessionId,
      requestId,
      latencyMs,
      errorCode: llmUnavailable ? "onyx_llm_unavailable" : "onyx_error_msg",
    };
  }

  const hasCitations = (raw.citation_info?.length ?? 0) > 0;
  const hasMappableSources = sources.length > 0;

  if (!hasCitations || !hasMappableSources) {
    return {
      status: "insufficient_evidence",
      answer: INSUFFICIENT_HE,
      sources: [],
      chatSessionId,
      requestId,
      latencyMs,
    };
  }

  const answer = raw.answer?.trim() ?? "";
  if (!answer) {
    return {
      status: "insufficient_evidence",
      answer: INSUFFICIENT_HE,
      sources: [],
      chatSessionId,
      requestId,
      latencyMs,
    };
  }

  const status: OnyxAskStatus = "answered";
  return {
    status,
    answer,
    sources,
    chatSessionId,
    requestId,
    latencyMs,
  };
}

export { INSUFFICIENT_HE };
