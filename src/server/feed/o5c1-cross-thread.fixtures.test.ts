/**
 * O5C.1 — Cross-thread query + context gate fixtures (no OpenAI, no Onyx Chat).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { buildCrossThreadSearchQuery } from "@/server/feed/cross-thread-query";
import {
  buildContextPack,
  isCrossThreadContextEnabled,
  retrieveCrossThreadContext,
  type ContextSource,
} from "@/server/feed/cross-thread-context";

const searchDocuments = vi.fn();
const mapSearchHitsToOwnedThreads = vi.fn();

vi.mock("@/server/onyx/search", () => ({
  searchDocuments: (...args: unknown[]) => searchDocuments(...args),
}));

vi.mock("@/server/feed/map-search-hits", () => ({
  mapSearchHitsToOwnedThreads: (...args: unknown[]) =>
    mapSearchHitsToOwnedThreads(...args),
}));

describe("O5C.1 buildCrossThreadSearchQuery", () => {
  it("includes exact reference ID", () => {
    const q = buildCrossThreadSearchQuery({
      subject: "FW: PO-26003966",
      currentMessageCleanText: "Please handle order PO-26003966 today.",
      participants: [{ email: "buyer@example.com", name: "Buyer Peer" }],
    });
    expect(q).toMatch(/PO-26003966/i);
    expect(q).not.toMatch(/GA|AutoCAD|shop drawing/i);
  });

  it("builds Hebrew query without reference ID", () => {
    const q = buildCrossThreadSearchQuery({
      subject: "בקשה לאישור החלפת עוגן",
      currentMessageCleanText: "אשמח לאישור החלפת עוגן החיבור לקיר",
      participants: [{ email: "peer@client.co.il", name: "אוריאל" }],
    });
    expect(q).toMatch(/עוגן|אישור|אוריאל|peer@client\.co\.il/i);
    expect(q.length).toBeGreaterThan(8);
  });

  it("builds English query with participants and subject topics", () => {
    const q = buildCrossThreadSearchQuery({
      subject: "Invoice payment reminder",
      currentMessageCleanText: "Please pay invoice INV-2044 by Friday.",
      participants: [{ email: "ap@finance.example", name: "Finance Bot" }],
      referenceIdentifiers: ["INV-2044"],
    });
    expect(q).toMatch(/INV-2044/i);
    expect(q.toLowerCase()).toMatch(/finance|ap@finance|invoice|payment/);
  });
});

describe("O5C.1 feature flag + retrieval gate", () => {
  const prev = process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;

  beforeEach(() => {
    searchDocuments.mockReset();
    mapSearchHitsToOwnedThreads.mockReset();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
    else process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = prev;
  });

  it("flag off → zero Onyx calls", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "false";
    expect(isCrossThreadContextEnabled()).toBe(false);
    const res = await retrieveCrossThreadContext({
      userId: "u1",
      mailAccountId: "a1",
      currentThreadId: "t-current",
      subject: "PO-1",
      currentMessageCleanText: "handle PO-1",
    });
    expect(res.onyxCalled).toBe(false);
    expect(searchDocuments).not.toHaveBeenCalled();
    expect(res.openaiCalls).toBe(0);
    expect(res.onyxChatCalls).toBe(0);
    expect(res.dbWrites).toBe(0);
  });

  it("flag on → search called; mapping blocked without document_id", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    searchDocuments.mockResolvedValue({
      hits: [
        {
          citationId: 1,
          title: "x",
          content: "y",
          link: null,
          sourceType: "ingestion_api",
          updatedAt: null,
        },
      ],
      requestId: "r1",
      latencyMs: 12,
    });
    mapSearchHitsToOwnedThreads.mockResolvedValue({
      mapped: [],
      stats: {
        totalHits: 1,
        validInternalLinks: 0,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered: { invalid_or_missing_internal_link: 1 },
      },
    });
    const res = await retrieveCrossThreadContext({
      userId: "u1",
      mailAccountId: "a1",
      currentThreadId: "t-current",
      subject: "PO-9",
      currentMessageCleanText: "PO-9 please",
    });
    expect(res.onyxCalled).toBe(true);
    expect(searchDocuments).toHaveBeenCalledTimes(1);
    expect(res.mappedCount).toBe(0);
    expect(res.blocker).toMatch(/internal_source_links|mappable/i);
    expect(res.openaiCalls).toBe(0);
    expect(res.onyxChatCalls).toBe(0);
  });
});

describe("O5C.1 Context Pack budget", () => {
  it("limits sources and respects character budget", () => {
    const sources: ContextSource[] = Array.from({ length: 8 }, (_, i) => ({
      threadId: `t${i}`,
      documentId: `d${i}`,
      occurredAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      participants: ["a@b.c"],
      subject: `S${i}`,
      excerpt: "x".repeat(10_000),
      sourceLink: `/source/thread/t${i}`,
    }));
    const pack = buildContextPack(sources);
    expect(pack.sources.length).toBeLessThanOrEqual(5);
    expect(pack.estimatedChars).toBeLessThanOrEqual(pack.charBudget);
    expect(pack.estimatedTokensApprox).toBeLessThanOrEqual(12_000);
    // chronological
    const times = pack.sources.map((s) => s.occurredAt!);
    expect([...times].sort()).toEqual(times);
  });
});

describe("O5C.1 import hygiene", () => {
  it("cross-thread modules do not import OpenAI or Onyx Chat", async () => {
    const fs = await import("node:fs");
    const files = [
      "src/server/feed/cross-thread-query.ts",
      "src/server/feed/cross-thread-context.ts",
      "src/server/onyx/search.ts",
    ];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      expect(text).not.toMatch(/from ["']openai["']/i);
      expect(text).not.toMatch(/send-chat-message/i);
      expect(text).not.toMatch(/from ["']\.\/chat["']/);
      expect(text).not.toMatch(/from ["']@\/server\/onyx\/chat["']/);
      expect(text).not.toMatch(/createChatClient|askChat/);
    }
  });
});
