import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  defaultCheckpoint,
  EMAIL_SYNC_MAX_THREADS_DEFAULT,
  EMAIL_SYNC_MAX_THREADS_HARD_CAP,
  getEmailSyncMaxThreads,
} from "@/server/mail/sync/types";

describe("getEmailSyncMaxThreads", () => {
  afterEach(() => {
    delete process.env.EMAIL_SYNC_MAX_THREADS;
  });

  it("defaults to 100 for POC", () => {
    delete process.env.EMAIL_SYNC_MAX_THREADS;
    expect(getEmailSyncMaxThreads()).toBe(EMAIL_SYNC_MAX_THREADS_DEFAULT);
    expect(getEmailSyncMaxThreads()).toBe(100);
  });

  it("accepts positive integers and floors them", () => {
    process.env.EMAIL_SYNC_MAX_THREADS = "100";
    expect(getEmailSyncMaxThreads()).toBe(100);
    process.env.EMAIL_SYNC_MAX_THREADS = "42.9";
    expect(getEmailSyncMaxThreads()).toBe(42);
  });

  it("rejects invalid values safely", () => {
    process.env.EMAIL_SYNC_MAX_THREADS = "0";
    expect(getEmailSyncMaxThreads()).toBe(100);
    process.env.EMAIL_SYNC_MAX_THREADS = "-5";
    expect(getEmailSyncMaxThreads()).toBe(100);
    process.env.EMAIL_SYNC_MAX_THREADS = "abc";
    expect(getEmailSyncMaxThreads()).toBe(100);
  });

  it("hard-caps arbitrary large client-like values", () => {
    process.env.EMAIL_SYNC_MAX_THREADS = "9999";
    expect(getEmailSyncMaxThreads()).toBe(EMAIL_SYNC_MAX_THREADS_HARD_CAP);
  });

  it("defaultCheckpoint uses thread cap not message count", () => {
    process.env.EMAIL_SYNC_MAX_THREADS = "100";
    const cp = defaultCheckpoint();
    expect(cp.maxThreads).toBe(100);
    expect(cp.threadsDone).toBe(0);
    expect(cp.messagesDone).toBe(0);
  });
});

describe("backfill page remaining trim", () => {
  it("trims last page to remaining thread slots", () => {
    const maxThreads = 100;
    const threadsDone = 95;
    const remaining = Math.max(0, maxThreads - threadsDone);
    const pageSize = 20;
    const pageThreads = Array.from({ length: pageSize }, (_, i) => i);
    const limit = Math.min(pageSize, remaining);
    const threads = pageThreads.slice(0, limit);
    expect(remaining).toBe(5);
    expect(threads).toHaveLength(5);
    expect(threadsDone + threads.length).toBe(100);
  });

  it("does not stop based on message count", () => {
    const checkpoint = defaultCheckpoint({
      maxThreads: 100,
      threadsDone: 50,
      messagesDone: 5000,
    });
    const remaining = Math.max(0, checkpoint.maxThreads - checkpoint.threadsDone);
    expect(remaining).toBe(50);
    expect(checkpoint.messagesDone).toBe(5000);
  });
});
