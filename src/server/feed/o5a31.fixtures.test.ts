/**
 * O5A.3.1 — Safe replacement & golden recovery fixtures (no OpenAI).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composeActionHeadline,
  resolveFeedRequestCard,
} from "@/server/feed/compose";
import {
  buildCanonicalParticipantRegistry,
  improveExternalDisplayName,
  resolveCanonicalParticipantName,
  resolveMailboxIdentity,
  resolveRequestAttribution,
} from "@/server/feed/identity";
import { planSafeReplacement } from "@/server/feed/replace";
import { validateExtractionGate } from "@/server/feed/validate";
import { emptyIntelligenceState } from "@/server/feed/schemas";
import type { FeedExtractionResult } from "@/server/feed/schemas";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-1",
  primaryEmail: "office@trigo-models.com",
  aliases: [],
});

function gateResult(
  classification: FeedExtractionResult["threadClassification"],
): FeedExtractionResult {
  return {
    threadClassification: classification,
    skipReason: null,
    items: [],
    nextState: emptyIntelligenceState(),
  };
}

describe("O5A.3.1 safe replacement plan", () => {
  it("successful replacement supersedes only after persist", () => {
    expect(
      planSafeReplacement({
        validationOk: true,
        persistOk: true,
        oldStatus: "needs_replacement",
      }),
    ).toEqual({
      shouldSupersedeOld: true,
      nextOldStatus: "superseded",
      reportMissingReplacement: false,
    });
  });

  it("validation failure does not supersede old item", () => {
    expect(
      planSafeReplacement({
        validationOk: false,
        persistOk: false,
        oldStatus: "needs_replacement",
      }).shouldSupersedeOld,
    ).toBe(false);
  });

  it("persist failure keeps old status and reports missing replacement", () => {
    const plan = planSafeReplacement({
      validationOk: true,
      persistOk: false,
      oldStatus: "needs_replacement",
    });
    expect(plan.shouldSupersedeOld).toBe(false);
    expect(plan.nextOldStatus).toBe("needs_replacement");
    expect(plan.reportMissingReplacement).toBe(true);
  });
});

describe("O5A.3.1 business eligibility vs relation", () => {
  it("sent_by_me / uncertain are business-eligible at gate", () => {
    expect(validateExtractionGate({ result: gateResult("uncertain") }).ok).toBe(
      true,
    );
    expect(validateExtractionGate({ result: gateResult("business") }).ok).toBe(
      true,
    );
    expect(
      validateExtractionGate({ result: gateResult("informational") }).ok,
    ).toBe(true);
  });

  it("external_to_external relation is valid attribution", () => {
    expect(
      resolveRequestAttribution({
        requesterEmail: "idit.fredi@gmail.com",
        assigneeEmail: "leonid10588@gmail.com",
        requestModality: "conditional_request",
        sourceFromEmail: "idit.fredi@gmail.com",
        accountIdentities: [
          { email: "office@trigo-models.com", type: "primary" },
        ],
      }).relationToMailbox,
    ).toBe("external_to_external");
  });

  it("sent_by_me relation is valid attribution", () => {
    expect(
      resolveRequestAttribution({
        requesterEmail: "office@trigo-models.com",
        assigneeEmail: "idit.fredi@gmail.com",
        requestModality: "implicit_request",
        sourceFromEmail: "office@trigo-models.com",
        accountIdentities: [
          { email: "office@trigo-models.com", type: "primary" },
        ],
      }).relationToMailbox,
    ).toBe("sent_by_me");
  });

  it("marketing/system still rejected by gate", () => {
    expect(
      validateExtractionGate({ result: gateResult("marketing") }).ok,
    ).toBe(false);
    expect(validateExtractionGate({ result: gateResult("system") }).ok).toBe(
      false,
    );
  });
});

describe("O5A.3.1 golden card composition", () => {
  it("autocad card: sent_by_me, canonical names, requestedAt once", () => {
    const card = resolveFeedRequestCard({
      mailboxIdentity: mailbox,
      knownParticipants: buildCanonicalParticipantRegistry({
        mailboxIdentity: mailbox,
        participants: [
          { email: "office@trigo-models.com", displayName: "office" },
          { email: "idit.fredi@gmail.com", displayName: "עידית פרדי" },
        ],
      }),
      relationToMailbox: "sent_by_me",
      requesterEmail: "office@trigo-models.com",
      requesterName: "מאור",
      assigneeEmail: "idit.fredi@gmail.com",
      assigneeName: "עידית פרדי",
      requestedAction: "לשלוח את קובץ האוטוקאד החסר",
      requestedAt: "2026-08-04T07:08:00.000Z",
      dueAt: null,
    });
    expect(card.typeLabel).toBe("בקשה ששלחת");
    expect(card.headline).toBe("לשלוח את קובץ האוטוקאד החסר");
    expect(card.requesterDisplayName).toBe("מאור | טריגו מידול והנדסה");
    expect(card.askLine).toBeNull();
    expect(card.attributionLine).toMatch(/→/);
    expect(card.attributionLine).toMatch(/2026/);
    expect(card.waitingLine).toBe("ממתינים ל־עידית פרדי");
    expect(card.canMarkHandled).toBe(false);
    expect(card.dueAt).toBeNull();
  });

  it("idit→leonid: exact caption semantics, external_to_external", () => {
    const action =
      "לאשר לעידית לציין על התכניות שהן מאושרות לביצוע";
    const card = resolveFeedRequestCard({
      mailboxIdentity: mailbox,
      knownParticipants: [],
      relationToMailbox: "external_to_external",
      requesterEmail: "idit.fredi@gmail.com",
      requesterName: "עידית פרדי",
      assigneeEmail: "leonid10588@gmail.com",
      assigneeName: "לאוניד גורין",
      requestedAction: action,
      modelHeadline: "ביקש אישור לשינויים בתכניות",
      requestedAt: "2026-08-04T12:11:00.000Z",
      dueAt: null,
    });
    expect(card.typeLabel).toBe("בקשה בין משתתפים");
    expect(card.headline).toBe(action);
    expect(card.headline).not.toMatch(/אישור שינויים בתכניות/);
    expect(card.canMarkHandled).toBe(false);
    expect(card.askLine).toBeNull();
  });

  it("compose never prefixes מתבקש onto sent_by_me action", () => {
    expect(
      composeActionHeadline({
        requestedAction: "לאשר את מצב ה-GA הסופי לביצוע",
        relationToMailbox: "sent_by_me",
        assigneeDisplayName: "Rotem Mair",
      }),
    ).toBe("לאשר את מצב ה-GA הסופי לביצוע");
  });

  it("canonical names: mailbox + latin title case", () => {
    expect(improveExternalDisplayName("rotem mair")).toBe("Rotem Mair");
    expect(improveExternalDisplayName("office gaash")).toBe("office gaash");
    expect(
      resolveCanonicalParticipantName({
        email: "office@trigo-models.com",
        sourceDisplayName: "office",
        mailboxIdentity: mailbox,
      }),
    ).toBe("מאור | טריגו מידול והנדסה");
    expect(
      resolveCanonicalParticipantName({
        email: "office@gaash-m.co.il",
        sourceDisplayName: "office gaash",
        mailboxIdentity: mailbox,
      }),
    ).toBe("office gaash");
  });
});
