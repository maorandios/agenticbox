/**
 * O5C.2 — Offline context gate + orchestration fixtures (no Live OpenAI/Onyx).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  currenciesConflict,
  evaluateSupportedCalculation,
  resolveAmountCandidates,
} from "@/server/feed/context-calc";
import {
  assertAttributionBoundaries,
  extractWithOptionalCrossThreadContext,
  historicalCannotCreateActionWithoutCurrentSpeechAct,
} from "@/server/feed/extract-with-context";
import {
  ContextResolutionSchema,
  ContextRequestSchema,
  FeedExtractionResultSchema,
  emptyContextRequest,
  emptyIntelligenceState,
  type FeedExtractionResult,
  type SupportedCalculation,
  type SupportingSource,
} from "@/server/feed/schemas";
import { buildContextPack } from "@/server/feed/cross-thread-context";
import type { MappedContextHit } from "@/server/feed/map-search-hits";

const USER = "7b897ada-7b9d-4730-b662-028830e55259";
const ACCOUNT = "3083783b-1dc5-453f-924b-3c62f54e150e";
const CURRENT = "11111111-1111-4111-8111-111111111111";
const HIST = "22222222-2222-4222-8222-222222222222";

function baseExtraction(
  over: Partial<FeedExtractionResult> = {},
): FeedExtractionResult {
  return FeedExtractionResultSchema.parse({
    threadClassification: "business",
    communicationNature: "business_request",
    disposition: "create_change",
    skipReason: null,
    items: [
      {
        type: "change",
        headline: "עדכון הנחה",
        context: null,
        actorName: "Peer",
        actorEmail: "peer@example.com",
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
        evidenceText: "נותנים הנחה של 20%",
        actionOwner: "account_owner",
        responsibilityScope: "account_owner",
        requestDirection: "requested_from_account_owner",
        relationToMailbox: "requested_from_me",
        requestedAction: null,
        actionVerb: null,
        actionObject: null,
        actionPurpose: null,
        requester: {
          name: "Peer",
          email: "peer@example.com",
          evidenceText: "from",
        },
        assignee: {
          name: "Owner",
          email: "office@example.com",
          evidenceText: "to",
        },
        beneficiary: null,
        responseRecipient: null,
        requestModality: null,
        requestSpeechAct: null,
        communicationNature: "business_change",
        disposition: "create_change",
        actionState: null,
        alertCategory: null,
        alertVerificationState: null,
        attributionConfidence: 0.95,
        semanticPrecisionConfidence: 0.95,
        requestEvidence: null,
        subjectEvidence: null,
        contextEvidence: null,
        businessObjectEvidence: null,
        supportingEvidence: [],
        businessObject: "הנחה",
        previousValue: null,
        currentValue: "20%",
        occurredAt: "2026-08-10T12:00:00.000Z",
        requestedAt: "2026-08-10T12:00:00.000Z",
        dueAt: null,
        dueEvidenceText: null,
        dueSourceMessageId: null,
        confidence: 0.9,
        businessRelevanceConfidence: 0.9,
        topicKey: "discount",
        replacesSourceMessageId: null,
      },
    ],
    nextState: emptyIntelligenceState(),
    contextRequest: {
      needed: true,
      reason: "prior_price_or_amount",
      missingFacts: ["prior quote amount"],
      referenceIds: ["Q-100"],
      subjectAnchors: ["quote"],
      triggerEvidence: null,
      confidence: 0.8,
    },
    ...over,
  });
}

function histSource(over: Partial<SupportingSource> = {}): SupportingSource {
  return {
    threadId: HIST,
    messageId: "44444444-4444-4444-8444-444444444444",
    occurredAt: "2026-07-01T10:00:00.000Z",
    evidence: "הצעת מחיר: 100,000 ₪",
    role: "historical",
    ...over,
  };
}

function triggerSource(): SupportingSource {
  return {
    threadId: CURRENT,
    messageId: "33333333-3333-4333-8333-333333333333",
    occurredAt: "2026-08-10T12:00:00.000Z",
    evidence: "נותנים הנחה של 20%",
    role: "trigger",
  };
}

describe("O5C.2 schema contracts", () => {
  it("defaults contextRequest when omitted (backward compat)", () => {
    const parsed = FeedExtractionResultSchema.parse({
      threadClassification: "business",
      communicationNature: null,
      disposition: null,
      skipReason: null,
      items: [],
      nextState: emptyIntelligenceState(),
    });
    expect(parsed.contextRequest ?? null).toBeNull();
  });

  it("accepts ContextRequest + ContextResolution shapes", () => {
    expect(
      ContextRequestSchema.parse({
        needed: false,
        reason: "other",
        missingFacts: [],
        referenceIds: [],
        subjectAnchors: [],
      }),
    ).toEqual(emptyContextRequest());
    const res = ContextResolutionSchema.parse({
      status: "resolved",
      items: [],
      supportingSources: [triggerSource(), histSource()],
      calculations: [],
    });
    expect(res.status).toBe("resolved");
  });
});

describe("O5C.2 deterministic calculations", () => {
  it("prior price + new discount → derived percent_decrease", () => {
    const calc: SupportedCalculation = {
      operation: "percent_decrease",
      leftOperand: 100_000,
      rightOperand: 20,
      unit: "₪",
      leftSource: histSource(),
      rightSource: triggerSource(),
    };
    const out = evaluateSupportedCalculation(calc);
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.value).toBe(80_000);
      expect(out.derived).toBe(true);
      expect(out.formula).toContain("80");
    }
  });

  it("two base prices → conflicting", () => {
    const r = resolveAmountCandidates({
      candidates: [
        { amount: 100_000, unit: "₪", source: histSource() },
        {
          amount: 120_000,
          unit: "₪",
          source: histSource({ evidence: "הצעה אחרת 120,000 ₪" }),
        },
      ],
    });
    expect(r.status).toBe("conflicting");
  });

  it("missing operand source → insufficient", () => {
    const out = evaluateSupportedCalculation({
      operation: "add",
      leftOperand: 1,
      rightOperand: 2,
      unit: null,
      leftSource: histSource({ evidence: "" }),
      rightSource: triggerSource(),
    });
    expect(out.status).toBe("insufficient");
  });

  it("different currencies → conflict helper", () => {
    expect(currenciesConflict("100,000 ₪", "$100,000")).toBe(true);
    expect(currenciesConflict("100,000 ₪", "80,000 ₪")).toBe(false);
  });
});

describe("O5C.2 orchestrator (mocked search/map)", () => {
  const prev = process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
  const searchFn = vi.fn();
  const mapFn = vi.fn();

  beforeEach(() => {
    searchFn.mockReset();
    mapFn.mockReset();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
    else process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = prev;
  });

  it("flag off → zero search and unchanged extraction", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "false";
    const extraction = baseExtraction();
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction,
      searchFn,
      mapFn,
    });
    expect(out.contextStatus).toBe("flag_disabled");
    expect(out.searchCalled).toBe(false);
    expect(searchFn).not.toHaveBeenCalled();
    expect(out.extraction).toEqual(extraction);
    expect(out.openaiLiveCalls).toBe(0);
    expect(out.onyxLiveCalls).toBe(0);
  });

  it("contextNeeded=false → zero search", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const extraction = baseExtraction({
      contextRequest: emptyContextRequest(),
    });
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction,
      searchFn,
      mapFn,
    });
    expect(out.contextStatus).toBe("not_needed");
    expect(searchFn).not.toHaveBeenCalled();
  });

  it("marketing referencing previous offer does not retrieve", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const extraction = baseExtraction({
      threadClassification: "marketing",
      communicationNature: "marketing",
      disposition: "suppress",
      contextRequest: {
        needed: true,
        reason: "prior_price_or_amount",
        missingFacts: ["previous offer"],
        referenceIds: [],
        subjectAnchors: ["previous offer"],
        triggerEvidence: null,
        confidence: 0.5,
      },
    });
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction,
      searchFn,
      mapFn,
    });
    expect(out.contextStatus).toBe("not_needed");
    expect(searchFn).not.toHaveBeenCalled();
  });

  it("no mapped hits → insufficient_context", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    searchFn.mockResolvedValue({ hits: [], requestId: "r", latencyMs: 1 });
    mapFn.mockResolvedValue({
      mapped: [],
      stats: {
        totalHits: 0,
        validInternalLinks: 0,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered: {},
      },
    });
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction(),
      searchFn,
      mapFn,
      currentMessageCleanText: "הנחה 20% על הצעה Q-100",
      subject: "Q-100",
    });
    expect(out.contextStatus).toBe("insufficient_context");
    expect(out.resolution?.status).toBe("insufficient");
    expect(out.openaiLiveCalls).toBe(0);
  });

  it("stale-only sources → stale_only / excluded from pack", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    searchFn.mockResolvedValue({
      hits: [{ citationId: 1, title: "t", content: "x", link: `/source/thread/${HIST}`, sourceType: "ingestion_api", updatedAt: "2026-07-01T00:00:00Z" }],
      requestId: "r",
      latencyMs: 1,
    });
    mapFn.mockResolvedValue({
      mapped: [],
      stats: {
        totalHits: 1,
        validInternalLinks: 1,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered: { stale_context_excluded: 1 },
      },
    });
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction(),
      searchFn,
      mapFn,
    });
    expect(out.staleExcluded).toBe(1);
    expect(out.contextStatus).toBe("stale_only");
    expect(out.contextPack).toBeNull();
  });

  it("pack ready + mock completion; historical cannot invent action/requester", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const mappedHit: MappedContextHit = {
      threadId: HIST,
      onyxDocumentId: `user:${USER}:thread:${HIST}`,
      citationId: 1,
      content: "הצעת מחיר: 100,000 ₪",
      sourceLink: `/source/thread/${HIST}`,
      occurredAt: "2026-07-01T10:00:00.000Z",
    };
    searchFn.mockResolvedValue({
      hits: [
        {
          citationId: 1,
          title: "quote",
          content: mappedHit.content,
          link: mappedHit.sourceLink,
          sourceType: "ingestion_api",
          updatedAt: mappedHit.occurredAt,
        },
      ],
      requestId: "r",
      latencyMs: 2,
    });
    mapFn.mockResolvedValue({
      mapped: [mappedHit],
      stats: {
        totalHits: 1,
        validInternalLinks: 1,
        ownershipVerified: 1,
        mappedHits: 1,
        filtered: {},
      },
    });

    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction(),
      searchFn,
      mapFn,
      currentOccurredAt: "2026-08-10T12:00:00.000Z",
      completionFn: async ({ contextPack, triggerSources }) => {
        expect(contextPack.sources.length).toBe(1);
        const calc: SupportedCalculation = {
          operation: "percent_decrease",
          leftOperand: 100_000,
          rightOperand: 20,
          unit: "₪",
          leftSource: histSource(),
          rightSource: triggerSources[0]!,
        };
        const evaluated = evaluateSupportedCalculation(calc);
        expect(evaluated.status).toBe("ok");
        return {
          status: "resolved",
          items: [],
          supportingSources: [triggerSources[0]!, histSource()],
          calculations: [calc],
        };
      },
    });
    expect(out.contextStatus).toBe("pack_ready");
    expect(out.completionCalled).toBe(true);
    expect(out.openaiLiveCalls).toBe(0);
    expect(out.onyxLiveCalls).toBe(1);

    expect(
      historicalCannotCreateActionWithoutCurrentSpeechAct({
        currentSpeechAct: null,
        proposedType: "action",
      }),
    ).toBe(false);
    expect(
      assertAttributionBoundaries({
        triggerRequesterEmail: "peer@example.com",
        triggerAssigneeEmail: "office@example.com",
        resolvedItem: {
          requester: { email: "ghost@other.com" },
          assignee: { email: "office@example.com" },
        },
      }),
    ).toBe(false);
  });

  it("other-account mapped filter is enforced by mapFn stats", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    searchFn.mockResolvedValue({ hits: [{ citationId: 1, title: null, content: "x", link: `/source/thread/${HIST}`, sourceType: "ingestion_api", updatedAt: null }], requestId: "r", latencyMs: 1 });
    mapFn.mockResolvedValue({
      mapped: [],
      stats: {
        totalHits: 1,
        validInternalLinks: 1,
        ownershipVerified: 0,
        mappedHits: 0,
        filtered: { thread_ownership_denied: 1 },
      },
    });
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction(),
      searchFn,
      mapFn,
    });
    expect(out.contextStatus).toBe("insufficient_context");
  });

  it("context budget truncates to limits", () => {
    const pack = buildContextPack(
      Array.from({ length: 8 }, (_, i) => ({
        threadId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        documentId: `d${i}`,
        occurredAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        participants: [],
        subject: null,
        excerpt: "x".repeat(20_000),
        sourceLink: `/source/thread/t${i}`,
      })),
    );
    expect(pack.sources.length).toBeLessThanOrEqual(5);
    expect(pack.estimatedTokensApprox).toBeLessThanOrEqual(12_000);
  });

  it("terms/version change scenarios keep historical role only", () => {
    expect(
      historicalCannotCreateActionWithoutCurrentSpeechAct({
        currentSpeechAct: "approval_request",
        proposedType: "action",
      }),
    ).toBe(true);
    // Same participant different subject → no automatic link (query builder leaves ids empty)
    expect(
      assertAttributionBoundaries({
        triggerRequesterEmail: "a@x.com",
        triggerAssigneeEmail: "b@x.com",
        resolvedItem: {
          requester: { email: "a@x.com" },
          assignee: { email: "b@x.com" },
        },
      }),
    ).toBe(true);
  });
});
