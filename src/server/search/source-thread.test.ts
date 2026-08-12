import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getMailAccountForUser = vi.fn();
const getThreadForUser = vi.fn();
const getMessagesForThreadOwned = vi.fn();
const fromMock = vi.fn();

vi.mock("@/server/mail/account-service", () => ({
  getMailAccountForUser: (...a: unknown[]) => getMailAccountForUser(...a),
}));
vi.mock("@/server/mail/read/threads", () => ({
  getThreadForUser: (...a: unknown[]) => getThreadForUser(...a),
}));
vi.mock("@/server/mail/read/messages", () => ({
  getMessagesForThreadOwned: (...a: unknown[]) => getMessagesForThreadOwned(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: fromMock }),
}));

import { loadSourceThreadForUser } from "@/server/search/source-thread";

describe("Source Viewer authorization", () => {
  it("returns not_found when thread is outside active account", async () => {
    getMailAccountForUser.mockResolvedValue({ id: "acc-active" });
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await loadSourceThreadForUser({
      userId: "u1",
      threadId: "foreign-thread",
    });
    expect(result.status).toBe("not_found");
    expect(getThreadForUser).not.toHaveBeenCalled();
  });

  it("returns no_account when disconnected", async () => {
    getMailAccountForUser.mockResolvedValue(null);
    const result = await loadSourceThreadForUser({
      userId: "u1",
      threadId: "t1",
    });
    expect(result.status).toBe("no_account");
  });
});
