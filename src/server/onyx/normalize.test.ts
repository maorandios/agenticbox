import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { INSUFFICIENT_HE, normalizeAnswer, normalizeCitations } from "@/server/onyx/normalize";
import type { OnyxChatFullResponse } from "@/server/onyx/schemas";

describe("normalizeCitations / normalizeAnswer", () => {
  it("merges citation_info with top_documents", () => {
    const raw: OnyxChatFullResponse = {
      answer: "התשובה",
      citation_info: [{ citation_number: 1, document_id: "doc-1" }],
      top_documents: [
        {
          document_id: "doc-1",
          semantic_identifier: "נושא",
          blurb: "קטע",
          link: "https://agenticbox.local/x",
          metadata: { source_type: "email_thread_test" },
        },
      ],
      chat_session_id: "11111111-1111-1111-1111-111111111111",
    };
    const sources = normalizeCitations(raw);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      documentId: "doc-1",
      citationNumber: 1,
      semanticIdentifier: "נושא",
      blurb: "קטע",
      link: "https://agenticbox.local/x",
    });
  });

  it("returns insufficient_evidence when citations are empty", () => {
    const result = normalizeAnswer({
      raw: {
        answer: "ניחוש בלי מקור",
        citation_info: [],
        top_documents: [],
        chat_session_id: null,
      },
      requestId: "r1",
      latencyMs: 10,
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.sources).toEqual([]);
    expect(result.answer).toBe(INSUFFICIENT_HE);
  });

  it("returns answered only with non-empty mappable sources", () => {
    const result = normalizeAnswer({
      raw: {
        answer: "המחיר הוא 10",
        citation_info: [{ citation_number: 1, document_id: "doc-9" }],
        top_documents: [
          {
            document_id: "doc-9",
            semantic_identifier: "הזמנה",
            blurb: "10 שח",
            link: null,
            metadata: {},
          },
        ],
        chat_session_id: "sess",
      },
      requestId: "r2",
      latencyMs: 12,
    });
    expect(result.status).toBe("answered");
    expect(result.sources).toHaveLength(1);
    expect(result.chatSessionId).toBe("sess");
  });

  it("rejects answered with empty sources even if answer exists", () => {
    const result = normalizeAnswer({
      raw: {
        answer: "טקסט",
        citation_info: [],
        top_documents: [],
      },
      requestId: "r3",
      latencyMs: 1,
    });
    expect(result.status).not.toBe("answered");
    expect(result.sources).toEqual([]);
  });

  it("maps LLM credential errors to onyx_llm_unavailable", () => {
    const result = normalizeAnswer({
      raw: {
        answer: "",
        citation_info: [],
        top_documents: [],
        error_msg:
          "openai service error: litellm.APIError: You have no credentials",
        chat_session_id: "s1",
      },
      requestId: "r4",
      latencyMs: 9,
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("onyx_llm_unavailable");
  });
});
