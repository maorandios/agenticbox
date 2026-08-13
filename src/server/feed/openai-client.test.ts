import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

describe("OpenAI feed client options", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    delete process.env.FEED_AI_TIMEOUT_MS;
  });

  it("constructs client with maxRetries 0", async () => {
    const ctor = vi.fn().mockImplementation(function OpenAI(this: unknown, opts: unknown) {
      return { opts, responses: { parse: vi.fn() } };
    });
    vi.doMock("openai", () => ({ default: ctor }));
    const { getFeedOpenAiClient, resetFeedOpenAiClientForTests } = await import(
      "@/server/feed/openai-client"
    );
    resetFeedOpenAiClientForTests();
    getFeedOpenAiClient();
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-not-real",
        maxRetries: 0,
        timeout: 120_000,
      }),
    );
  });
});
