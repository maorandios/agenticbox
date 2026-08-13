/**
 * O5A.6.5 — Generic title quality gate fixtures (HE/EN, cross-domain).
 * No thread IDs, senders, or engineering hardcodes in production rules under test.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeDedupeKey } from "@/server/feed/context";
import { resolveMailboxIdentity } from "@/server/feed/identity";
import type { FeedCandidate } from "@/server/feed/schemas";
import {
  applyTitleQualityGate,
  isGenericActionTitle,
} from "@/server/feed/title-quality";
import { validateFeedCandidates } from "@/server/feed/validate";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-o5a65",
  primaryEmail: "owner@example.com",
  aliases: [],
  canonicalDisplayName: "Owner Example",
});
const identities = [{ email: "owner@example.com", type: "primary" as const }];

function msg(over: {
  body: string;
  subject?: string | null;
  fromEmail?: string;
  toEmails?: string[];
  direction?: "inbound" | "outbound";
}) {
  const toEmails = over.toEmails ?? ["owner@example.com"];
  return {
    id: "msg-1",
    threadId: "t1",
    sentAt: "2026-08-01T10:00:00.000Z",
    subject: over.subject ?? "s",
    fromEmail: over.fromEmail ?? "peer@example.com",
    fromName: "Peer",
    toEmails,
    toParticipants: toEmails.map((email) => ({
      email,
      displayName: null as string | null,
      isMailboxOwner: email === "owner@example.com",
    })),
    ccEmails: [] as string[],
    ccParticipants: [] as {
      email: string;
      displayName: string | null;
      isMailboxOwner: boolean;
    }[],
    bccEmails: [] as string[],
    bccParticipants: [] as {
      email: string;
      displayName: string | null;
      isMailboxOwner: boolean;
    }[],
    replyToEmail: null as string | null,
    direction: over.direction ?? ("inbound" as const),
    isAccountOwner:
      (over.fromEmail ?? "peer@example.com") === "owner@example.com",
    accountRelation: "sent_to_account" as const,
    body: over.body,
    removedNormalized: [] as string[],
  };
}

function baseCandidate(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    type: "action",
    headline: "טיוטה",
    context: null,
    actorName: "Peer",
    actorEmail: "peer@example.com",
    sourceMessageId: "msg-1",
    evidenceText: "נא לאשר",
    actionOwner: null,
    responsibilityScope: null,
    requestDirection: null,
    relationToMailbox: null,
    requestedAction: "לאשר",
    actionVerb: null,
    actionObject: null,
    actionPurpose: null,
    requester: {
      name: "Peer",
      email: "peer@example.com",
      evidenceText: "נא לאשר",
    },
    assignee: {
      name: null,
      email: "owner@example.com",
      evidenceText: "נא לאשר",
    },
    beneficiary: null,
    responseRecipient: null,
    requestModality: "direct_request",
    requestSpeechAct: null,
    actionState: null,
    communicationNature: null,
    disposition: null,
    alertCategory: null,
    alertVerificationState: null,
    requestEvidence: null,
    businessObjectEvidence: null,
    supportingEvidence: [],
    businessObject: null,
    topicKey: "topic",
    confidence: 0.9,
    businessRelevanceConfidence: 0.9,
    semanticPrecisionConfidence: 0.9,
    attributionConfidence: 0.9,
    occurredAt: "2026-08-01T10:00:00.000Z",
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    ...over,
  };
}

function runValidate(opts: {
  body: string;
  subject?: string | null;
  fromEmail?: string;
  toEmails?: string[];
  direction?: "inbound" | "outbound";
  candidates: FeedCandidate[];
}) {
  return validateFeedCandidates({
    candidates: opts.candidates,
    messages: [
      msg({
        body: opts.body,
        subject: opts.subject,
        fromEmail: opts.fromEmail,
        toEmails: opts.toEmails,
        direction: opts.direction,
      }),
    ],
    accountIdentities: identities,
    mailboxIdentity: mailbox,
    minConfidence: 0.8,
    minBusinessRelevance: 0.85,
    existingDedupeKeys: new Set(),
    computeDedupeKey: (c) =>
      computeDedupeKey({
        userId: "u1",
        threadId: "t1",
        sourceMessageId: c.sourceMessageId,
        type: c.type,
        evidenceText: c.evidenceText,
      }),
  });
}

describe("O5A.6.5 title quality — must pass recoveries", () => {
  it("1. בקשת עיון בתוכן ושיחה", () => {
    const subject = "אשמח שתציץ בתוכן ותדבר איתי";
    const body = "שלום, מצורף תיאור לסקירה.";
    const gate = applyTitleQualityGate({
      title: "להתייחס להבקשה",
      speechAct: "response_request",
      requestEvidence: subject,
      businessObjectEvidence: null,
      subject,
      body,
      titleSourceHint: "downstream_fallback",
    });
    expect(gate.status).toBe("ready_for_persist");
    expect(gate.finalTitle).toMatch(/לעיין|שיחה|תוכן/);
    expect(isGenericActionTitle(gate.finalTitle)).toBe(false);
  });

  it("2. הוראה לבצע עבודה על הזמנה מועברת", () => {
    const body =
      "הזמנת ציוד משרדי — לטיפולכם הזנת הזמנה במערכת\n---------- Forwarded message ----------\nFrom: x\nמצ\"ב הזמנה.";
    const { accepted } = runValidate({
      body,
      subject: "FW: PO-100",
      candidates: [
        baseCandidate({
          evidenceText: "לטיפולכם הזנת הזמנה במערכת",
          requestedAction: "לבצע את הבקשה",
          topicKey: "implicit-directive",
        }),
      ],
    });
    const action = accepted.find((c) => c.type === "action");
    expect(action).toBeTruthy();
    expect(action!.headline).not.toMatch(/^לבצע את הבקשה$/);
    expect(action!.titleQuality?.status).toBe("ready_for_persist");
  });

  it("3. בקשת אישור לפריט חלופי", () => {
    const body = "נא לאשר שימוש בפריט חלופי SKU-22";
    const { accepted } = runValidate({
      body,
      subject: "החלפת פריט מלאי",
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לאשר שימוש בפריט חלופי SKU-22",
        }),
      ],
    });
    expect(accepted[0]?.titleQuality?.pass).toBe(true);
  });

  it("4. הורדה + תיאום שיחה", () => {
    const body = "תוריד את הקבצים בבקשה ובוא נעשה שיחה לגבי זה בבקשה.";
    const gate = applyTitleQualityGate({
      title: "לבצע את הבקשה",
      speechAct: "directive",
      requestEvidence: body,
      body,
      titleSourceHint: "downstream_fallback",
    });
    expect(gate.finalTitle).toMatch(/תוריד|להוריד/);
    expect(gate.finalTitle).toMatch(/שיח/);
    expect(gate.status).toBe("ready_for_persist");
  });

  it("5. בקשת תשלום ביחס לחשבונית (EN)", () => {
    const body = "Please pay invoice INV-2044 by Friday.";
    const gate = applyTitleQualityGate({
      title: "please handle this",
      speechAct: "directive",
      requestEvidence: body,
      businessObjectEvidence: "invoice INV-2044",
      body,
      titleSourceHint: "model",
    });
    expect(gate.status).toBe("ready_for_persist");
    expect(gate.finalTitle.toLowerCase()).toMatch(/pay|invoice|לשלם|חשבונית/);
  });

  it("6. בקשת עדכון מסמך HR (EN)", () => {
    const body = "Please update the employee handbook section on remote work.";
    const gate = applyTitleQualityGate({
      title: "follow up",
      speechAct: "directive",
      requestEvidence: body,
      businessObjectEvidence: "employee handbook",
      body,
    });
    expect(gate.pass).toBe(true);
    expect(isGenericActionTitle(gate.finalTitle)).toBe(false);
  });

  it("7. בקשת תגובה ללקוח (HE)", () => {
    const body = "נא להשיב ללקוח לגבי מועד האספקה";
    const gate = applyTitleQualityGate({
      title: "להתייחס לזה",
      speechAct: "response_request",
      requestEvidence: body,
      businessObjectEvidence: "מועד האספקה",
      body,
    });
    expect(gate.status).toBe("ready_for_persist");
    expect(gate.finalTitle).not.toMatch(/להתייחס לזה/);
  });

  it("8. English approval of purchase order", () => {
    const body = "Please approve purchase order PO-7781 attached.";
    const gate = applyTitleQualityGate({
      title: "take care of this",
      speechAct: "approval_request",
      requestEvidence: body,
      businessObjectEvidence: "purchase order PO-7781",
      body,
    });
    expect(gate.pass).toBe(true);
  });
});

describe("O5A.6.5 title quality — must fail", () => {
  it.each([
    "לבצע את הבקשה",
    "לטפל בנושא",
    "please handle this",
    "להתייחס לזה",
  ])("generic title signal: %s", (title) => {
    expect(isGenericActionTitle(title)).toBe(true);
    const gate = applyTitleQualityGate({
      title,
      speechAct: "directive",
      requestEvidence: "שלום רב",
      body: "שלום רב",
    });
    expect(gate.status).toBe("needs_human_review");
  });

  it("object not in source → invented noun rejected", () => {
    const gate = applyTitleQualityGate({
      title: "לאשר את פרויקט האפולו",
      speechAct: "approval_request",
      requestEvidence: "אשמח לאישור",
      businessObjectEvidence: null,
      subject: "בקשה כללית",
      body: "אשמח לאישור",
    });
    expect(gate.finalTitle).not.toMatch(/אפולו/);
    expect(gate.pass && /אפולו/.test(gate.finalTitle)).toBe(false);
  });

  it("paraphrased evidence not in source → integrity failed", () => {
    const gate = applyTitleQualityGate({
      title: "לאשר את המסמך",
      speechAct: "approval_request",
      requestEvidence: "kindly greenlight the document when convenient",
      body: "אשמח לאישור המסמך",
      subject: "מסמך",
    });
    expect(gate.evidenceIntegrity.ok).toBe(false);
    expect(gate.status).toBe("needs_human_review");
  });

  it("title from quoted-only ask stays filtered in validate", () => {
    const { accepted } = runValidate({
      body: "תודה",
      candidates: [
        baseCandidate({
          evidenceText: "נא לאשר את התכנית",
          requestedAction: "לאשר את התכנית",
        }),
      ],
    });
    // evidence not in CURRENT body
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });
});
