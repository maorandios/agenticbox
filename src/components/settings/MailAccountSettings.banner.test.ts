import { describe, expect, it } from "vitest";
import {
  ACTION_BANNER_AUTO_DISMISS_MS,
  syncTerminalBanner,
} from "./MailAccountSettings";

describe("syncTerminalBanner", () => {
  it("returns completed copy only for ready", () => {
    expect(syncTerminalBanner("ready")).toBe("הסנכרון הושלם.");
  });

  it("returns failure copy for error and never success", () => {
    expect(syncTerminalBanner("error")).toBe("הסנכרון נכשל. ניתן לנסות שוב.");
    expect(syncTerminalBanner("error")).not.toContain("הושלם");
  });

  it("returns null while syncing or pending", () => {
    expect(syncTerminalBanner("syncing")).toBeNull();
    expect(syncTerminalBanner("pending")).toBeNull();
  });

  it("auto-dismiss window is a few seconds", () => {
    expect(ACTION_BANNER_AUTO_DISMISS_MS).toBeGreaterThanOrEqual(3000);
    expect(ACTION_BANNER_AUTO_DISMISS_MS).toBeLessThanOrEqual(10_000);
  });
});
