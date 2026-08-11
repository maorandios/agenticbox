import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ask, deleteDocument, upsertDocument } from "@/server/onyx/adapter";
import { createChatClient } from "@/server/onyx/chat";
import { createIngestionClient, upsertDocument as upsertRaw } from "@/server/onyx/ingest";
import type { OnyxConfig } from "@/server/onyx/config";

const ENV_KEYS = [
  "ONYX_ENABLED",
  "ONYX_BASE_URL",
  "ONYX_INGESTION_API_KEY",
  "ONYX_CHAT_API_KEY",
  "ONYX_PERSONA_ID",
  "ONYX_CC_PAIR_ID",
  "ONYX_TIMEOUT_MS",
  "ONYX_MAX_RETRIES",
] as const;

const snapshot: Record<string, string | undefined> = {};

function rememberEnv() {
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
}
function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function enableOnyxEnv() {
  process.env.ONYX_ENABLED = "true";
  process.env.ONYX_BASE_URL = "https://example.test/api";
  process.env.ONYX_INGESTION_API_KEY = "ingest-admin-key";
  process.env.ONYX_CHAT_API_KEY = "chat-basic-key";
  process.env.ONYX_PERSONA_ID = "0";
  process.env.ONYX_CC_PAIR_ID = "2";
  process.env.ONYX_TIMEOUT_MS = "5000";
  process.env.ONYX_MAX_RETRIES = "1";
}

describe("onyx adapter behavior", () => {
  rememberEnv();

  beforeEach(() => {
    enableOnyxEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it("returns failed when feature flag disabled", async () => {
    process.env.ONYX_ENABLED = "false";
    const result = await ask({ question: "מה שלומך?" });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("disabled");
    expect(result.sources).toEqual([]);
  });

  it("upsert uses ingestion key, source ingestion_api, and cc_pair_id from env", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/onyx-api/ingestion");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer ingest-admin-key");
      expect(headers.get("Authorization")).not.toContain("chat-basic-key");
      const body = JSON.parse(String(init?.body));
      expect(body.cc_pair_id).toBe(2);
      expect(body.document.source).toBe("ingestion_api");
      expect(body.document.id).toBe("doc-1");
      expect(body.document.metadata).toEqual({ source_type: "email_thread_test" });
      return new Response(
        JSON.stringify({ document_id: "doc-1", already_existed: false }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertDocument({
      id: "doc-1",
      semanticIdentifier: "Synthetic",
      sections: [{ text: "תוכן סינתטי" }],
      metadata: { source_type: "email_thread_test" },
    });
    expect(result.documentId).toBe("doc-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("chat uses chat key and required ask flags", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer chat-basic-key");
      expect(headers.get("Authorization")).not.toContain("ingest-admin-key");
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(false);
      expect(body.include_citations).toBe(true);
      expect(body.allowed_tool_ids).toEqual([1]);
      expect(body.deep_research).toBe(false);
      expect(body.chat_session_info).toEqual({ persona_id: 0 });
      expect(body.message).toBe("שאלה");
      return new Response(
        JSON.stringify({
          answer: "תשובה",
          citation_info: [{ citation_number: 1, document_id: "doc-1" }],
          top_documents: [
            {
              document_id: "doc-1",
              semantic_identifier: "כותרת",
              blurb: "קטע",
              link: "https://agenticbox.local/x",
              metadata: {},
            },
          ],
          chat_session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          message_id: 1,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ask({ question: "שאלה" });
    expect(result.status).toBe("answered");
    expect(result.sources).toHaveLength(1);
    expect(result.chatSessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("follow-up sends chat_session_id and omits chat_session_info", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.chat_session_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(body.chat_session_info).toBeUndefined();
      expect(body.allowed_tool_ids).toEqual([1]);
      return new Response(
        JSON.stringify({
          answer: "המשך",
          citation_info: [{ citation_number: 1, document_id: "doc-1" }],
          top_documents: [{ document_id: "doc-1", semantic_identifier: "t", blurb: "b" }],
          chat_session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          message_id: 2,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ask({
      question: "המשך?",
      chatSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(result.status).toBe("answered");
    expect(result.chatSessionId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("ask without citations becomes insufficient_evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            answer: "בלי מקורות",
            citation_info: [],
            top_documents: [],
            message_id: 3,
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await ask({ question: "שאלה" });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.sources).toEqual([]);
  });

  it("delete is idempotent on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "missing" }), { status: 404 })),
    );
    const result = await deleteDocument("missing-doc");
    expect(result.deleted).toBe(true);
    expect(result.alreadyAbsent).toBe(true);
  });

  it("keeps ingestion/chat clients on separate keys", () => {
    const config: OnyxConfig = {
      enabled: true,
      baseUrl: "https://example.test/api",
      ingestionApiKey: "ingest-admin-key",
      chatApiKey: "chat-basic-key",
      personaId: 0,
      ccPairId: 2,
      timeoutMs: 5000,
      maxRetries: 1,
    };
    const ingestion = createIngestionClient(config);
    const chat = createChatClient(config);
    expect(ingestion.purpose).toBe("ingestion");
    expect(chat.purpose).toBe("chat");
  });

  it("upsertRaw always forces source and cc_pair_id", async () => {
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.document.source).toBe("ingestion_api");
      expect(body.cc_pair_id).toBe(2);
      return new Response(
        JSON.stringify({ document_id: "x", already_existed: true }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const config: OnyxConfig = {
      enabled: true,
      baseUrl: "https://example.test/api",
      ingestionApiKey: "ingest-admin-key",
      chatApiKey: "chat-basic-key",
      personaId: 0,
      ccPairId: 2,
      timeoutMs: 5000,
      maxRetries: 0,
    };
    await upsertRaw({
      config,
      client: createIngestionClient(config),
      requestId: "req",
      input: {
        id: "x",
        semanticIdentifier: "s",
        sections: [{ text: "t" }],
      },
    });
  });
});
