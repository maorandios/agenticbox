import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeActionHeadline, resolveFeedRequestCard } from "@/server/feed/compose";
import { computeDedupeKey } from "@/server/feed/context";
import {
  buildCanonicalParticipantRegistry,
  resolveCanonicalParticipantName,
  resolveMailboxIdentity,
  resolveMessageAccountRelation,
  resolveRequestAttribution,
} from "@/server/feed/identity";
import { validateFeedCandidates } from "@/server/feed/validate";
import type { FeedCandidate } from "@/server/feed/schemas";
import type { FeedContextMessage, FeedParticipantRef } from "@/server/feed/context";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-1",
  primaryEmail: "office@trigo-models.com",
  aliases: [],
});

const identities = [
  { email: "office@trigo-models.com", type: "primary" as const },
];

function parts(
  emails: string[],
  names: Array<string | null> = [],
): FeedParticipantRef[] {
  return emails.map((email, i) => ({
    email,
    displayName: names[i] ?? null,
    isMailboxOwner: email.toLowerCase() === "office@trigo-models.com",
  }));
}

function msg(over: Partial<FeedContextMessage> = {}): FeedContextMessage {
  const toEmails = over.toEmails ?? ["office@trigo-models.com", "meirlevit3@gmail.com"];
  const ccEmails = over.ccEmails ?? [];
  const bccEmails = over.bccEmails ?? [];
  const base: FeedContextMessage = {
    id: "msg-1",
    subject: "פלטה",
    sentAt: "2026-07-26T05:47:58.000Z",
    fromEmail: "office@gaash-m.co.il",
    fromName: "office gaash",
    toEmails,
    toParticipants: parts(toEmails, [
      "מאור | טריגו מידול והנדסה",
      "Meir Levit",
    ]),
    ccEmails,
    ccParticipants: parts(ccEmails),
    bccEmails,
    bccParticipants: parts(bccEmails),
    replyToEmail: null,
    direction: "inbound",
    isAccountOwner: false,
    accountRelation: "sent_to_account",
    body: "מאור תבדוק למאיר מה הבעיה בפלטה הלא תקינה ותענה לו ישירות בבקשה",
    removedNormalized: ["פלטה dxf p1003 לא תקין"],
  };
  const merged = { ...base, ...over };
  if (!over.toParticipants && over.toEmails) {
    merged.toParticipants = parts(over.toEmails);
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
    headline: "טיוטה",
    context: null,
    actorName: "office gaash",
    actorEmail: "office@gaash-m.co.il",
    sourceMessageId: "msg-1",
    evidenceText:
      "מאור תבדוק למאיר מה הבעיה בפלטה הלא תקינה ותענה לו ישירות בבקשה",
    actionOwner: "account_owner",
    responsibilityScope: "account_owner",
    requestedAction:
      "לבדוק עבור מאיר את הבעיה בפלטת DXF P1003 ולהשיב לו ישירות",
    actionVerb: "לבדוק",
    actionObject: "פלטת DXF P1003",
    actionPurpose: "להשיב למאיר ישירות",
    requester: {
      name: "office gaash",
      email: "office@gaash-m.co.il",
      evidenceText:
        "מאור תבדוק למאיר מה הבעיה בפלטה הלא תקינה ותענה לו ישירות בבקשה",
    },
    assignee: {
      name: "מאור",
      email: "office@trigo-models.com",
      evidenceText: "מאור תבדוק",
    },
    beneficiary: {
      name: "Meir Levit",
      email: "meirlevit3@gmail.com",
      evidenceText: "למאיר",
    },
    responseRecipient: {
      name: "Meir Levit",
      email: "meirlevit3@gmail.com",
      evidenceText: "תענה לו ישירות",
    },
    requestModality: "direct_request",
    requestSpeechAct: null,
    communicationNature: null,
    disposition: null,
    actionState: null,
    alertCategory: null,
    alertVerificationState: null,
    attributionConfidence: 0.95,
    semanticPrecisionConfidence: 0.95,
    requestEvidence: {
      sourceMessageId: "msg-1",
      evidenceText:
        "מאור תבדוק למאיר מה הבעיה בפלטה הלא תקינה ותענה לו ישירות בבקשה",
      evidenceType: "request",
      fromCurrentMessage: true,
    },
    subjectEvidence: null,
    contextEvidence: null,
    businessObjectEvidence: null,
    supportingEvidence: [
      {
        sourceMessageId: "msg-0",
        evidenceText: "פלטה DXF P1003 לא תקין",
        evidenceType: "business_object",
        fromCurrentMessage: false,
      },
    ],
    relationToMailbox: null,
    requestDirection: null,
    businessObject: "P1003",
    previousValue: null,
    currentValue: null,
    occurredAt: "2026-07-26T05:47:58.000Z",
    requestedAt: "2026-07-26T05:47:58.000Z",
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    confidence: 0.95,
    businessRelevanceConfidence: 0.95,
    topicKey: "plate-p1003",
    replacesSourceMessageId: null,
    ...over,
  } as FeedCandidate;
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
    mailboxIdentity: mailbox,
    minConfidence: 0.8,
    minBusinessRelevance: 0.85,
    existingDedupeKeys: new Set(),
    computeDedupeKey: dedupe,
  });
}

