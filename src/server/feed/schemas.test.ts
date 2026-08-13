import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { FeedExtractionResultSchema } from "@/server/feed/schemas";
import {
  DEFAULT_FEED_MODEL,
  DEFAULT_FEED_EXTRACTION_VERSION,
  getFeedConfig,
  clampPilotLimit,
} from "@/server/feed/config";
import { resetFeedOpenAiClientForTests } from "@/server/feed/openai-client";

describe("Feed structured output schema O5A.1", () => {
  it("accepts empty items with business classification", () => {
    const parsed = FeedExtractionResultSchema.parse({
      threadClassification: "business",
      communicationNature: null,
      disposition: null,
      skipReason: null,
      items: [],
      nextState: {
        openActions: [],
        decisions: [],
        deadlines: [],
        currentFacts: [],
        resolvedItems: [],
      },
    });
    expect(parsed.items).toEqual([]);
  });

  it("accepts action/change/decision without due type", () => {
    const base = {
      headline: "לאשר את הכמות",
      context: null,
      actorName: "אבי",
      actorEmail: "a@example.com",
      sourceMessageId: "11111111-1111-1111-1111-111111111111",
      evidenceText: "נא לאשר עד מחר",
      actionOwner: "account_owner" as const,
      responsibilityScope: null,
      requestDirection: null,
      relationToMailbox: null,
      requestedAction: null,
      actionVerb: null,
      actionObject: null,
      actionPurpose: null,
      requester: null,
      assignee: null,
      beneficiary: null,
      responseRecipient: null,
      requestModality: null,
      requestSpeechAct: null,
      communicationNature: null,
      disposition: null,
      actionState: null,
      alertCategory: null,
      alertVerificationState: null,
      attributionConfidence: null,
      semanticPrecisionConfidence: null,
      requestEvidence: null,
      subjectEvidence: null,
      contextEvidence: null,
      businessObjectEvidence: null,
      supportingEvidence: [],
      businessObject: "כמות",
      previousValue: null,
      currentValue: "40",
      occurredAt: "2026-08-01T10:00:00.000Z",
      requestedAt: null,
      dueAt: null,
      dueEvidenceText: null,
      dueSourceMessageId: null,
      confidence: 0.9,
      businessRelevanceConfidence: 0.9,
      topicKey: "approve-qty",
      replacesSourceMessageId: null,
    };
    const parsed = FeedExtractionResultSchema.parse({
      threadClassification: "business",
      communicationNature: null,
      disposition: null,
      skipReason: null,
      items: [
        { ...base, type: "action" },
        { ...base, type: "change", headline: "הכמות עלתה ל-40" },
        { ...base, type: "decision", headline: "אושרה ההזמנה", actionOwner: null },
      ],
      nextState: {
        openActions: [],
        decisions: [],
        deadlines: [],
        currentFacts: [],
        resolvedItems: [],
      },
    });
    expect(parsed.items).toHaveLength(3);
  });

  it("rejects due type and >5 items", () => {
    expect(() =>
      FeedExtractionResultSchema.parse({
        threadClassification: "business",
        communicationNature: null,
        disposition: null,
        skipReason: null,
        items: [
          {
            type: "due",
            headline: "מועד",
            context: null,
            actorName: null,
            actorEmail: null,
            sourceMessageId: "m1",
            evidenceText: "עד מחר",
            actionOwner: null,
            businessObject: null,
            previousValue: null,
            currentValue: null,
            occurredAt: "2026-08-01T10:00:00.000Z",
            dueAt: "2026-08-02T00:00:00.000Z",
            confidence: 0.9,
            businessRelevanceConfidence: 0.9,
            topicKey: "due",
            replacesSourceMessageId: null,
          },
        ],
        nextState: {
          openActions: [],
          decisions: [],
          deadlines: [],
          currentFacts: [],
          resolvedItems: [],
        },
      }),
    ).toThrow();
  });
});

describe("Feed cost config O5A.2", () => {
  beforeEach(() => {
    resetFeedOpenAiClientForTests();
    delete process.env.FEED_AI_ENABLED;
    delete process.env.OPENAI_API_KEY;
    delete process.env.FEED_PILOT_MAX_THREADS;
    delete process.env.FEED_MIN_BUSINESS_RELEVANCE;
    delete process.env.FEED_EXTRACTION_VERSION;
  });

  it("defaults model and calibration thresholds", () => {
    process.env.OPENAI_FEED_MODEL = DEFAULT_FEED_MODEL;
    const config = getFeedConfig();
    expect(config.model).toBe("gpt-5-mini");
    expect(config.minBusinessRelevance).toBe(0.85);
    expect(config.extractionVersion).toBe(DEFAULT_FEED_EXTRACTION_VERSION);
    expect(clampPilotLimit(100)).toBe(20);
    expect(config.enabled).toBe(false);
  });
});
