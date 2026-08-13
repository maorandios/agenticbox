import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { classifyFeedThreadEligibility } from "@/server/feed/eligibility";
import { cleanFeedMessageBody } from "@/server/feed/clean-content";
import { computeDedupeKey } from "@/server/feed/context";
import { FEED_QUALITY_FIXTURES } from "@/server/feed/fixtures/quality";
import {
  validateExtractionGate,
  validateFeedCandidates,
} from "@/server/feed/validate";
import type { FeedContextMessage } from "@/server/feed/context";
import type { FeedCandidate } from "@/server/feed/schemas";

function toContextMessages(
  thread: (typeof FEED_QUALITY_FIXTURES)[0]["thread"],
): FeedContextMessage[] {
  return thread.messages.map((m, i) => {
    const cleaned = cleanFeedMessageBody(m.body);
    return {
      id: `msg-${i + 1}`,
      subject: m.subject,
      sentAt: "2026-08-10T10:00:00.000Z",
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toEmails: m.toEmails,
      ccEmails: [],
      bccEmails: [],
      replyToEmail: null,
      direction: m.direction,
      isAccountOwner:
        Boolean(m.fromEmail) &&
        m.fromEmail!.toLowerCase() === thread.accountEmail.toLowerCase(),
      accountRelation:
        Boolean(m.fromEmail) &&
        m.fromEmail!.toLowerCase() === thread.accountEmail.toLowerCase()
          ? ("sent_by_account" as const)
          : m.toEmails.some(
                (e) => e.toLowerCase() === thread.accountEmail.toLowerCase(),
              )
            ? ("sent_to_account" as const)
            : ("external_to_external" as const),
      toParticipants: m.toEmails.map((email) => ({
        email,
        displayName: null,
        isMailboxOwner:
          email.toLowerCase() === thread.accountEmail.toLowerCase(),
      })),
      ccParticipants: [],
      bccParticipants: [],
      body: cleaned.cleanText,
      removedNormalized: cleaned.removedNormalized,
    };
  });
}

describe("O5A.1 quality fixtures", () => {
  for (const fixture of FEED_QUALITY_FIXTURES) {
    if (fixture.expectPrefilter) {
      it(`${fixture.id}: prefilter — ${fixture.description}`, () => {
        const result = classifyFeedThreadEligibility(fixture.thread);
        expect(result.classification).toBe(
          fixture.expectPrefilter!.classification,
        );
        expect(result.eligibleForExtraction).toBe(
          fixture.expectPrefilter!.eligibleForExtraction,
        );
      });
    }

    if (fixture.modelResult && fixture.expectAccepted != null) {
      it(`${fixture.id}: validation — ${fixture.description}`, () => {
        const gate = validateExtractionGate({ result: fixture.modelResult! });
        const messages = toContextMessages(fixture.thread);
        // Align sourceMessageId msg-1 with first message
        const candidates = fixture.modelResult!.items.map((c) => ({
          ...c,
          sourceMessageId: messages[0]?.id ?? c.sourceMessageId,
        }));

        if (!gate.ok) {
          expect(fixture.expectAccepted).toBe(0);
          return;
        }

        const { accepted, rejected } = validateFeedCandidates({
          candidates: candidates.map((c) => {
            const isExternal = c.actionOwner === "external_person";
            return {
              ...c,
              requestedAction: c.requestedAction ?? c.headline,
              requester: c.requester ?? {
                name: c.actorName,
                email: c.actorEmail ?? messages[0]?.fromEmail ?? null,
                evidenceText: c.evidenceText,
              },
              assignee: c.assignee ?? {
                name: null,
                email: isExternal
                  ? "external.person@example.com"
                  : fixture.thread.accountEmail,
                evidenceText: c.evidenceText,
              },
              requestModality: c.requestModality ?? "direct_request",
              requestSpeechAct: c.requestSpeechAct ?? null,
              attributionConfidence: c.attributionConfidence ?? c.confidence,
              semanticPrecisionConfidence:
                c.semanticPrecisionConfidence ?? c.confidence,
            };
          }),
          messages: messages.map((m) => {
            const toEmails = [...m.toEmails, "external.person@example.com"];
            return {
              ...m,
              toEmails,
              toParticipants: toEmails.map((email) => ({
                email,
                displayName: null,
                isMailboxOwner:
                  email.toLowerCase() ===
                  fixture.thread.accountEmail.toLowerCase(),
              })),
            };
          }),
          accountIdentities: [
            { email: fixture.thread.accountEmail.toLowerCase(), type: "primary" },
          ],
          mailboxIdentity: {
            mailAccountId: "test",
            primaryEmail: fixture.thread.accountEmail.toLowerCase(),
            verifiedAliases: [],
            canonicalDisplayName: "Owner",
          },
          minConfidence: 0.8,
          minBusinessRelevance: 0.85,
          existingDedupeKeys: new Set(),
          computeDedupeKey: (c: FeedCandidate) =>
            computeDedupeKey({
              userId: "u1",
              threadId: "t1",
              sourceMessageId: c.sourceMessageId,
              type: c.type,
              evidenceText: c.evidenceText,
            }),
        });

        expect(accepted).toHaveLength(fixture.expectAccepted!);
        if (fixture.expectRejectReasons?.length) {
          const reasons = rejected.map((r) => r.reason);
          expect(
            fixture.expectRejectReasons.some((r) => reasons.includes(r as never)),
          ).toBe(true);
        }
        if (fixture.id === "13-action-with-due") {
          expect(accepted[0]?.dueAt).toBeTruthy();
          expect(accepted).toHaveLength(1);
        }
      });
    }
  }
});

describe("cleanFeedMessageBody", () => {
  it("strips On ... wrote quotes conservatively", () => {
    const cleaned = cleanFeedMessageBody(
      "קיבלתי, תודה.\n\nOn Mon, Aug 1, client wrote:\nנא לשלוח מפרט",
    );
    expect(cleaned.cleanText).toContain("קיבלתי");
    expect(cleaned.cleanText).not.toContain("נא לשלוח מפרט");
    expect(cleaned.removedKinds).toContain("quote");
  });

  it("does not wipe short bodies", () => {
    const cleaned = cleanFeedMessageBody("נא לאשר 40 יחידות");
    expect(cleaned.cleanText).toContain("נא לאשר");
  });
});

describe("circuit breaker helpers", () => {
  it("trips on model access style errors", async () => {
    const { isCircuitBreakerError, tripFeedCircuit, isFeedCircuitOpen, resetFeedCircuit } =
      await import("@/server/feed/circuit");
    resetFeedCircuit();
    expect(isCircuitBreakerError("openai_model_unavailable")).toBe(true);
    tripFeedCircuit("openai_model_unavailable");
    expect(isFeedCircuitOpen()).toBe(true);
    resetFeedCircuit();
    expect(isFeedCircuitOpen()).toBe(false);
  });
});
