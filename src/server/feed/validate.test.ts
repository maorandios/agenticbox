import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeDedupeKey } from "@/server/feed/context";
import { loadAccountIdentities } from "@/server/feed/identity";
import { validateFeedCandidates, validateExtractionGate } from "@/server/feed/validate";
import type { FeedCandidate } from "@/server/feed/schemas";
import { emptyIntelligenceState } from "@/server/feed/schemas";

const identities = loadAccountIdentities({
  primaryEmail: "me@example.com",
  aliases: [],
});

const message = {
  id: "msg-1",
  subject: "הזמנה",
  sentAt: "2026-08-01T10:00:00.000Z",
  fromEmail: "a@example.com",
  fromName: "אבי",
  toEmails: ["me@example.com"],
  toParticipants: [
    { email: "me@example.com", displayName: null, isMailboxOwner: true },
  ],
  ccEmails: [],
  ccParticipants: [],
  bccEmails: [],
  bccParticipants: [],
  replyToEmail: null,
  direction: "inbound" as const,
  isAccountOwner: false,
  accountRelation: "sent_to_account" as const,
  body: "נא לאשר את הגדלת הכמות ל-65 יחידות עד יום ראשון",
  removedNormalized: [],
};

function candidate(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    type: "action",
    headline: "לאשר את הגדלת הכמות ל-65 יחידות",
    context: null,
    actorName: "אבי",
    actorEmail: "a@example.com",
    sourceMessageId: "msg-1",
    evidenceText: "נא לאשר את הגדלת הכמות ל-65 יחידות",
    actionOwner: "account_owner",
    responsibilityScope: "account_owner",
    requestedAction: "לאשר את הגדלת הכמות ל-65 יחידות",
    requester: {
      name: "אבי",
      email: "a@example.com",
      evidenceText: "נא לאשר את הגדלת הכמות ל-65 יחידות",
    },
    assignee: {
      name: null,
      email: "me@example.com",
      evidenceText: "נא לאשר את הגדלת הכמות ל-65 יחידות",
    },
    beneficiary: null,
    requestModality: "direct_request",
    requestSpeechAct: null,
    attributionConfidence: 0.9,
    semanticPrecisionConfidence: 0.95,
    requestEvidence: null,
    supportingEvidence: [],
    responseRecipient: null,
    actionVerb: null,
    actionObject: null,
    actionPurpose: null,
    relationToMailbox: null,
    requestDirection: null,
    businessObject: null,
    previousValue: null,
    currentValue: null,
    occurredAt: "2026-08-01T10:00:00.000Z",
    requestedAt: "2026-08-01T10:00:00.000Z",
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    confidence: 0.9,
    businessRelevanceConfidence: 0.9,
    topicKey: "qty-increase",
    replacesSourceMessageId: null,
    ...over,
  };
}

describe("validateFeedCandidates O5A.2", () => {
  const dedupe = (c: FeedCandidate) =>
    computeDedupeKey({
      userId: "u1",
      threadId: "t1",
      sourceMessageId: c.sourceMessageId,
      type: c.type,
      evidenceText: c.evidenceText,
    });

  it("accepts a valid owner action and recomputes scope", () => {
    const { accepted, rejected } = validateFeedCandidates({
      candidates: [candidate()],
      messages: [message],
      accountIdentities: identities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(rejected).toHaveLength(0);
    expect(accepted[0]?.responsibilityScope).toBe("account_owner");
  });

  it("clears due without evidence instead of rejecting", () => {
    const { accepted, rejected } = validateFeedCandidates({
      candidates: [
        candidate({
          dueAt: "2026-08-05T00:00:00.000Z",
          dueEvidenceText: null,
          dueSourceMessageId: null,
        }),
      ],
      messages: [message],
      accountIdentities: identities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(rejected).toHaveLength(0);
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("gates non-business thread classification", () => {
    const gate = validateExtractionGate({
      result: {
        threadClassification: "marketing",
        skipReason: "newsletter",
        items: [candidate()],
        nextState: emptyIntelligenceState(),
      },
    });
    expect(gate.ok).toBe(false);
  });
});
