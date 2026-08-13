import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/server/feed/list", () => ({
  listFeedForUser: vi.fn(),
  patchFeedItemForUser: vi.fn(),
}));

import { requireUser } from "@/server/auth/require-user";
import { listFeedForUser, patchFeedItemForUser } from "@/server/feed/list";
import { GET } from "@/app/api/feed/route";
import { PATCH } from "@/app/api/feed/[feedItemId]/route";

describe("Feed API auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET requires session", async () => {
    vi.mocked(requireUser).mockResolvedValue({ user: null, supabase: {} as never });
    const res = await GET(new Request("http://localhost/api/feed"));
    expect(res.status).toBe(401);
    expect(listFeedForUser).not.toHaveBeenCalled();
  });

  it("PATCH returns not_found for foreign item", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "u1" } as never,
      supabase: {} as never,
    });
    vi.mocked(patchFeedItemForUser).mockResolvedValue("not_found");
    const res = await PATCH(
      new Request("http://localhost/api/feed/x", {
        method: "PATCH",
        body: JSON.stringify({ status: "handled" }),
      }),
      { params: Promise.resolve({ feedItemId: "x" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("Feed worker auth", () => {
  it("rejects missing bearer", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/internal/feed/worker/route");
    const res = await POST(new Request("http://localhost/api/internal/feed/worker", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});
