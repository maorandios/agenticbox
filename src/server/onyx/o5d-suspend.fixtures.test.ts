/**
 * O5D — Prove zero Onyx HTTP when ONYX_ENABLED=false.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ask, healthCheck, upsertDocument } from "@/server/onyx/adapter";
import { searchDocuments } from "@/server/onyx/search";
import { enqueueThreadIndex } from "@/server/onyx/index/enqueue";
import { processOnyxQueue } from "@/server/onyx/index/worker";
import { askMailboxQuestion } from "@/server/search/ask";
import { OnyxError } from "@/server/onyx/errors";

describe("O5D Onyx suspended — zero runtime HTTP", () => {
  const prev = process.env.ONYX_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.ONYX_ENABLED;
    else process.env.ONYX_ENABLED = prev;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("searchDocuments throws onyx_disabled with 0 fetch", async () => {
    process.env.ONYX_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchDocuments({ query: "test" })).rejects.toBeInstanceOf(
      OnyxError,
    );
    await expect(searchDocuments({ query: "test" })).rejects.toMatchObject({
      message: "onyx_disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ask returns disabled without fetch", async () => {
    process.env.ONYX_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await ask({ question: "hi", chatSessionId: null });
    expect(res.errorCode).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upsertDocument throws before HTTP", async () => {
    process.env.ONYX_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      upsertDocument({
        id: "doc",
        semanticIdentifier: "doc",
        sections: [{ text: "x" }],
      }),
    ).rejects.toMatchObject({ message: "onyx_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("healthCheck is local when disabled", async () => {
    process.env.ONYX_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await healthCheck();
    expect(res.message).toBe("onyx_disabled");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enqueueThreadIndex does not enqueue when disabled", async () => {
    process.env.ONYX_ENABLED = "false";
    const out = await enqueueThreadIndex({
      userId: "7b897ada-7b9d-4730-b662-028830e55259",
      mailAccountId: "3083783b-1dc5-453f-924b-3c62f54e150e",
      threadId: "11111111-1111-4111-8111-111111111111",
    });
    expect(out).toEqual({ enqueued: false, reason: "onyx_disabled" });
  });

  it("processOnyxQueue is a no-op when disabled", async () => {
    process.env.ONYX_ENABLED = "false";
    const out = await processOnyxQueue({ maxJobs: 3 });
    expect(out.read).toBe(0);
    expect(out.indexed).toBe(0);
  });

  it("askMailboxQuestion returns onyx_disabled without Onyx HTTP", async () => {
    process.env.ONYX_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await askMailboxQuestion({
      userId: "7b897ada-7b9d-4730-b662-028830e55259",
      question: "מה הסטטוס?",
    });
    expect(res.errorCode).toBe("onyx_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
