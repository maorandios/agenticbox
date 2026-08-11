import { describe, expect, it } from "vitest";
import { GMAIL_READONLY_SCOPES } from "@/server/nylas/scopes";

describe("gmail readonly scopes", () => {
  it("requests read-only google scopes only", () => {
    expect(GMAIL_READONLY_SCOPES).toContain(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(GMAIL_READONLY_SCOPES).toContain(
      "https://www.googleapis.com/auth/userinfo.email",
    );
    expect(GMAIL_READONLY_SCOPES.join(" ")).not.toMatch(/gmail\.send|gmail\.modify|gmail\.compose/i);
  });
});
