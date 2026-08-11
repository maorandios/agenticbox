import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { redactSecrets, safeErrorMessage } from "@/server/onyx/redact";

describe("redactSecrets", () => {
  it("redacts provided secrets and bearer tokens", () => {
    const secret = "on_tenant_abc.super-secret-value";
    const input = `Authorization: Bearer ${secret} failed for ${secret}`;
    const out = redactSecrets(input, [secret]);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  it("safeErrorMessage never echoes secrets", () => {
    const secret = "on_tenant_xyz.hidden";
    process.env.ONYX_CHAT_API_KEY = secret;
    const msg = safeErrorMessage(new Error(`boom ${secret}`));
    expect(msg).not.toContain(secret);
    delete process.env.ONYX_CHAT_API_KEY;
  });
});
