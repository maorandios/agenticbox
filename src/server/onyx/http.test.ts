import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOnyxHttpClient } from "@/server/onyx/http";
import { OnyxError } from "@/server/onyx/errors";
import { z } from "zod";

describe("onyx http client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not retry 401", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "no" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createOnyxHttpClient({
      purpose: "chat",
      baseUrl: "https://example.test/api",
      apiKey: "chat-key",
      timeoutMs: 5000,
      maxRetries: 3,
    });

    await expect(
      client.request({
        method: "POST",
        path: "/chat/send-chat-message",
        body: { message: "x" },
        requestId: "r-401",
      }),
    ).rejects.toMatchObject({ code: "auth", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry 403", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "forbidden" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createOnyxHttpClient({
      purpose: "ingestion",
      baseUrl: "https://example.test/api",
      apiKey: "ingest-key",
      timeoutMs: 5000,
      maxRetries: 3,
    });
    await expect(
      client.request({
        method: "POST",
        path: "/onyx-api/ingestion",
        body: {},
        requestId: "r-403",
      }),
    ).rejects.toMatchObject({ code: "forbidden", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "slow down" }), {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createOnyxHttpClient({
      purpose: "chat",
      baseUrl: "https://example.test/api",
      apiKey: "chat-key",
      timeoutMs: 5000,
      maxRetries: 3,
    });

    const result = await client.request({
      method: "GET",
      path: "/health",
      requestId: "r-429",
      schema: z.object({ ok: z.boolean() }),
    });
    expect(result.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createOnyxHttpClient({
      purpose: "health",
      baseUrl: "https://example.test/api",
      apiKey: null,
      timeoutMs: 5000,
      maxRetries: 3,
    });
    const result = await client.request({
      method: "GET",
      path: "/health",
      requestId: "r-5xx",
      schema: z.object({ success: z.boolean() }),
    });
    expect(result.data?.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps abort to timeout error", async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createOnyxHttpClient({
      purpose: "chat",
      baseUrl: "https://example.test/api",
      apiKey: "chat-key",
      timeoutMs: 10,
      maxRetries: 0,
    });
    await expect(
      client.request({
        method: "GET",
        path: "/x",
        requestId: "r-timeout",
      }),
    ).rejects.toBeInstanceOf(OnyxError);
    await expect(
      client.request({
        method: "GET",
        path: "/x",
        requestId: "r-timeout-2",
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("does not retry AbortError timeouts", async () => {
    const fetchMock = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createOnyxHttpClient({
      purpose: "chat",
      baseUrl: "https://example.test/api",
      apiKey: "chat-key",
      timeoutMs: 10,
      maxRetries: 3,
    });
    await expect(
      client.request({
        method: "GET",
        path: "/x",
        requestId: "r-timeout-no-retry",
      }),
    ).rejects.toMatchObject({ code: "timeout", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws malformed on invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const client = createOnyxHttpClient({
      purpose: "chat",
      baseUrl: "https://example.test/api",
      apiKey: "chat-key",
      timeoutMs: 5000,
      maxRetries: 0,
    });
    await expect(
      client.request({
        method: "GET",
        path: "/x",
        requestId: "r-badjson",
        schema: z.object({ a: z.string() }),
      }),
    ).rejects.toMatchObject({ code: "malformed" });
  });
});
