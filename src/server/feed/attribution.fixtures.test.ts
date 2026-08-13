import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  loadAccountIdentities,
  resolveResponsibilityScope,
} from "@/server/feed/identity";
import { cleanFeedMessageBody } from "@/server/feed/clean-content";
import { computeDedupeKey } from "@/server/feed/context";
import { validateFeedCandidates } from "@/server/feed/validate";
import type { FeedCandidate } from "@/server/feed/schemas";
import type { FeedContextMessage } from "@/server/feed/context";

const ownerIdentities = loadAccountIdentities({
  primaryEmail: "office@trigo-models.com",
  aliases: [],
});

const davidIsOwner = loadAccountIdentities({
  primaryEmail: "david@biz.co.il",
  aliases: [],
});

function msg(over: Partial<FeedContextMessage> = {}): FeedContextMessage {
  const toEmails = over.toEmails ?? ["leonid10588@gmail.com"];
  const ccEmails = over.ccEmails ?? ["office@trigo-models.com"];
  const bccEmails = over.bccEmails ?? [];
  return {
    id: "msg-1",
    subject: "תכנית",
    sentAt: "2026-08-04T12:11:54.000Z",
    fromEmail: "idit.fredi@gmail.com",
    fromName: "עידית פרדי",
    toEmails,
    toParticipants: toEmails.map((email) => ({
      email,
      displayName: null,
      isMailboxOwner: false,
    })),
    ccEmails,
    ccParticipants: ccEmails.map((email) => ({
      email,
      displayName: null,
      isMailboxOwner: email === "office@trigo-models.com",
    })),
    bccEmails,
    bccParticipants: [],
    replyToEmail: null,
    direction: "inbound",
    isAccountOwner: false,
    accountRelation: "cc_to_account",
    body: "תודה רבה לאוניד, הלקוח רוצה שיהיה כתוב על התכניות שלו לביצוע. אם אתה מאשר לי לשנות לו — תעדכן אותי.",
    removedNormalized: [],
    ...over,
  };
}

function action(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    type: "action",
    headline: "לאשר לעידית לעדכן את הכיתוב בתכניות ל״מאושר לביצוע״",
    context: null,
    actorName: "עידית פרדי",
    actorEmail: "idit.fredi@gmail.com",
    sourceMessageId: "msg-1",
    evidenceText: "אם אתה מאשר לי לשנות לו — תעדכן אותי",
    actionOwner: "account_owner",
    responsibilityScope: "account_owner",
    requestedAction: "לאשר לעידית לשנות את הכיתוב בתכניות",
    requester: {
      name: "עידית פרדי",
      email: "idit.fredi@gmail.com",
      evidenceText: "אם אתה מאשר לי לשנות לו — תעדכן אותי",
    },
    assignee: {
      name: "leonid gorin",
      email: "leonid10588@gmail.com",
      evidenceText: "אם אתה מאשר לי לשנות לו — תעדכן אותי",
    },
    beneficiary: {
      name: "הלקוח",
      email: null,
      evidenceText: "הלקוח רוצה שיהיה כתוב על התכניות שלו לביצוע",
    },
    requestModality: "conditional_request",
    requestSpeechAct: null,
    communicationNature: null,
    disposition: null,
    actionState: null,
    alertCategory: null,
    alertVerificationState: null,
    attributionConfidence: 0.92,
    semanticPrecisionConfidence: 0.95,
    requestEvidence: null,
    subjectEvidence: null,
    contextEvidence: null,
    businessObjectEvidence: null,
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
    occurredAt: "2026-08-04T12:11:54.000Z",
    requestedAt: "2026-08-04T12:11:54.000Z",
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    confidence: 0.92,
    businessRelevanceConfidence: 0.9,
    topicKey: "plan-label",
    replacesSourceMessageId: null,
    ...over,
  };
}

const dedupe = (c: FeedCandidate) =>
  computeDedupeKey({
    userId: "u1",
    threadId: "t1",
    sourceMessageId: c.sourceMessageId,
    type: c.type,
    evidenceText: c.evidenceText,
  });

