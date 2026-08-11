import { describe, expect, it } from "vitest";
import { resolveDirection } from "@/server/mail/sync/direction";
import { getSyncConcurrency } from "@/server/mail/sync/types";
import { mapPool } from "@/server/mail/sync/rate-limit";

describe("resolveDirection", () => {
  it("marks outbound when from matches account or alias", () => {
    expect(
      resolveDirection({
        from: [{ email: "Me@Example.com" }],
        accountEmail: "me@example.com",
        aliases: [],
      }),
    ).toBe("outbound");

    expect(
      resolveDirection({
        from: [{ email: "alias@example.com" }],
        accountEmail: "me@example.com",
        aliases: ["alias@example.com"],
      }),
    ).toBe("outbound");
  });

  it("marks inbound for external senders", () => {
    expect(
      resolveDirection({
        from: [{ email: "other@example.com" }],
        accountEmail: "me@example.com",
        aliases: [],
      }),
    ).toBe("inbound");
  });
});

describe("sync concurrency bound", () => {
  it("caps concurrency at 3", () => {
    expect(getSyncConcurrency()).toBeLessThanOrEqual(3);
  });

  it("never runs more than 3 workers at once", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapPool(items, 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
