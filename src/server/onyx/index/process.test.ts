import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  fromMock,
  buildNormalizedThreadDocument,
  upsertDocument,
  deleteDocument,
  MockOnyxError,
} = vi.hoisted(() => {
  class MockOnyxError extends Error {
    code: string;
    retryable: boolean;
    constructor(opts: {
      code: string;
      message: string;
      retryable?: boolean;
      requestId: string;
    }) {
      super(opts.message);
      this.name = "OnyxError";
      this.code = opts.code;
      this.retryable = Boolean(opts.retryable);
    }
  }
  return {
    fromMock: vi.fn(),
    buildNormalizedThreadDocument: vi.fn(),
    upsertDocument: vi.fn(),
    deleteDocument: vi.fn(),
    MockOnyxError,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: fromMock,
    rpc: vi.fn(),
  }),
}));

vi.mock("@/server/onyx/index/load-thread", () => ({
  buildNormalizedThreadDocument: (...args: unknown[]) =>
    buildNormalizedThreadDocument(...args),
}));

vi.mock("@/server/onyx/adapter", () => ({
  upsertDocument: (...args: unknown[]) => upsertDocument(...args),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
  OnyxError: MockOnyxError,
}));

vi.mock("@/server/onyx/log", () => ({
  onyxLog: vi.fn(),
}));

import { processDeleteJob, processIndexJob } from "@/server/onyx/index/process";

function makeClient(selectResult: { data: unknown; error?: unknown }) {
  const resolvedUpdate = Promise.resolve({ data: null, error: null });
  const eqAfterUpdate = vi.fn(() => ({
    eq: vi.fn(() => resolvedUpdate),
    then: resolvedUpdate.then.bind(resolvedUpdate),
  }));

  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => selectResult),
        })),
      })),
    })),
    update: vi.fn(() => ({
      eq: eqAfterUpdate,
    })),
  };
}

describe("processIndexJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ONYX_INDEX_MAX_ATTEMPTS = "3";
  });

  it("skips upsert when hash unchanged and status indexed", async () => {
    fromMock.mockImplementation(() =>
      makeClient({
        data: {
          id: "s1",
          content_hash: "abc",
          status: "indexed",
          attempt_count: 0,
          onyx_document_id: "user:u:thread:t",
        },
      }),
    );

    buildNormalizedThreadDocument.mockResolvedValue({
      id: "user:u:thread:t",
      semanticIdentifier: "s",
      title: "s",
      sections: [{ text: "x", link: "/source/thread/t?message=m" }],
      metadata: { source_type: "email_thread" },
      contentHash: "abc",
      quality: {
        sectionCount: 1,
        plainTextFallbackCount: 1,
        cleanConversationCount: 0,
      },
    });

    const result = await processIndexJob({
      type: "onyx_index_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
    });

    expect(result).toBe("skipped");
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it("skips upsert when hash unchanged even if re-queued as pending", async () => {
    fromMock.mockImplementation(() =>
      makeClient({
        data: {
          id: "s1",
          content_hash: "abc",
          status: "pending",
          attempt_count: 0,
          onyx_document_id: "user:u:thread:t",
        },
      }),
    );

    buildNormalizedThreadDocument.mockResolvedValue({
      id: "user:u:thread:t",
      semanticIdentifier: "s",
      title: "s",
      sections: [{ text: "x", link: "/source/thread/t?message=m" }],
      metadata: { source_type: "email_thread" },
      contentHash: "abc",
      quality: {
        sectionCount: 1,
        plainTextFallbackCount: 1,
        cleanConversationCount: 0,
      },
    });

    const result = await processIndexJob({
      type: "onyx_index_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
    });

    expect(result).toBe("skipped");
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it("upserts when hash changed", async () => {
    fromMock.mockImplementation(() =>
      makeClient({
        data: {
          id: "s1",
          content_hash: "old",
          status: "indexed",
          attempt_count: 0,
          onyx_document_id: "user:u:thread:t",
        },
      }),
    );

    buildNormalizedThreadDocument.mockResolvedValue({
      id: "user:u:thread:t",
      semanticIdentifier: "s",
      title: "s",
      sections: [{ text: "x", link: "/source/thread/t?message=m" }],
      metadata: { source_type: "email_thread" },
      contentHash: "new",
      quality: {
        sectionCount: 1,
        plainTextFallbackCount: 1,
        cleanConversationCount: 0,
      },
    });
    upsertDocument.mockResolvedValue({
      documentId: "user:u:thread:t",
      alreadyExisted: true,
    });

    const result = await processIndexJob({
      type: "onyx_index_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
    });

    expect(result).toBe("indexed");
    expect(upsertDocument).toHaveBeenCalledOnce();
  });

  it("fails ownership miss as non-retryable terminal", async () => {
    fromMock.mockImplementation(() =>
      makeClient({
        data: {
          id: "s1",
          content_hash: null,
          status: "pending",
          attempt_count: 0,
          onyx_document_id: "user:u:thread:t",
        },
      }),
    );
    buildNormalizedThreadDocument.mockResolvedValue(null);

    const result = await processIndexJob({
      type: "onyx_index_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
    });

    expect(result).toBe("failed");
    expect(upsertDocument).not.toHaveBeenCalled();
  });

  it("retries retryable adapter errors under max attempts", async () => {
    fromMock.mockImplementation(() =>
      makeClient({
        data: {
          id: "s1",
          content_hash: null,
          status: "pending",
          attempt_count: 0,
          onyx_document_id: "user:u:thread:t",
        },
      }),
    );
    buildNormalizedThreadDocument.mockResolvedValue({
      id: "user:u:thread:t",
      semanticIdentifier: "s",
      title: "s",
      sections: [{ text: "x", link: "/l" }],
      metadata: {},
      contentHash: "h",
      quality: {
        sectionCount: 1,
        plainTextFallbackCount: 1,
        cleanConversationCount: 0,
      },
    });
    upsertDocument.mockRejectedValue(
      new MockOnyxError({
        code: "rate_limit",
        message: "rate limited",
        retryable: true,
        requestId: "test",
      }),
    );

    const result = await processIndexJob({
      type: "onyx_index_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
    });

    expect(result).toBe("retry");
  });
});

describe("processDeleteJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ONYX_INDEX_MAX_ATTEMPTS = "3";
  });

  it("marks deleted after adapter delete", async () => {
    fromMock.mockImplementation(() => makeClient({ data: { attempt_count: 0 } }));
    deleteDocument.mockResolvedValue({ deleted: true });

    const result = await processDeleteJob({
      type: "onyx_delete_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
      onyxDocumentId: "user:u:thread:t",
    });

    expect(result).toBe("deleted");
    expect(deleteDocument).toHaveBeenCalledWith("user:u:thread:t");
  });
});