describe("resolveResponsibilityScope", () => {
  it("never treats unmatched assignee as account_owner", () => {
    expect(
      resolveResponsibilityScope("leonid10588@gmail.com", ownerIdentities),
    ).toBe("external_person");
    expect(resolveResponsibilityScope(null, ownerIdentities)).toBe("unknown");
    expect(
      resolveResponsibilityScope("office@trigo-models.com", ownerIdentities),
    ).toBe("account_owner");
  });

  it("maps verified_team aliases", () => {
    const ids = loadAccountIdentities({
      primaryEmail: "owner@biz.co.il",
      aliases: [{ email: "team@biz.co.il", type: "verified_team" }],
    });
    expect(resolveResponsibilityScope("team@biz.co.il", ids)).toBe(
      "account_owner_team",
    );
  });
});

describe("O5A.2 attribution fixtures", () => {
  it("1: Idit asks Leonid — external_person, dueAt null", () => {
    const { accepted, rejected } = validateFeedCandidates({
      candidates: [action()],
      messages: [msg()],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(rejected).toHaveLength(0);
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
    expect(accepted[0]?.requestDirection).toBe("external_to_external");
    expect(accepted[0]?.dueAt).toBeNull();
    expect(accepted[0]?.beneficiary?.name).toBe("הלקוח");
  });

  it("2: David is account owner with Thursday due", () => {
    const body =
      "דוד, נא אשר את התכנית עד יום חמישי";
    const { accepted } = validateFeedCandidates({
      candidates: [
        action({
          headline: "לאשר את התכנית עד יום חמישי",
          evidenceText: body,
          requestedAction: "לאשר את התכנית",
          requester: {
            name: "לקוח",
            email: "client@x.com",
            evidenceText: body,
          },
          assignee: {
            name: "דוד",
            email: "david@biz.co.il",
            evidenceText: body,
          },
          beneficiary: null,
          requestModality: "direct_request",
          dueAt: "2026-08-07T00:00:00.000Z",
          dueEvidenceText: "עד יום חמישי",
          dueSourceMessageId: "msg-1",
        }),
      ],
      messages: [
        msg({
          fromEmail: "client@x.com",
          fromName: "לקוח",
          toEmails: ["david@biz.co.il"],
          ccEmails: [],
          body,
        }),
      ],
      accountIdentities: davidIsOwner,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(accepted[0]?.responsibilityScope).toBe("account_owner");
    expect(accepted[0]?.requestDirection).toBe("requested_from_account_owner");
    expect(accepted[0]?.dueAt).toBeTruthy();
    expect(accepted[0]?.dueEvidenceText).toBe("עד יום חמישי");
  });

  it("3: same message but David external", () => {
    const body = "דוד, נא אשר את התכנית עד יום חמישי";
    const { accepted } = validateFeedCandidates({
      candidates: [
        action({
          headline: "לאשר את התכנית עד יום חמישי",
          evidenceText: body,
          requester: {
            name: "לקוח",
            email: "client@x.com",
            evidenceText: body,
          },
          assignee: {
            name: "דוד",
            email: "david@other.com",
            evidenceText: body,
          },
          dueAt: "2026-08-07T00:00:00.000Z",
          dueEvidenceText: "עד יום חמישי",
          dueSourceMessageId: "msg-1",
        }),
      ],
      messages: [
        msg({
          fromEmail: "client@x.com",
          toEmails: ["david@other.com"],
          ccEmails: [],
          body,
        }),
      ],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
  });

  it("4: outbound commitment tomorrow", () => {
    const body = "אני אשלח לך את הקובץ מחר";
    const { accepted } = validateFeedCandidates({
      candidates: [
        action({
          headline: "לשלוח את הקובץ מחר",
          evidenceText: body,
          requestModality: "commitment",
          requester: {
            name: "מאור",
            email: "office@trigo-models.com",
            evidenceText: body,
          },
          assignee: {
            name: "מאור",
            email: "office@trigo-models.com",
            evidenceText: body,
          },
          beneficiary: null,
          dueAt: "2026-08-05T00:00:00.000Z",
          dueEvidenceText: "מחר",
          dueSourceMessageId: "msg-1",
        }),
      ],
      messages: [
        msg({
          fromEmail: "office@trigo-models.com",
          fromName: "מאור",
          toEmails: ["client@x.com"],
          ccEmails: [],
          direction: "outbound",
          isAccountOwner: true,
          body,
        }),
      ],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(accepted[0]?.responsibilityScope).toBe("account_owner");
    expect(accepted[0]?.requestDirection).toBe("self_commitment");
    expect(accepted[0]?.dueEvidenceText).toBe("מחר");
  });

  it("5: client wants change without assignee → unknown rejected", () => {
    const body = "הלקוח רוצה שנבצע שינוי";
    const { rejected } = validateFeedCandidates({
      candidates: [
        action({
          headline: "לבצע שינוי עבור הלקוח",
          evidenceText: body,
          requester: {
            name: "שולח",
            email: "pm@x.com",
            evidenceText: body,
          },
          assignee: null,
          responsibilityScope: "unknown",
          actionOwner: "unknown",
        }),
      ],
      messages: [
        msg({
          fromEmail: "pm@x.com",
          toEmails: ["office@trigo-models.com"],
          ccEmails: [],
          body,
        }),
      ],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(rejected[0]?.reason).toMatch(
      /action_unknown_responsibility|speech_act_not_actionable/,
    );
  });

  it("6: quoted-only request → evidence removed/not in clean", () => {
    const raw =
      "תודה.\n\nבתאריך יום ג׳, 4 באוג׳ 2026 ב-6:43 מאת leonid: נא אשר את התכנית";
    const cleaned = cleanFeedMessageBody(raw);
    expect(cleaned.cleanText).not.toContain("נא אשר את התכנית");
    const { rejected } = validateFeedCandidates({
      candidates: [
        action({
          evidenceText: "נא אשר את התכנית",
          headline: "לאשר את התכנית",
        }),
      ],
      messages: [
        msg({
          body: cleaned.cleanText,
          removedNormalized: cleaned.removedNormalized,
        }),
      ],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(
      ["evidence_not_found", "evidence_from_removed_section"].includes(
        rejected[0]?.reason ?? "",
      ),
    ).toBe(true);
  });

  it("7: conditional_request modality preserved after recompute", () => {
    const { accepted } = validateFeedCandidates({
      candidates: [action({ requestModality: "conditional_request" })],
      messages: [msg()],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(accepted[0]?.requestModality).toBe("conditional_request");
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
  });

  it("8: no date → due cleared / null", () => {
    const { accepted } = validateFeedCandidates({
      candidates: [action({ dueAt: null })],
      messages: [msg()],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("9: due only in quoted header → due cleared to null", () => {
    const cleaned = cleanFeedMessageBody(
      "תודה רבה.\nבתאריך יום ג׳, 4 באוג׳ 2026 ב-6:43 מאת x: עד מחר",
    );
    const { accepted, rejected } = validateFeedCandidates({
      candidates: [
        action({
          dueAt: "2026-08-05T00:00:00.000Z",
          dueEvidenceText: "עד מחר",
          dueSourceMessageId: "msg-1",
          evidenceText: "תודה רבה",
          headline: "להגיב",
          requestedAction: "להגיב",
        }),
      ],
      messages: [
        msg({
          body: cleaned.cleanText || "תודה רבה",
          removedNormalized: cleaned.removedNormalized,
        }),
      ],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(rejected.length).toBeGreaterThan(0);
    expect(accepted).toHaveLength(0);
  });

  it("10: CC-only does not make account the assignee", () => {
    const { accepted } = validateFeedCandidates({
      candidates: [
        action({
          // model wrongly claims account_owner because office is CC
          actionOwner: "account_owner",
          responsibilityScope: "account_owner",
          assignee: {
            name: "leonid",
            email: "leonid10588@gmail.com",
            evidenceText: "אם אתה מאשר לי לשנות לו — תעדכן אותי",
          },
        }),
      ],
      messages: [msg()],
      accountIdentities: ownerIdentities,
      minConfidence: 0.8,
      minBusinessRelevance: 0.85,
      existingDedupeKeys: new Set(),
      computeDedupeKey: dedupe,
    });
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
  });
});
