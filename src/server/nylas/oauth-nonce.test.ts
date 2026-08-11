import { describe, expect, it } from "vitest";
import { createOauthNonce } from "@/server/nylas/oauth-nonce";

describe("oauth nonce", () => {
  it("creates unique high-entropy nonces", () => {
    const a = createOauthNonce();
    const b = createOauthNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
