import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getMailAccountForUser = vi.fn();
const getIndexProgress = vi.fn();
const onyxAsk = vi.fn();
const fromMock = vi.fn();

vi.mock("@/server/mail/account-service", () => ({
  getMailAccountForUser: (...args: unknown[]) => getMailAccountForUser(...args),
}));
vi.mock("@/server/onyx/index/progress", () => ({
  getIndexProgress: (...args: unknown[]) => getIndexProgress(...args),
}));
vi.mock("@/server/onyx/adapter", () => ({
  ask: (...args: unknown[]) => onyxAsk(...args),
}));
vi.mock("@/server/onyx/log", () => ({ onyxLog: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

import { askMailboxQuestion } from "@/server/search/ask";

function chain(result: { data: unknown; error?: unknown }) {
  const resolved = Promise.resolve(result);
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => resolved),
        })),
        in: vi.fn(() => resolved),
      })),
      in: vi.fn(() => resolved),
    })),
  };
}

describe("askMailboxQuestion ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMailAccountForUser.mockResolvedValue({
      id: "acc-1",
      syncStatus: "ready",
    });
    getIndexProgress.mockResolvedValue({
      total: 100,
      indexed: 100,
      pending: 0,
      processing: 0,
      failed: 0,
      stale: 0,
      deleting: 0,
      deleted: 0,
    });
  });

  it("returns insufficient_evidence when citations cannot be mapped", async () => {
    onyxAsk.mockResolvedValue({
      status: "answered",
      answer: "secret",
      chatSessionId: "s1",
      requestId: "r1",
      latencyMs: 10,
      sources: [{ documentId: "foreign-doc", link: null, blurb: "x" }],
    });
    fromMock.mockImplementation(() => chain({ data: [] }));

    const result = await askMailboxQuestion({
      userId: "u1",
      question: "מה נסגר?",
    });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.sources).toEqual([]);
    expect(result.answer).not.toContain("secret");
  });

  it("maps owned citations to source DTOs without exposing onyx ids", async () => {
    onyxAsk.mockResolvedValue({
      status: "answered",
      answer: "הנושא נסגר.",
      chatSessionId: "s1",
      requestId: "r1",
      latencyMs: 12,
      sources: [
        {
          documentId: "user:u1:thread:t1",
          link: "/source/thread/t1?message=m1",
          blurb: "snippet text",
        },
      ],
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "onyx_index_state") {
        return chain({
          data: [
            {
              onyx_document_id: "user:u1:thread:t1",
              thread_id: "t1",
              mail_account_id: "acc-1",
              user_id: "u1",
              status: "indexed",
            },
          ],
        });
      }
      return chain({
        data: [
          {
            id: "t1",
            subject: "נושא",
            snippet: "קטע",
            latest_message_at: "2024-01-01T00:00:00.000Z",
            message_count: 2,
            participants_summary: [{ email: "a@b.c", name: "A" }],
          },
        ],
      });
    });

    const result = await askMailboxQuestion({
      userId: "u1",
      question: "מה נסגר?",
    });
    expect(result.status).toBe("answered");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].threadId).toBe("t1");
    expect(result.sources[0].sourceUrl).toContain("/source/thread/t1");
    expect(JSON.stringify(result)).not.toMatch(/user:u1:thread:t1/);
    expect(onyxAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataFilters: expect.arrayContaining([
          { tag_key: "user_id", tag_value: "u1" },
          { tag_key: "mail_account_id", tag_value: "acc-1" },
        ]),
      }),
    );
  });

  it("blocks ask when no indexed data", async () => {
    getIndexProgress.mockResolvedValue({
      total: 0,
      indexed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      stale: 0,
      deleting: 0,
      deleted: 0,
    });
    const result = await askMailboxQuestion({
      userId: "u1",
      question: "שלום",
    });
    expect(result.status).toBe("no_indexed_data");
    expect(onyxAsk).not.toHaveBeenCalled();
  });
});
