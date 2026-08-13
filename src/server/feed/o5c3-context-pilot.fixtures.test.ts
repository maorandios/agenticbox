/**
 * O5C.3 — Targeted fixtures for live completion sanitize + Stage-1 preservation.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { sanitizeContextResolution } from "@/server/feed/context-completion";
import {
  extractWithOptionalCrossThreadContext,
} from "@/server/feed/extract-with-context";
import {
  FeedExtractionResultSchema,
  emptyContextRequest,
  emptyIntelligenceState,
  type FeedExtractionResult,
  type SupportingSource,
} from "@/server/feed/schemas";
import type { MappedContextHit } from "@/server/feed/map-search-hits";

const USER = "7b897ada-7b9d-4730-b662-028830e55259";
const ACCOUNT = "3083783b-1dc5-453f-924b-3c62f54e150e";
const CURRENT = "11111111-1111-4111-8111-111111111111";
const HIST = "22222222-2222-4222-8222-222222222222";
const FAKE = "99999999-9999-4999-8999-999999999999";

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
        type: "action",
        headline: "לאשר עדכון מחיר",
        context: null,
        actorName: "Peer",
        actorEmail: "peer@example.com",
        sourceMessageId: "33333333-3333-4333-8333-333333333333",
        evidenceText: "נא לאשר את העדכון",
        actionOwner: "account_owner",
        responsibilityScope: "account_owner",
        requestDirection: "requested_from_account_owner",
        relationToMailbox: "requested_from_me",
        requestedAction: "לאשר עדכון",
        actionVerb: "לאשר",
        actionObject: "עדכון",
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
        requestModality: "direct_request",
        requestSpeechAct: "approval_request",
        communicationNature: "business_request",
        disposition: "create_action",
        actionState: "requested",
        alertCategory: null,
        alertVerificationState: null,
        attributionConfidence: 0.95,
        semanticPrecisionConfidence: 0.95,
        requestEvidence: null,
        subjectEvidence: null,
        contextEvidence: null,
        businessObjectEvidence: null,
        supportingEvidence: [],
        businessObject: "עדכון מחיר",
        previousValue: null,
        currentValue: null,
        occurredAt: "2026-08-10T12:00:00.000Z",
        requestedAt: "2026-08-10T12:00:00.000Z",
        dueAt: null,
        dueEvidenceText: null,
        dueSourceMessageId: null,
        confidence: 0.9,
        businessRelevanceConfidence: 0.9,
        topicKey: "price-update",
        replacesSourceMessageId: null,
      },
    ],
    nextState: emptyIntelligenceState(),
    contextRequest: {
      needed: true,
      reason: "prior_price_or_amount",
      missingFacts: ["base price"],
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
    messageId: null,
    occurredAt: "2026-07-01T10:00:00.000Z",
    evidence: "הצעת מחיר: 100,000 ₪",
    role: "historical",
    ...over,
  };
}

describe("O5C.3 sanitizeContextResolution", () => {
  it("drops invented source IDs", () => {
    const out = sanitizeContextResolution({
      resolution: {
        status: "resolved",
        items: [],
        supportingSources: [
          {
            threadId: CURRENT,
            messageId: null,
            occurredAt: "2026-08-10T12:00:00.000Z",
            evidence: "הנחה 20%",
            role: "trigger",
          },
          histSource(),
          histSource({ threadId: FAKE, evidence: "ghost" }),
        ],
        calculations: [],
      },
      allowedThreadIds: new Set([CURRENT.toLowerCase(), HIST.toLowerCase()]),
      triggerRequesterEmail: "peer@example.com",
      triggerAssigneeEmail: "office@example.com",
      currentSpeechAct: "approval_request",
    });
    expect(out.supportingSources.every((s) => s.threadId !== FAKE)).toBe(true);
  });

  it("blocks history-only Action without current speech act", () => {
    const out = sanitizeContextResolution({
      resolution: {
        status: "resolved",
        items: [
          {
            ...baseExtraction().items[0]!,
            type: "action",
            requestSpeechAct: null,
            supportingSources: [histSource()],
            derived: false,
            formula: null,
          },
        ],
        supportingSources: [
          {
            threadId: CURRENT,
            messageId: null,
            occurredAt: "2026-08-10T12:00:00.000Z",
            evidence: "fyi",
            role: "trigger",
          },
          histSource(),
        ],
        calculations: [],
      },
      allowedThreadIds: new Set([CURRENT.toLowerCase(), HIST.toLowerCase()]),
      triggerRequesterEmail: "peer@example.com",
      triggerAssigneeEmail: "office@example.com",
      currentSpeechAct: null,
    });
    expect(out.items).toHaveLength(0);
  });

  it("rejects foreign requester attribution", () => {
    const out = sanitizeContextResolution({
      resolution: {
        status: "resolved",
        items: [
          {
            ...baseExtraction().items[0]!,
            requester: {
              name: "Ghost",
              email: "ghost@other.com",
              evidenceText: "x",
            },
            supportingSources: [],
            derived: false,
            formula: null,
          },
        ],
        supportingSources: [
          {
            threadId: CURRENT,
            messageId: null,
            occurredAt: "2026-08-10T12:00:00.000Z",
            evidence: "נא לאשר",
            role: "trigger",
          },
          histSource(),
        ],
        calculations: [],
      },
      allowedThreadIds: new Set([CURRENT.toLowerCase(), HIST.toLowerCase()]),
      triggerRequesterEmail: "peer@example.com",
      triggerAssigneeEmail: "office@example.com",
      currentSpeechAct: "approval_request",
    });
    expect(out.items).toHaveLength(0);
  });
});

describe("O5C.3 Stage-1 preservation on context failure", () => {
  const prev = process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED;
    else process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = prev;
  });

  it("search throw → failed + Stage 1 items kept", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const extraction = baseExtraction();
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction,
      searchFn: async () => {
        throw new Error("search_down");
      },
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
      completionFn: async () => ({
        status: "insufficient",
        items: [],
        supportingSources: [],
        calculations: [],
      }),
    });
    expect(out.contextStatus).toBe("failed");
    expect(out.stage1Items).toEqual(extraction.items);
    expect(out.extraction.items).toEqual(extraction.items);
  });

  it("flag off still unchanged", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "false";
    const extraction = baseExtraction({
      contextRequest: emptyContextRequest(),
    });
    const searchFn = vi.fn();
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction,
      searchFn,
      useLiveCompletion: true,
    });
    expect(out.contextStatus).toBe("flag_disabled");
    expect(searchFn).not.toHaveBeenCalled();
    expect(out.openaiLiveCalls).toBe(0);
  });

  it("completionFn path does not auto-call live when useLiveCompletion omitted", async () => {
    process.env.FEED_CROSS_THREAD_CONTEXT_ENABLED = "true";
    const mappedHit: MappedContextHit = {
      threadId: HIST,
      onyxDocumentId: `user:${USER}:thread:${HIST}`,
      citationId: 1,
      content: "100,000 ₪",
      sourceLink: `/source/thread/${HIST}`,
      occurredAt: "2026-07-01T10:00:00.000Z",
    };
    const out = await extractWithOptionalCrossThreadContext({
      userId: USER,
      mailAccountId: ACCOUNT,
      threadId: CURRENT,
      extraction: baseExtraction(),
      searchFn: async () => ({
        hits: [
          {
            citationId: 1,
            title: "t",
            content: mappedHit.content,
            link: mappedHit.sourceLink,
            sourceType: "ingestion_api",
            updatedAt: mappedHit.occurredAt,
          },
        ],
        requestId: "r",
        latencyMs: 1,
      }),
      mapFn: async () => ({
        mapped: [mappedHit],
        stats: {
          totalHits: 1,
          validInternalLinks: 1,
          ownershipVerified: 1,
          mappedHits: 1,
          filtered: {},
        },
      }),
      completionFn: async () => ({
        status: "insufficient",
        items: [],
        supportingSources: [],
        calculations: [],
      }),
    });
    expect(out.openaiLiveCalls).toBe(0);
    expect(out.contextStatus).toBe("pack_ready");
    expect(out.stage1Items.length).toBe(1);
  });
});
