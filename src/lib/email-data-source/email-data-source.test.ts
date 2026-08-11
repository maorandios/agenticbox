import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiEmailDataSource,
  MockEmailDataSource,
  createEmailDataSource,
  getEmailDataSourceMode,
  resetEmailDataSourceForTests,
} from "@/lib/email-data-source";

afterEach(() => {
  resetEmailDataSourceForTests();
  vi.unstubAllEnvs();
});

describe("email data source mode", () => {
  it("defaults to mock", () => {
    vi.stubEnv("NEXT_PUBLIC_EMAIL_DATA_SOURCE", undefined);
    expect(getEmailDataSourceMode()).toBe("mock");
    expect(createEmailDataSource()).toBeInstanceOf(MockEmailDataSource);
  });

  it("selects api when flagged", () => {
    vi.stubEnv("NEXT_PUBLIC_EMAIL_DATA_SOURCE", "api");
    expect(getEmailDataSourceMode()).toBe("api");
    expect(createEmailDataSource()).toBeInstanceOf(ApiEmailDataSource);
  });
});

describe("MockEmailDataSource", () => {
  it("pages threads with a cursor", async () => {
    const ds = new MockEmailDataSource();
    const first = await ds.listThreads("inbox", { limit: 2 });
    expect(first.threads).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = await ds.listThreads("inbox", {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.threads).toHaveLength(2);
    expect(second.threads[0]?.id).not.toBe(first.threads[0]?.id);
  });

  it("supports mock AI surfaces", async () => {
    const ds = new MockEmailDataSource();
    expect(ds.supportsMockAi()).toBe(true);
    const snapshot = await ds.getThreadSnapshot("thr-cityhub");
    expect(snapshot?.threadId).toBeTruthy();
  });

  it("never exposes a grant id on the account summary", async () => {
    const account = await new MockEmailDataSource().getMailAccount();
    expect(account).toBeTruthy();
    expect(account).not.toHaveProperty("nylasGrantId");
    expect(JSON.stringify(account)).not.toMatch(/grant/i);
  });
});

describe("ApiEmailDataSource skeleton", () => {
  it("disables mock AI and returns null snapshots", async () => {
    const ds = new ApiEmailDataSource();
    expect(ds.supportsMockAi()).toBe(false);
    expect(await ds.getThreadSnapshot("any")).toBeNull();
  });
});