describe("O5A.3 canonical names", () => {
  it("9: all From variants resolve to one canonical mailbox name", () => {
    for (const source of [
      "office",
      "מאור",
      "מאור | טריגו מידול והנדסה",
      null,
    ]) {
      expect(
        resolveCanonicalParticipantName({
          email: "OFFICE@TRIGO-MODELS.COM",
          sourceDisplayName: source,
          mailboxIdentity: mailbox,
        }),
      ).toBe("מאור | טריגו מידול והנדסה");
    }
    expect(
      resolveCanonicalParticipantName({
        email: "office@gaash-m.co.il",
        sourceDisplayName: "office gaash",
        mailboxIdentity: mailbox,
      }),
    ).toBe("office gaash");
  });
});

describe("O5A.3 golden fixtures", () => {
  it("1: gaash → מאור + מאיר = requested_from_me", () => {
    const { accepted, rejected } = run(action(), msg());
    expect(rejected).toHaveLength(0);
    expect(accepted[0]?.relationToMailbox).toBe("requested_from_me");
    expect(accepted[0]?.requester?.email).toBe("office@gaash-m.co.il");
    expect(accepted[0]?.assignee?.email).toBe("office@trigo-models.com");
    expect(accepted[0]?.assignee?.name).toBe("מאור | טריגו מידול והנדסה");
    expect(accepted[0]?.beneficiary?.email).toBe("meirlevit3@gmail.com");
    expect(accepted[0]?.responseRecipient?.email).toBe("meirlevit3@gmail.com");
    expect(accepted[0]?.dueAt).toBeNull();
    expect(accepted[0]?.requester?.name).not.toBe(
      "מאור | טריגו מידול והנדסה",
    );
  });

  it("2: עידית → לאוניד exact caption semantics", () => {
    const body =
      "הלקוח רוצה שיהיה כתוב על התכניות שלו לביצוע. אם אתה מאשר לי לשנות לו - תעדכן אותי.";
    const { accepted } = run(
      action({
        evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        requestedAction:
          "לאשר לעידית לציין על התכניות שהן מאושרות לביצוע",
        requestModality: "conditional_request",
        semanticPrecisionConfidence: 0.95,
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
        responseRecipient: null,
        supportingEvidence: [],
      }),
      msg({
        fromEmail: "idit.fredi@gmail.com",
        fromName: "עידית פרדי",
        toEmails: ["leonid10588@gmail.com"],
        toParticipants: parts(["leonid10588@gmail.com"], ["לאוניד גורין"]),
        ccEmails: ["office@trigo-models.com"],
        ccParticipants: parts(["office@trigo-models.com"]),
        body,
        removedNormalized: [],
      }),
    );
    expect(accepted[0]?.relationToMailbox).toBe("external_to_external");
    expect(accepted[0]?.requestedAction).toMatch(/לציין על התכניות/);
    expect(accepted[0]?.requestedAction).not.toMatch(/לאשר את (?:התכנית|המסמך)/);
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("3: מאור → עידית חסר אוטוקאד = sent_by_me", () => {
    const { accepted } = run(
      action({
        evidenceText: "חסר אוטוקאד",
        requestedAction: "לשלוח את קובץ האוטוקאד החסר",
        requestModality: "implicit_request",
        requester: {
          name: "office",
          email: "office@trigo-models.com",
          evidenceText: "חסר אוטוקאד",
        },
        assignee: {
          name: "עידית פרדי",
          email: "idit.fredi@gmail.com",
          evidenceText: "חסר אוטוקאד",
        },
        beneficiary: null,
        responseRecipient: null,
        supportingEvidence: [],
      }),
      msg({
        fromEmail: "office@trigo-models.com",
        fromName: "office",
        toEmails: ["idit.fredi@gmail.com"],
        toParticipants: parts(["idit.fredi@gmail.com"], ["עידית פרדי"]),
        body: "חסר אוטוקאד",
        direction: "outbound",
        removedNormalized: [],
      }),
    );
    expect(accepted[0]?.relationToMailbox).toBe("sent_by_me");
    expect(accepted[0]?.requester?.name).toBe("מאור | טריגו מידול והנדסה");
    expect(accepted[0]?.assignee?.email).toBe("idit.fredi@gmail.com");
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("4: מאור → רותם נא לאשר GA = sent_by_me", () => {
    const body = "מצב GA סופי לאישור כולל מידות, גבהים וכו'. נא לאשר לביצוע";
    const { accepted } = run(
      action({
        evidenceText: "נא לאשר לביצוע",
        requestedAction: "לאשר את מצב ה-GA הסופי לביצוע",
        requestModality: "direct_request",
        requester: {
          name: "מאור",
          email: "office@trigo-models.com",
          evidenceText: "נא לאשר לביצוע",
        },
        assignee: {
          name: "רותם מאיר",
          email: "rotem@yarin-eng.co.il",
          evidenceText: "נא לאשר לביצוע",
        },
        beneficiary: null,
        responseRecipient: null,
      }),
      msg({
        fromEmail: "office@trigo-models.com",
        fromName: "מאור",
        toEmails: ["rotem@yarin-eng.co.il"],
        toParticipants: parts(["rotem@yarin-eng.co.il"], ["rotem mair"]),
        body,
        direction: "outbound",
        removedNormalized: [],
      }),
    );
    expect(accepted[0]?.relationToMailbox).toBe("sent_by_me");
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("5: two TO — only addressed party is assignee", () => {
    const { accepted } = run(action(), msg());
    expect(accepted[0]?.assignee?.email).toBe("office@trigo-models.com");
    expect(accepted[0]?.assignee?.email).not.toBe("meirlevit3@gmail.com");
  });

  it("6: mailbox in TO and named → requested_from_me", () => {
    expect(
      resolveRequestAttribution({
        requesterEmail: "office@gaash-m.co.il",
        assigneeEmail: "office@trigo-models.com",
        requestModality: "direct_request",
        sourceFromEmail: "office@gaash-m.co.il",
        accountIdentities: identities,
      }).relationToMailbox,
    ).toBe("requested_from_me");
  });

  it("7: mailbox only CC → not auto assignee", () => {
    const { rejected } = run(
      action({
        evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        requestedAction: "לאשר שינוי כיתוב",
        assignee: {
          name: "מאור",
          email: "office@trigo-models.com",
          evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        },
        requester: {
          name: "עידית",
          email: "idit.fredi@gmail.com",
          evidenceText: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        },
      }),
      msg({
        fromEmail: "idit.fredi@gmail.com",
        toEmails: ["leonid10588@gmail.com"],
        toParticipants: parts(["leonid10588@gmail.com"]),
        ccEmails: ["office@trigo-models.com"],
        ccParticipants: parts(["office@trigo-models.com"]),
        body: "אם אתה מאשר לי לשנות לו - תעדכן אותי",
        removedNormalized: [],
      }),
    );
    expect(rejected[0]?.reason).toMatch(
      /assignee_evidence_invalid|action_state_not_open/,
    );
  });

  it("8: external sender is requester not mailbox", () => {
    const { accepted } = run(action(), msg());
    expect(accepted[0]?.requester?.email).toBe("office@gaash-m.co.il");
    expect(accepted[0]?.actorEmail).toBe("office@gaash-m.co.il");
  });

  it("10: quoted business object only as supportingEvidence", () => {
    const { accepted } = run(action(), msg());
    expect(accepted[0]?.supportingEvidence?.[0]?.fromCurrentMessage).toBe(
      false,
    );
    expect(accepted[0]?.requestEvidence?.fromCurrentMessage).toBe(true);
  });

  it("11: quoted old request does not open action (evidence removed)", () => {
    const { rejected } = run(
      action({
        evidenceText: "נא אשר את התכנית",
      }),
      msg({
        body: "תודה",
        removedNormalized: ["נא אשר את התכנית"],
      }),
    );
    expect(
      ["evidence_not_found", "evidence_from_removed_section"].includes(
        rejected[0]?.reason ?? "",
      ),
    ).toBe(true);
  });

  it("12: no temporal expression → dueAt null", () => {
    const { accepted } = run(
      action({
        dueAt: "2026-07-29T00:00:00.000Z",
        dueEvidenceText: "נא לאשר",
        dueSourceMessageId: "msg-1",
      }),
      msg(),
    );
    expect(accepted[0]?.dueAt).toBeNull();
  });

  it("13: requestedAt shown once in card composition", () => {
    const card = resolveFeedRequestCard({
      mailboxIdentity: mailbox,
      knownParticipants: buildCanonicalParticipantRegistry({
        mailboxIdentity: mailbox,
        participants: [
          { email: "office@gaash-m.co.il", displayName: "office gaash" },
          {
            email: "office@trigo-models.com",
            displayName: "מאור",
          },
        ],
      }),
      relationToMailbox: "requested_from_me",
      requesterEmail: "office@gaash-m.co.il",
      requesterName: "office gaash",
      assigneeEmail: "office@trigo-models.com",
      assigneeName: "מאור",
      requestedAction:
        "לבדוק עבור מאיר את הבעיה בפלטת DXF P1003 ולהשיב לו ישירות",
      requestedAt: "2026-07-26T05:47:58.000Z",
      dueAt: null,
    });
    expect(card.askLine).toBeNull();
    expect(card.typeLabel).toBe("נדרשת ממך פעולה");
    expect(card.assigneeDisplayName).toBe("מאור | טריגו מידול והנדסה");
    expect(card.dueAt).toBeNull();
    expect(card.attributionLine).toMatch(/office gaash →/);
    expect(card.attributionLine).toContain("2026");
    // requestedAt appears once in attributionLine only
    expect(
      (card.attributionLine.match(/2026/g) ?? []).length,
    ).toBe(1);
  });

  it("14: semanticPrecision < 0.90 rejected", () => {
    const { rejected } = run(
      action({ semanticPrecisionConfidence: 0.8 }),
      msg(),
    );
    expect(rejected[0]?.reason).toBe("semantic_precision_low");
  });

  it("compose never keeps vague plan-approval headline when action is precise", () => {
    expect(
      composeActionHeadline({
        requestedAction:
          "לאשר לעידית לציין על התכניות שהן מאושרות לביצוע",
        modelHeadline: "ביקוש אישור לשינויים בתכניות",
        relationToMailbox: "external_to_external",
        assigneeDisplayName: "לאוניד גורין",
      }),
    ).toBe("לאשר לעידית לציין על התכניות שהן מאושרות לביצוע");
  });
});
