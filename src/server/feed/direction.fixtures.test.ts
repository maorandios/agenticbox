import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cleanFeedMessageBody } from "@/server/feed/clean-content";
import { computeDedupeKey } from "@/server/feed/context";
import {
  loadAccountIdentities,
  normalizeEmailAddress,
  resolveMessageAccountRelation,
  resolveRequestAttribution,
} from "@/server/feed/identity";
import { validateFeedCandidates } from "@/server/feed/validate";
import type { FeedCandidate } from "@/server/feed/schemas";
import type { FeedContextMessage } from "@/server/feed/context";

const identities = loadAccountIdentities({
  primaryEmail: "office@trigo-models.com",
  aliases: [],
});

function msg(over: Partial<FeedContextMessage> = {}): FeedContextMessage {
  const base: FeedContextMessage = {
    id: "msg-1",
    subject: "נושא",
    sentAt: "2026-08-04T07:08:00.000Z",
    fromEmail: "office@trigo-models.com",
    fromName: "מאור | טריגו מידול והנדסה",
    toEmails: ["idit.fredi@gmail.com"],
    toParticipants: [
      {
        email: "idit.fredi@gmail.com",
        displayName: "עידית פרדי",
        isMailboxOwner: false,
      },
    ],
    ccEmails: [],
    ccParticipants: [],
    bccEmails: [],
    bccParticipants: [],
    replyToEmail: null,
    direction: "outbound",
    isAccountOwner: true,
    accountRelation: "sent_by_account",
    body: "חסר אוטוקאד",
    removedNormalized: [],
  };
  const merged = { ...base, ...over };
  if (!over.toParticipants && over.toEmails) {
    merged.toParticipants = over.toEmails.map((email) => ({
      email,
      displayName: null,
      isMailboxOwner: email === "office@trigo-models.com",
    }));
  }
  if (!over.ccParticipants && over.ccEmails) {
    merged.ccParticipants = over.ccEmails.map((email) => ({
      email,
      displayName: null,
      isMailboxOwner: email === "office@trigo-models.com",
    }));
  }
  if (!over.accountRelation) {
    merged.accountRelation = resolveMessageAccountRelation({
      fromEmail: merged.fromEmail,
      toEmails: merged.toEmails,
      ccEmails: merged.ccEmails,
      bccEmails: merged.bccEmails,
      accountIdentities: identities,
    });
    merged.isAccountOwner = merged.accountRelation === "sent_by_account";
  }
  return merged;
}

