import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/server/search/ask", () => ({
  askMailboxQuestion: vi.fn(),
}));
vi.mock("@/server/mail/account-dto", () => ({
  assertNoSecretLeak: vi.fn(),
}));

import { requireUser } from "@/server/auth/require-user";
import { askMailboxQuestion } from "@/server/search/ask";
import { POST } from "@/app/api/search/ask/route";

describe("POST /api/search/ask auth", () => {
  const prev = process.env.ONYX_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ONYX_ENABLED = "true";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ONYX_ENABLED;
    else process.env.ONYX_ENABLED = prev;
  });

  it("returns 503 when Onyx is suspended", async () => {
    process.env.ONYX_ENABLED = "false";
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "u1" } as never,
      supabase: {} as never,
    });
    const res = await POST(
      new Request("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ question: "שלום" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "onyx_disabled" });
    expect(askMailboxQuestion).not.toHaveBeenCalled();
  });

  it("returns 401 without session", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: null, supabase: {} as never });
    const res = await POST(
      new Request("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ question: "שלום" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects client-supplied user_id", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "u1" } as never,
      supabase: {} as never,
    });
    const res = await POST(
      new Request("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ question: "שלום", user_id: "other" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(askMailboxQuestion).not.toHaveBeenCalled();
  });

  it("passes session user id only", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "u1" } as never,
      supabase: {} as never,
    });
    vi.mocked(askMailboxQuestion).mockResolvedValue({
      status: "answered",
      answer: "ok",
      chatSessionId: null,
      requestId: "r",
      latencyMs: 1,
      sources: [],
    });
    const res = await POST(
      new Request("http://localhost/api/search/ask", {
        method: "POST",
        body: JSON.stringify({ question: "מה נסגר?" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(askMailboxQuestion).toHaveBeenCalledWith({
      userId: "u1",
      question: "מה נסגר?",
      chatSessionId: null,
    });
  });
});
