/**
 * O5A.4 blind evaluation unit tests — no OpenAI, no DB writes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  O5A4_EXCLUDED_THREAD_IDS,
  O5A4_HARD_CAP,
  O5A4_PERSIST_MODE,
  O5A4_SELECTION_SEED,
} from "./constants";
import {
  assertEngineHashesUnchanged,
  freezeExtractionEngineHashes,
  selectionHash,
} from "./engine-hash";
import { dryRunGuaranteesNoFeedItemWrites, type FeedDryRunResult } from "./dry-run";
import {
  filterPreviouslySeenThreads,
  resolveBlindBatchThreads,
  selectBlindThreadsDeterministic,
} from "./selection";

describe("O5A.4 blind selection", () => {
  it("selection hash is SHA256(seed:threadId)", () => {
    const tid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const expected = createHash("sha256")
      .update(`${O5A4_SELECTION_SEED}:${tid}`, "utf8")
      .digest("hex");
    expect(selectionHash(O5A4_SELECTION_SEED, tid)).toBe(expected);
  });

  it("deterministic ordering by hash, independent of input order", () => {
    const eligible = [
      { threadId: "t-zzz", classification: "business_conversation" as const },
      { threadId: "t-aaa", classification: "important_transactional" as const },
      { threadId: "t-mmm", classification: "business_conversation" as const },
    ];
    const a = selectBlindThreadsDeterministic({
      seed: O5A4_SELECTION_SEED,
      eligible,
    });
    const b = selectBlindThreadsDeterministic({
      seed: O5A4_SELECTION_SEED,
      eligible: [...eligible].reverse(),
    });
    expect(a.map((x) => x.threadId)).toEqual(b.map((x) => x.threadId));
    const hashes = a.map((x) => x.selectionHash);
    expect(hashes).toEqual([...hashes].sort());
  });

  it("hard cap is 20", () => {
    const eligible = Array.from({ length: 40 }, (_, i) => ({
      threadId: `thread-${i.toString().padStart(3, "0")}`,
      classification: "business_conversation" as const,
    }));
    const selected = selectBlindThreadsDeterministic({
      seed: O5A4_SELECTION_SEED,
      eligible,
      hardCap: O5A4_HARD_CAP,
    });
    expect(selected).toHaveLength(20);
  });

  it("excludes previously seen and golden threads", () => {
    const filtered = filterPreviouslySeenThreads({
      threadIds: [
        "new-1",
        O5A4_EXCLUDED_THREAD_IDS[0],
        "seen-1",
        "new-2",
      ],
      seenThreadIds: ["seen-1"],
    });
    expect(filtered).toEqual(["new-1", "new-2"]);
  });

  it("failed thread is not replaced from alternate pool", () => {
    const locked = ["a", "b", "c"];
    const next = resolveBlindBatchThreads({
      lockedThreadIds: locked,
      failedThreadIds: ["b"],
      alternatePool: ["x", "y", "z"],
    });
    expect(next).toEqual(locked);
    expect(next).not.toContain("x");
  });
});

describe("O5A.4 dry_run guarantees", () => {
  it("persistMode dry_run reports zero feed_items mutations", () => {
    const result: FeedDryRunResult = {
      persistMode: O5A4_PERSIST_MODE,
      status: "completed",
      outcome: "completed_zero_insight",
      runId: "r1",
      threadId: "t1",
      prefilterClassification: "business_conversation",
      modelThreadClassification: "business",
      errorCode: null,
      actualModel: "gpt-4o-mini",
      latencyMs: 10,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      reasoningTokens: null,
      incompleteReason: null,
      responseId: null,
      candidates: [],
      rejected: [],
      gateRejected: 0,
      rawCandidateCount: 0,
      feedItemMutations: {
        inserts: 0,
        updates: 0,
        deletes: 0,
        supersedes: 0,
      },
    };
    expect(dryRunGuaranteesNoFeedItemWrites(result)).toBe(true);
  });

  it("detects accidental mutation flags", () => {
    const result: FeedDryRunResult = {
      persistMode: "dry_run",
      status: "completed",
      outcome: "completed_with_candidates",
      runId: null,
      threadId: "t",
      prefilterClassification: null,
      modelThreadClassification: null,
      errorCode: null,
      actualModel: null,
      latencyMs: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: null,
      incompleteReason: null,
      responseId: null,
      candidates: [],
      rejected: [],
      gateRejected: 0,
      rawCandidateCount: 0,
      feedItemMutations: {
        inserts: 1,
        updates: 0,
        deletes: 0,
        supersedes: 0,
      },
    };
    expect(dryRunGuaranteesNoFeedItemWrites(result)).toBe(false);
  });
});

describe("O5A.4 engine hash freeze", () => {
  it("freeze is stable within the same process when files unchanged", () => {
    const a = freezeExtractionEngineHashes();
    const b = freezeExtractionEngineHashes();
    expect(assertEngineHashesUnchanged(a, b)).toEqual({ ok: true });
    expect(a.promptHash).toHaveLength(64);
    expect(a.schemaHash).toHaveLength(64);
    expect(a.validatorHash).toHaveLength(64);
  });
});
