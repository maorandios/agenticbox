import { describe, expect, it } from "vitest";
import type { OnyxDeleteThreadJob, OnyxIndexThreadJob } from "@/server/onyx/index/types";

describe("onyx job payloads", () => {
  it("index job contains identifiers only", () => {
    const job: OnyxIndexThreadJob = {
      type: "onyx_index_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
    };
    const keys = Object.keys(job).sort();
    expect(keys).toEqual(["mailAccountId", "threadId", "type", "userId"]);
    expect(JSON.stringify(job)).not.toMatch(/subject|body|email|html|token/i);
  });

  it("delete job contains identifiers only", () => {
    const job: OnyxDeleteThreadJob = {
      type: "onyx_delete_thread",
      userId: "u",
      mailAccountId: "a",
      threadId: "t",
      onyxDocumentId: "user:u:thread:t",
    };
    const keys = Object.keys(job).sort();
    expect(keys).toEqual([
      "mailAccountId",
      "onyxDocumentId",
      "threadId",
      "type",
      "userId",
    ]);
  });
});
