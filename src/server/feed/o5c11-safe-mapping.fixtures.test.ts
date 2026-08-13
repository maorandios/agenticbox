/**
 * O5C.1.1 — Safe link parser + ownership mapping fixtures.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => fromMock(table),
  }),
}));

import { parseInternalThreadSourceLink } from "@/server/feed/internal-source-link";
import { mapSearchHitsToOwnedThreads } from "@/server/feed/map-search-hits";
import type { OnyxSearchHit } from "@/server/onyx/search";

const TID = "5f1d5b33-6147-4f45-a4d3-3e9c30fd7703";
const TID2 = "f8c6e04a-d698-4456-a4a3-18055e8e007f";
const USER = "7b897ada-7b9d-4730-b662-028830e55259";
const ACCOUNT = "3083783b-1dc5-453f-924b-3c62f54e150e";
const OTHER_USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_ID = `user:${USER}:thread:${TID}`;

function messagesMock(rows: Array<{ thread_id: string; provider_date_at: string }> = []) {
  return {
    select: () => ({
      eq: () => ({
        in: () => ({
          order: async () => ({ data: rows }),
        }),
      }),
    }),
  };
}

describe("O5C.1.1 parseInternalThreadSourceLink", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  });

  it("accepts relative internal link", () => {
    expect(
      parseInternalThreadSourceLink(`/source/thread/${TID}?message=abc`),
    ).toBe(TID);
  });

  it("accepts absolute internal link with APP origin", () => {
    expect(
      parseInternalThreadSourceLink(
        `http://localhost:3000/source/thread/${TID}`,
      ),
    ).toBe(TID);
  });

  it("rejects foreign origin", () => {
    expect(
      parseInternalThreadSourceLink(
        `https://evil.example/source/thread/${TID}`,
      ),
    ).toBeNull();
  });

  it("rejects invalid UUID", () => {
    expect(parseInternalThreadSourceLink("/source/thread/not-a-uuid")).toBeNull();
  });

  it("ignores query/fragment — never treats them as thread id", () => {
    expect(
      parseInternalThreadSourceLink(
        `/source/thread/${TID}?threadId=${TID2}#${TID2}`,
      ),
    ).toBe(TID);
    expect(
      parseInternalThreadSourceLink(`?threadId=${TID}`),
    ).toBeNull();
  });

  it("rejects extra path segments / traversal", () => {
    expect(
      parseInternalThreadSourceLink(`/source/thread/${TID}/extra`),
    ).toBeNull();
    expect(
      parseInternalThreadSourceLink(`/source/thread/../thread/${TID}`),
    ).toBeNull();
  });
});

describe("O5C.1.1 mapSearchHitsToOwnedThreads", () => {
  beforeEach(() => {
    fromMock.mockReset();
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });

  function hit(over: Partial<OnyxSearchHit> = {}): OnyxSearchHit {
    return {
      citationId: 99,
      title: "t",
      content: "body excerpt about the request",
      link: `/source/thread/${TID}?message=m1`,
      sourceType: "ingestion_api",
      updatedAt: "2026-08-01T00:00:00Z",
      ...over,
    };
  }

  it("maps owned indexed thread; onyxDocumentId from DB only", async () => {
    let threadsDone = false;
    fromMock.mockImplementation((table: string) => {
      if (table === "mail_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: ACCOUNT, user_id: USER, sync_status: "ready" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "threads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => {
                  threadsDone = true;
                  return {
                    data: [
                      {
                        id: TID,
                        user_id: USER,
                        mail_account_id: ACCOUNT,
                      },
                    ],
                  };
                },
              }),
            }),
          }),
        };
      }
      if (table === "onyx_index_state") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      thread_id: TID,
                      onyx_document_id: DOC_ID,
                      status: "indexed",
                      user_id: USER,
                      mail_account_id: ACCOUNT,
                    },
                  ],
                }),
              }),
            }),
          }),
        };
      }
      if (table === "messages") {
        return messagesMock([
          { thread_id: TID, provider_date_at: "2026-07-01T10:00:00.000Z" },
        ]);
      }
      throw new Error(`unexpected table ${table} threadsDone=${threadsDone}`);
    });

    const res = await mapSearchHitsToOwnedThreads({
      hits: [hit({ citationId: 42 })],
      userId: USER,
      mailAccountId: ACCOUNT,
      currentThreadId: TID2,
    });
    expect(res.mapped).toHaveLength(1);
    expect(res.mapped[0]!.onyxDocumentId).toBe(DOC_ID);
    expect(res.mapped[0]!.onyxDocumentId).not.toBe("42");
    expect(res.stats.mappedHits).toBe(1);
  });

  it("blocks other user / other account / missing index / non-indexed / current", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "mail_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: ACCOUNT, user_id: USER, sync_status: "ready" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "threads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    // only TID owned; TID2 not returned → denied
                  ],
                }),
              }),
            }),
          }),
        };
      }
      if (table === "onyx_index_state") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({ data: [] }),
              }),
            }),
          }),
        };
      }
      if (table === "messages") return messagesMock();
      throw new Error(table);
    });

    const res = await mapSearchHitsToOwnedThreads({
      hits: [
        hit({ link: `/source/thread/${TID}` }), // owned missing from threads → denied
        hit({ link: `/source/thread/${TID2}` }),
        hit({ link: `/source/thread/${TID2}` }), // current
      ],
      userId: USER,
      mailAccountId: ACCOUNT,
      currentThreadId: TID2,
    });
    expect(res.mapped).toHaveLength(0);
    expect(res.stats.filtered.current_thread).toBeGreaterThanOrEqual(1);
    expect(res.stats.filtered.thread_ownership_denied).toBeGreaterThanOrEqual(1);
  });

  it("dedupes by thread and limits to 5", async () => {
    const ids = Array.from({ length: 7 }, (_, i) =>
      `00000000-0000-4000-8000-00000000000${i}`,
    );
    fromMock.mockImplementation((table: string) => {
      if (table === "mail_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: ACCOUNT, user_id: USER, sync_status: "ready" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "threads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: ids.map((id) => ({
                    id,
                    user_id: USER,
                    mail_account_id: ACCOUNT,
                  })),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "onyx_index_state") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: ids.map((id) => ({
                    thread_id: id,
                    onyx_document_id: `user:${USER}:thread:${id}`,
                    status: "indexed",
                    user_id: USER,
                    mail_account_id: ACCOUNT,
                  })),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "messages") return messagesMock();
      throw new Error(table);
    });

    const hits: OnyxSearchHit[] = [
      ...ids.flatMap((id) => [
        hit({ link: `/source/thread/${id}`, content: `a-${id}` }),
        hit({ link: `/source/thread/${id}`, content: `b-${id}` }),
      ]),
    ];
    const res = await mapSearchHitsToOwnedThreads({
      hits,
      userId: USER,
      mailAccountId: ACCOUNT,
      currentThreadId: TID,
    });
    expect(res.mapped.length).toBe(5);
    expect(new Set(res.mapped.map((m) => m.threadId)).size).toBe(5);
  });

  it("never uses citation id for ownership", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "mail_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: ACCOUNT, user_id: USER, sync_status: "ready" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "threads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({ data: [] }),
              }),
            }),
          }),
        };
      }
      if (table === "onyx_index_state") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({ data: [] }),
              }),
            }),
          }),
        };
      }
      if (table === "messages") return messagesMock();
      throw new Error(table);
    });
    const res = await mapSearchHitsToOwnedThreads({
      hits: [hit({ citationId: TID, link: null })],
      userId: USER,
      mailAccountId: ACCOUNT,
      currentThreadId: TID2,
    });
    expect(res.mapped).toHaveLength(0);
    expect(res.stats.filtered.invalid_or_missing_internal_link).toBe(1);
  });

  it("blocks non-indexed state and missing index", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "mail_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: ACCOUNT, user_id: USER, sync_status: "ready" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "threads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    { id: TID, user_id: USER, mail_account_id: ACCOUNT },
                    { id: TID2, user_id: USER, mail_account_id: ACCOUNT },
                  ],
                }),
              }),
            }),
          }),
        };
      }
      if (table === "onyx_index_state") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    {
                      thread_id: TID,
                      onyx_document_id: DOC_ID,
                      status: "pending",
                      user_id: USER,
                      mail_account_id: ACCOUNT,
                    },
                    // TID2 missing
                  ],
                }),
              }),
            }),
          }),
        };
      }
      if (table === "messages") return messagesMock();
      throw new Error(table);
    });
    const res = await mapSearchHitsToOwnedThreads({
      hits: [
        hit({ link: `/source/thread/${TID}` }),
        hit({ link: `/source/thread/${TID2}` }),
      ],
      userId: USER,
      mailAccountId: ACCOUNT,
      currentThreadId: OTHER_USER,
    });
    expect(res.mapped).toHaveLength(0);
    expect(res.stats.filtered.index_status_not_ready).toBe(1);
    expect(res.stats.filtered.missing_onyx_index_state).toBe(1);
  });
});
