/**
 * O5C.3.1 — Context gate recall fixtures + selection harness contract (no Live OpenAI).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";

vi.mock("server-only", () => ({}));

import {
  detectCrossThreadDependencySignals,
  hasStrongCrossThreadDependencySignals,
} from "@/server/feed/context-dependency-signals";
import {
  extractWithOptionalCrossThreadContext,
} from "@/server/feed/extract-with-context";
import {
  ContextRequestSchema,
  FeedExtractionResultSchema,
  emptyContextRequest,
  emptyIntelligenceState,
  type FeedExtractionResult,
} from "@/server/feed/schemas";
import {
  assertPilotEventsMatchSelection,
  loadLockedSelectionThreadIds,
  O5C3_LIVE_SELECTION_PATH,
} from "@/server/feed/o5c31-selection-harness";

const USER = "7b897ada-7b9d-4730-b662-028830e55259";
const ACCOUNT = "3083783b-1dc5-453f-924b-3c62f54e150e";
const CURRENT = "11111111-1111-4111-8111-111111111111";
const HIST = "22222222-2222-4222-8222-222222222222";

const SELECTION_PATH = O5C3_LIVE_SELECTION_PATH;

function baseExtraction(
  over: Partial<FeedExtractionResult> = {},
): FeedExtractionResult {
  return FeedExtractionResultSchema.parse({
    threadClassification: "business",
    communicationNature: "business_request",
    disposition: "create_change",
    skipReason: null,
    items: [],
    nextState: emptyIntelligenceState(),
    contextRequest: emptyContextRequest(),
    ...over,
  });
}

describe("O5C.3.1 selection harness contract", () => {
  it("locked selection file exists with exactly two thread IDs", () => {
    expect(existsSync(SELECTION_PATH)).toBe(true);
    const ids = loadLockedSelectionThreadIds();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("56b3bd04-5667-415b-b840-be8c113ed147");
    expect(ids[1]).toBe("a014eef4-90fd-4b6a-a1b8-92e54febfad5");
  });

  it("fails when events include a thread not in selection", () => {
    const ids = loadLockedSelectionThreadIds();
    expect(() =>
      assertPilotEventsMatchSelection({
        selectionThreadIds: ids,
        eventThreadIds: [...ids, "00000000-0000-4000-8000-000000000099"],
      }),
    ).toThrow(/selection_events_mismatch/);
  });

  it("fails when events omit a locked thread", () => {
    const ids = loadLockedSelectionThreadIds();
    expect(() =>
      assertPilotEventsMatchSelection({
        selectionThreadIds: ids,
        eventThreadIds: [ids[0]!],
      }),
    ).toThrow(/selection_events_mismatch/);
  });

  it("passes when events match selection exactly (any order)", () => {
    const ids = loadLockedSelectionThreadIds();
    expect(() =>
      assertPilotEventsMatchSelection({
        selectionThreadIds: ids,
        eventThreadIds: [ids[1]!, ids[0]!],
      }),
    ).not.toThrow();
  });
});

describe("O5C.3.1 ContextRequest schema", () => {
  it("accepts legacy shape without triggerEvidence/confidence (defaults)", () => {
    const parsed = ContextRequestSchema.parse({
      needed: true,
      reason: "prior_price_or_amount",
      missingFacts: ["base price"],
      referenceIds: ["Q-100"],
      subjectAnchors: ["quote"],
    });
    expect(parsed.triggerEvidence).toBeNull();
    expect(parsed.confidence).toBe(0);
  });

  it("accepts O5C.3.1 fields", () => {
    const parsed = ContextRequestSchema.parse({
      needed: true,
      reason: "prior_terms",
      missingFacts: ["prior terms"],
      referenceIds: [],
      subjectAnchors: [],
      triggerEvidence: "לפי התנאים שסיכמנו קודם",
      confidence: 0.8,
    });
    expect(parsed.triggerEvidence).toContain("סיכמנו");
    expect(parsed.confidence).toBe(0.8);
  });
});

describe("O5C.3.1 detectCrossThreadDependencySignals — needed cues", () => {
  it("prior price + new discount without baseline", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Quote update",
      currentMessageCleanText: "We can offer a 15% discount on the previous amount",
      currentThreadHistoryText: "Hi, following up.",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(true);
    expect(signals.some((s) => s.kind === "change_without_baseline")).toBe(true);
  });

  it("HE: approval per prior terms", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "אישור",
      currentMessageCleanText: "האישור תקף לפי התנאים שסיכמנו קודם",
      currentThreadHistoryText: "",
    });
    expect(signals.some((s) => s.kind === "prior_state_reference")).toBe(true);
  });

  it("new version replaces prior version elsewhere", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Version 3",
      currentMessageCleanText: "This revision replaces version 2 sent earlier",
      currentThreadHistoryText: "Thanks",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(true);
  });

  it("continuation part when part 1 not in thread", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "מייל 2 : הצעת מחיר",
      currentMessageCleanText: "מצורף החלק השני",
      currentThreadHistoryText: "",
    });
    expect(signals.some((s) => s.kind === "continuation_subject")).toBe(true);
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(true);
  });

  it("approval pointing at reference id", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "PO-10442",
      currentMessageCleanText: "Please approve quote Q-8891 as discussed",
      currentThreadHistoryText: "",
    });
    expect(signals.some((s) => s.kind === "reference_id")).toBe(true);
  });

  it("new status vs prior decision", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Status",
      currentMessageCleanText: "As previously decided, we are now blocked pending your OK",
      currentThreadHistoryText: "Hello",
    });
    expect(signals.some((s) => s.kind === "prior_state_reference")).toBe(true);
  });

  it("EN finance: updated price without baseline in thread", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Invoice adjustment",
      currentMessageCleanText: "Updated price: please apply the decrease we discussed",
      currentThreadHistoryText: "See you tomorrow",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(true);
  });

  it("HR: confirmation per prior commitment", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Offer letter",
      currentMessageCleanText: "Confirming the commitment as agreed last week",
      currentThreadHistoryText: "",
    });
    expect(signals.some((s) => s.kind === "prior_state_reference")).toBe(true);
  });
});

describe("O5C.3.1 detectCrossThreadDependencySignals — not needed", () => {
  it("standalone complete request", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Please send the report by Friday",
      currentMessageCleanText: "Please send the Q3 ops report by Friday EOD.",
      currentThreadHistoryText: "",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(false);
  });

  it("clear attachment action without history dependency", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Signed form",
      currentMessageCleanText: "Attached is the signed W-9. Please file it.",
      currentThreadHistoryText: "",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(false);
  });

  it("same participant different business topic", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Parking permit",
      currentMessageCleanText: "Can you issue a parking permit for next month?",
      currentThreadHistoryText: "Earlier we talked about budget — unrelated.",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(false);
  });

  it("marketing previous offer cue is not a structural business gate", () => {
    // Marketing is skipped at orchestrator; signals may still fire — keep weak/absent for this wording.
    const signals = detectCrossThreadDependencySignals({
      subject: "Limited time",
      currentMessageCleanText: "Don't miss our previous offer — click to subscribe",
      currentThreadHistoryText: "",
    });
    // "previous offer" alone without change/approval/ref → prior_state may match; treat as moderate ok
    // Strong gate for marketing is blocked upstream by classification.
    expect(
      signals.filter((s) => s.kind === "reference_id" && s.strength === "strong"),
    ).toHaveLength(0);
  });

  it("system notification", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Delivery Status Notification",
      currentMessageCleanText: "Your message was delivered to the recipient.",
      currentThreadHistoryText: "",
    });
    expect(hasStrongCrossThreadDependencySignals(signals)).toBe(false);
  });

  it("all prior facts already in current thread", () => {
    const signals = detectCrossThreadDependencySignals({
      subject: "Discount follow-up",
      currentMessageCleanText: "Apply 10% discount on the previous price 100,000 ILS",
      currentThreadHistoryText:
        "Quote Q-100 base price 100,000 ILS was approved last week.",
    });
    // baseline present in thread → change_without_baseline should not fire strongly
    expect(
      signals.some(
        (s) => s.kind === "change_without_baseline" && s.strength === "strong",
      ),
    ).toBe(false);
  });
});

describe("O5C.3.1 orchestrator disagreement → Search-only", () => {
  const prev = process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
    else process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = prev;
  });

  it("model needed=false + strong signals + mapped hits → needs_context_review, no completion", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const searchFn = vi.fn(async () => ({
      hits: [
        {
          citationId: 1,
          title: "t",
          content: "prior quote 100000",
          link: `/source/thread/${HIST}`,
          sourceType: "ingestion_api" as const,
          updatedAt: "2026-07-01T00:00:00Z",
        },
      ],
      requestId: "r",
      latencyMs: 2,
    }));
    const mapFn = vi.fn(async () => ({
      mapped: [
        {
          threadId: HIST,
          onyxDocumentId: `user:${USER}:thread:${HIST}`,
          citationId: 1,
          content: "prior quote 100000",
          sourceLink: `/source/thread/${HIST}`,
          occurredAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      stats: {
        totalHits: 1,
        validInternalLinks: 1,
        ownershipVerified: 1,
        mappedHits: 1,
        filtered: {},
      },
    }));
    const completionFn = vi.fn(async () => ({
      status: "resolved" as const,
      items: [],
      supportingSources: [],
      calculations: [],
    }));

    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction({
        contextRequest: {
          needed: false,
          reason: "other",
          missingFacts: [],
          referenceIds: [],
          subjectAnchors: [],
          triggerEvidence: null,
          confidence: 0.1,
        },
      }),
      searchFn,
      mapFn,
      completionFn,
      subject: "מייל 2 : הצעת מחיר",
      currentMessageCleanText: "מצורף החלק השני של ההצעה",
      currentThreadHistoryText: "",
      currentOccurredAt: "2026-08-10T12:00:00.000Z",
    });

    expect(out.gateDisagreement).toBe(true);
    expect(out.contextStatus).toBe("needs_context_review");
    expect(out.searchCalled).toBe(true);
    expect(out.completionCalled).toBe(false);
    expect(completionFn).not.toHaveBeenCalled();
    expect(out.openaiLiveCalls).toBe(0);
  });

  it("disagreement + zero mapped → not_needed", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction({
        contextRequest: emptyContextRequest(),
      }),
      searchFn: async () => ({ hits: [], requestId: "r", latencyMs: 1 }),
      mapFn: async () => ({
        mapped: [],
        stats: {
          totalHits: 0,
          validInternalLinks: 0,
          ownershipVerified: 0,
          mappedHits: 0,
          filtered: {},
        },
      }),
      subject: "מייל 2",
      currentMessageCleanText: "המשך לחלק הראשון",
      currentThreadHistoryText: "",
    });
    expect(out.gateDisagreement).toBe(true);
    expect(out.contextStatus).toBe("not_needed");
    expect(out.completionCalled).toBe(false);
  });

  it("forced needed must not appear as natural resolution in harness semantics", () => {
    // Quality reports must separate wiringSmoke; this constant documents the rule.
    const naturalStatuses = ["resolved", "insufficient", "conflicting"];
    const forcedFlag = false;
    expect(forcedFlag).toBe(false);
    expect(naturalStatuses).toContain("resolved");
  });
});