function action(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    type: "action",
    headline: "עידית מתבקשת לשלוח את קובץ האוטוקאד החסר",
    context: null,
    actorName: "מאור",
    actorEmail: "office@trigo-models.com",
    sourceMessageId: "msg-1",
    evidenceText: "חסר אוטוקאד",
    actionOwner: "account_owner",
    responsibilityScope: "account_owner",
    requestDirection: null,
    requestedAction: "לשלוח או להשלים את קובץ האוטוקאד החסר",
    requester: {
      name: "מאור | טריגו מידול והנדסה",
      email: "office@trigo-models.com",
      evidenceText: "חסר אוטוקאד",
    },
    assignee: {
      name: "עידית פרדי",
      email: "idit.fredi@gmail.com",
      evidenceText: "חסר אוטוקאד",
    },
    beneficiary: null,
    requestModality: "implicit_request",
    requestSpeechAct: null,
    communicationNature: null,
    disposition: null,
    actionState: null,
    alertCategory: null,
    alertVerificationState: null,
    attributionConfidence: 0.9,
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
    businessObject: null,
    previousValue: null,
    currentValue: null,
    occurredAt: "2026-08-04T07:08:00.000Z",
    requestedAt: "2026-08-04T07:08:00.000Z",
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    confidence: 0.9,
    businessRelevanceConfidence: 0.9,
    topicKey: "autocad-missing",
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

function run(candidate: FeedCandidate, message: FeedContextMessage) {
  return validateFeedCandidates({
    candidates: [candidate],
    messages: [message],
    accountIdentities: identities,
    minConfidence: 0.8,
    minBusinessRelevance: 0.85,
    existingDedupeKeys: new Set(),
    computeDedupeKey: dedupe,
  });
}

describe("normalizeEmailAddress", () => {
  it("10: casing / angle brackets / mailto / invisible", () => {
    expect(
      normalizeEmailAddress(" מאור <Office@Trigo-Models.com> "),
    ).toBe("office@trigo-models.com");
    expect(normalizeEmailAddress("mailto:office@trigo-models.com")).toBe(
      "office@trigo-models.com",
    );
    expect(
      normalizeEmailAddress("\u200foffice@trigo-models.com\u200e"),
    ).toBe("office@trigo-models.com");
  });

  it("does not strip +tag", () => {
    expect(normalizeEmailAddress("office+tag@trigo-models.com")).toBe(
      "office+tag@trigo-models.com",
    );
  });
});

describe("MessageAccountRelation", () => {
  it("sent_by / sent_to / cc / external", () => {
    expect(
      resolveMessageAccountRelation({
        fromEmail: "office@trigo-models.com",
        toEmails: ["idit.fredi@gmail.com"],
        ccEmails: [],
        bccEmails: [],
        accountIdentities: identities,
      }),
    ).toBe("sent_by_account");
    expect(
      resolveMessageAccountRelation({
        fromEmail: "idit.fredi@gmail.com",
        toEmails: ["office@trigo-models.com"],
        ccEmails: [],
        bccEmails: [],
        accountIdentities: identities,
      }),
    ).toBe("sent_to_account");
    expect(
      resolveMessageAccountRelation({
        fromEmail: "idit.fredi@gmail.com",
        toEmails: ["leonid10588@gmail.com"],
        ccEmails: ["office@trigo-models.com"],
        bccEmails: [],
        accountIdentities: identities,
      }),
    ).toBe("cc_to_account");
    expect(
      resolveMessageAccountRelation({
        fromEmail: "idit.fredi@gmail.com",
        toEmails: ["leonid10588@gmail.com"],
        ccEmails: [],
        bccEmails: [],
        accountIdentities: identities,
      }),
    ).toBe("external_to_external");
  });
});

describe("O5A.2 direction fixtures", () => {
  it("1: office → עידית חסר אוטוקאד = sent_by_account_owner", () => {
    const { accepted, rejected } = run(action(), msg());
    expect(rejected).toHaveLength(0);
    expect(accepted[0]?.requestDirection).toBe("sent_by_account_owner");
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
    expect(accepted[0]?.assignee?.email).toBe("idit.fredi@gmail.com");
    expect(accepted[0]?.dueAt).toBeNull();
    expect(accepted[0]?.requestModality).toBe("implicit_request");
  });

  it("2: office → רותם נא לאשר = sent_by_account_owner", () => {
    const body = "היי מצב GA סופי לאישור כולל מידות, גבהים וכו'. נא לאשר לביצוע";
    const { accepted } = run(
      action({
        headline: "רותם מאיר מתבקש לאשר את מצב ה-GA הסופי לביצוע",
        evidenceText: "נא לאשר לביצוע",
        requestedAction: "לאשר את מצב ה-GA הסופי לביצוע",
        requestModality: "direct_request",
        assignee: {
          name: "רותם מאיר",
          email: "rotem@yarin-eng.co.il",
          evidenceText: "נא לאשר לביצוע",
        },
        topicKey: "ga-final",
      }),
      msg({
        toEmails: ["rotem@yarin-eng.co.il"],
        fromName: "office",
        body,
        sentAt: "2026-07-26T11:08:00.000Z",
      }),
    );
    expect(accepted[0]?.requestDirection).toBe("sent_by_account_owner");
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("3: עידית → לאוניד = external_to_external", () => {
    const body =
      "תודה רבה לאוניד, הלקוח רוצה שיהיה כתוב על התכניות שלו לביצוע. אם אתה מאשר לי לשנות לו - תעדכן אותי.";
    const { accepted } = run(
      action({
        headline: "לאוניד מתבקש לאשר לעידית לשנות את הכיתוב בתכניות ל״מאושר לביצוע״",
        evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        requestedAction:
          "לאשר לעידית לשנות את הכיתוב בתכניות ל״מאושר לביצוע״",
        requestModality: "conditional_request",
        requester: {
          name: "עידית פרדי",
          email: "idit.fredi@gmail.com",
          evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        },
        assignee: {
          name: "לאוניד גורין",
          email: "leonid10588@gmail.com",
          evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        },
        beneficiary: {
          name: "הלקוח",
          email: null,
          evidenceText: "הלקוח רוצה שיהיה כתוב על התכניות שלו לביצוע",
        },
        topicKey: "plan-label",
      }),
      msg({
        fromEmail: "idit.fredi@gmail.com",
        fromName: "עידית פרדי",
        toEmails: ["leonid10588@gmail.com"],
        ccEmails: ["office@trigo-models.com"],
        direction: "inbound",
        body,
      }),
    );
    expect(accepted[0]?.requestDirection).toBe("external_to_external");
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
    expect(accepted[0]?.dueAt).toBeNull();
    expect(accepted[0]?.beneficiary?.name).toBe("הלקוח");
  });

  it("4: external → office נא לשלוח = requested_from_account_owner", () => {
    const body = "מאור, נא לשלוח את הקובץ";
    const { accepted } = run(
      action({
        headline: "לשלוח את הקובץ",
        evidenceText: body,
        requestedAction: "לשלוח את הקובץ",
        requestModality: "direct_request",
        requester: {
          name: "עידית",
          email: "idit.fredi@gmail.com",
          evidenceText: body,
        },
        assignee: {
          name: "מאור",
          email: "office@trigo-models.com",
          evidenceText: body,
        },
      }),
      msg({
        fromEmail: "idit.fredi@gmail.com",
        toEmails: ["office@trigo-models.com"],
        direction: "inbound",
        body,
      }),
    );
    expect(accepted[0]?.requestDirection).toBe("requested_from_account_owner");
    expect(accepted[0]?.responsibilityScope).toBe("account_owner");
  });

  it("5: outbound אני אשלח מחר = self_commitment + due", () => {
    const body = "אני אשלח את הקובץ מחר";
    const { accepted } = run(
      action({
        headline: "לשלוח את הקובץ מחר",
        evidenceText: body,
        requestedAction: "לשלוח את הקובץ",
        requestModality: "commitment",
        assignee: {
          name: "מאור",
          email: "office@trigo-models.com",
          evidenceText: body,
        },
        dueAt: "2026-08-05T00:00:00.000Z",
        dueEvidenceText: "מחר",
        dueSourceMessageId: "msg-1",
      }),
      msg({ toEmails: ["client@x.com"], body }),
    );
    expect(accepted[0]?.requestDirection).toBe("self_commitment");
    expect(accepted[0]?.responsibilityScope).toBe("account_owner");
    expect(accepted[0]?.dueEvidenceText).toBe("מחר");
  });

  it("6: outbound נא לשלוח מחר = assignee external, not owner", () => {
    const body = "נא לשלוח את הקובץ מחר";
    const { accepted } = run(
      action({
        headline: "עידית מתבקשת לשלוח את הקובץ מחר",
        evidenceText: body,
        requestedAction: "לשלוח את הקובץ",
        requestModality: "direct_request",
        assignee: {
          name: "עידית",
          email: "idit.fredi@gmail.com",
          evidenceText: body,
        },
        dueAt: "2026-08-05T00:00:00.000Z",
        dueEvidenceText: "מחר",
        dueSourceMessageId: "msg-1",
      }),
      msg({ body }),
    );
    expect(accepted[0]?.requestDirection).toBe("sent_by_account_owner");
    expect(accepted[0]?.responsibilityScope).toBe("external_person");
    expect(accepted[0]?.assignee?.email).toBe("idit.fredi@gmail.com");
  });

  it("7: user only on CC — not assignee", () => {
    const body = "אם אתה מאשר לי לשנות לו - תעדכן אותי";
    const { accepted, rejected } = run(
      action({
        headline: "לאוניד מתבקש לאשר שינוי כיתוב",
        evidenceText: body,
        requestModality: "conditional_request",
        requester: {
          name: "עידית",
          email: "idit.fredi@gmail.com",
          evidenceText: body,
        },
        // Wrong model guess: office is assignee because CC
        assignee: {
          name: "מאור",
          email: "office@trigo-models.com",
          evidenceText: body,
        },
      }),
      msg({
        fromEmail: "idit.fredi@gmail.com",
        toEmails: ["leonid10588@gmail.com"],
        ccEmails: ["office@trigo-models.com"],
        direction: "inbound",
        body,
      }),
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("assignee_evidence_invalid");
  });

  it("8: neither sender nor recipient = external_to_external", () => {
    expect(
      resolveRequestAttribution({
        requesterEmail: "idit.fredi@gmail.com",
        assigneeEmail: "leonid10588@gmail.com",
        requestModality: "conditional_request",
        sourceFromEmail: "idit.fredi@gmail.com",
        accountIdentities: identities,
      }),
    ).toMatchObject({
      requestDirection: "external_to_external",
      responsibilityScope: "external_person",
    });
  });

  it("9: display name מאור but external email ≠ owner", () => {
    expect(
      resolveRequestAttribution({
        requesterEmail: "maor.external@gmail.com",
        assigneeEmail: "idit.fredi@gmail.com",
        requestModality: "direct_request",
        sourceFromEmail: "maor.external@gmail.com",
        accountIdentities: identities,
      }).responsibilityScope,
    ).toBe("external_person");
    expect(
      resolveMessageAccountRelation({
        fromEmail: "maor.external@gmail.com",
        toEmails: ["idit.fredi@gmail.com"],
        ccEmails: [],
        bccEmails: [],
        accountIdentities: identities,
      }),
    ).toBe("external_to_external");
  });

  it("11: deadline only in quoted history → dueAt cleared", () => {
    const raw =
      "תודה.\nOn Tue, Aug 4, 2026 at 10:06 AM Idit wrote:\nעד מחר נא לשלוח";
    const cleaned = cleanFeedMessageBody(raw);
    expect(cleaned.cleanText.toLowerCase()).not.toContain("עד מחר");
    const { accepted, rejected } = run(
      action({
        headline: "להודות",
        evidenceText: "תודה",
        requestedAction: "להודות",
        dueAt: "2026-08-05T00:00:00.000Z",
        dueEvidenceText: "עד מחר",
        dueSourceMessageId: "msg-1",
        requestModality: "information_only",
        assignee: {
          name: "עידית",
          email: "idit.fredi@gmail.com",
          evidenceText: "תודה",
        },
      }),
      msg({
        body: cleaned.cleanText || "תודה",
        removedNormalized: cleaned.removedNormalized,
      }),
    );
    expect(rejected.length).toBeGreaterThan(0);
    expect(accepted).toHaveLength(0);
  });

  it("12: prior approval then new final-version request stays open", () => {
    // Current message asks again; prior "מאושר" is context only.
    const body = "היי מצב GA סופי לאישור. נא לאשר לביצוע";
    const { accepted } = run(
      action({
        headline: "רותם מאיר מתבקש לאשר את מצב ה-GA הסופי לביצוע",
        evidenceText: "נא לאשר לביצוע",
        requestedAction: "לאשר את מצב ה-GA הסופי לביצוע",
        requestModality: "direct_request",
        assignee: {
          name: "רותם מאיר",
          email: "rotem@yarin-eng.co.il",
          evidenceText: "נא לאשר לביצוע",
        },
      }),
      msg({
        toEmails: ["rotem@yarin-eng.co.il"],
        body,
        removedNormalized: [
          "לאחר שיחתי עם מאור יש לראות מודל זה כמאושר".toLowerCase(),
        ],
      }),
    );
    expect(accepted[0]?.requestDirection).toBe("sent_by_account_owner");
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("inline On…wrote quote split keeps current lead-in", () => {
    const cleaned = cleanFeedMessageBody(
      "חסר אוטוקאדOn Tue, Aug 4, 2026 at 10:06 AM עידית פרדי <idit.fredi@gmail.com> wrote:הי משה מצרפת",
    );
    expect(cleaned.cleanText).toContain("חסר אוטוקאד");
    expect(cleaned.cleanText).not.toContain("מצרפת");
  });
});
