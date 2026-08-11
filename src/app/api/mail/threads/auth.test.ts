import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ user: null, supabase: null })),
}));

vi.mock("@/server/mail/read/threads", () => ({
  listThreadsForUser: vi.fn(),
  getThreadForUser: vi.fn(),
  countAttachmentsForThread: vi.fn(),
}));

vi.mock("@/server/mail/read/messages", () => ({
  getMessagesForThreadOwned: vi.fn(),
}));

vi.mock("@/server/mail/read/attachments", () => ({
  downloadOwnedAttachment: vi.fn(),
}));

vi.mock("@/server/mail/account-dto", () => ({
  assertNoSecretLeak: vi.fn(),
}));

describe("mail read API auth", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("GET /api/mail/threads returns 401 without session", async () => {
    const { GET } = await import("@/app/api/mail/threads/route");
    const res = await GET(
      new Request("http://localhost/api/mail/threads?mailbox=inbox"),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("GET /api/mail/threads/[threadId] returns 401 without session", async () => {
    const { GET } = await import("@/app/api/mail/threads/[threadId]/route");
    const res = await GET(new Request("http://localhost/api/mail/threads/x"), {
      params: Promise.resolve({ threadId: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/mail/attachments/[id] returns 401 without session", async () => {
    const { GET } = await import("@/app/api/mail/attachments/[id]/route");
    const res = await GET(new Request("http://localhost/api/mail/attachments/x"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
