import { describe, expect, it } from "vitest";
import { parseRetryAfterMs } from "@/server/mail/sync/rate-limit";

describe("parseRetryAfterMs", () => {
  it("returns null for non-429", () => {
    expect(parseRetryAfterMs({ status: 500 })).toBeNull();
  });

  it("parses retry-after seconds", () => {
    expect(
      parseRetryAfterMs({
        status: 429,
        headers: { "retry-after": "2" },
      }),
    ).toBe(2000);
  });
});
