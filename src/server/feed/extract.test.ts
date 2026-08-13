import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const parseMock = vi.fn();

vi.mock("@/server/feed/openai-client", () => ({
  getFeedOpenAiClient: () => ({
    responses: { parse: parseMock },
  }),
  resetFeedOpenAiClientForTests: vi.fn(),
}));

import { extractFeedFromContext } from "@/server/feed/extract";
import type { FeedThreadContext } from "@/server/feed/context";
import { emptyIntelligenceState } from "@/server/feed/schemas";
import { resetFeedCircuit } from "@/server/feed/circuit";

function ctx(): FeedThreadContext {
  return {
    userId: "u1",
    mailAccountId: "a1",
    threadId: "t1",
    accountEmail: "me@example.com",
    accountIdentities: [{ email: "me@example.com", type: "primary" }],
    subject: "נושא",
    messages: [
      {
        id: "m1",
        subject: "נושא",
        sentAt: "2026-08-01T10:00:00.000Z",
        fromEmail: "a@example.com",
        fromName: "אבי",
        toEmails: ["me@example.com"],
        ccEmails: [],
        bccEmails: [],
        replyToEmail: null,
        direction: "inbound",
        isAccountOwner: false,
        accountRelation: "sent_to_account",
        body: "נא לאשר",
        removedNormalized: [],
        toParticipants: [
          { email: "me@example.com", displayName: null, isMailboxOwner: true },
        ],
        ccParticipants: [],
        bccParticipants: [],
      },
    ],
    includedMessageIds: ["m1"],
    previousState: emptyIntelligenceState(),
    existingItems: [],
    sourceContentHash: "hash",
    contextCoverage: "full",
    triggerMessageId: null,
    mailboxIdentity: {
      mailAccountId: "a1",
      primaryEmail: "me@example.com",
      verifiedAliases: [],
      canonicalDisplayName: "me",
    },
  };
}

describe("extractFeedFromContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFeedCircuit();
    process.env.OPENAI_FEED_MODEL = "gpt-4o-mini";
  });

  it("makes a single responses.parse call and records actual model", async () => {
    parseMock.mockResolvedValue({
      id: "resp_1",
      model: "gpt-4o-mini-2024-07-18",
      status: "completed",
      error: null,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      output_parsed: {
        threadClassification: "business",
        skipReason: null,
        items: [],
        nextState: emptyIntelligenceState(),
      },
    });
    const result = await extractFeedFromContext(ctx());
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe("gpt-4o-mini");
      expect(result.actualModel).toBe("gpt-4o-mini-2024-07-18");
      expect(result.totalTokens).toBe(15);
    }
  });

  it("maps missing parsed output", async () => {
    parseMock.mockResolvedValue({
      id: "resp_2",
      model: "gpt-4o-mini",
      status: "completed",
      error: null,
      usage: null,
      output_parsed: null,
    });
    const result = await extractFeedFromContext(ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("openai_unparsed");
  });

  it("trips circuit on model_not_found", async () => {
    parseMock.mockRejectedValue(
      Object.assign(new Error("model_not_found"), { status: 403 }),
    );
    const result = await extractFeedFromContext(ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.circuitTripped).toBe(true);
      expect(result.errorCode).toBe("openai_model_unavailable");
    }
  });
});
