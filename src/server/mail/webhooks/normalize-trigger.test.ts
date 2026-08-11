import { describe, expect, it } from "vitest";
import { normalizeWebhookType } from "@/server/mail/webhooks/normalize-trigger";

describe("normalizeWebhookType", () => {
  it("returns base type without suffixes", () => {
    expect(normalizeWebhookType("message.created")).toEqual({
      eventType: "message.created",
      eventTypeBase: "message.created",
      suffixFlags: {},
    });
  });

  it("strips combined suffixes from the end", () => {
    expect(
      normalizeWebhookType("message.created.cleaned.transformed.truncated"),
    ).toEqual({
      eventType: "message.created.cleaned.transformed.truncated",
      eventTypeBase: "message.created",
      suffixFlags: {
        cleaned: true,
        transformed: true,
        truncated: true,
      },
    });
  });

  it("handles grant triggers unchanged", () => {
    expect(normalizeWebhookType("grant.expired").eventTypeBase).toBe(
      "grant.expired",
    );
  });

  it("lowercases for base comparison", () => {
    expect(normalizeWebhookType("Message.Created.Truncated")).toMatchObject({
      eventTypeBase: "message.created",
      suffixFlags: { truncated: true },
    });
  });
});
