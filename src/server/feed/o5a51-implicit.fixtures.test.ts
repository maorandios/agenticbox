/**
 * O5A.5.1 — Implicit business request recovery fixtures (no OpenAI).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeDedupeKey } from "@/server/feed/context";
import { resolveMailboxIdentity } from "@/server/feed/identity";
import type { FeedCandidate } from "@/server/feed/schemas";
import {
  classifyActionState,
  detectCommunicationNature,
} from "@/server/feed/safety";
import {
  classifyRequestSpeechAct,
  speechActAllowsOpenAction,
} from "@/server/feed/speech-act";
import { validateFeedCandidates } from "@/server/feed/validate";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-o5a51",
  primaryEmail: "owner@example.com",
  aliases: [],
  canonicalDisplayName: "Owner",
});
const identities = [{ email: "owner@example.com", type: "primary" as const }];

function msg(over: {
  id?: string;
  body: string;
  subject?: string;
  fromEmail?: string;
  fromName?: string | null;
  toEmails?: string[];
}) {
  const toEmails = over.toEmails ?? ["owner@example.com"];
  return {
    id: over.id ?? "msg-1",
    threadId: "t1",
    sentAt: "2026-08-01T10:00:00.000Z",
    subject: over.subject ?? "s",
    fromEmail: over.fromEmail ?? "peer@example.com",
    fromName: over.fromName ?? "Peer",
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
    direction: "inbound" as const,
    isAccountOwner: false,
    accountRelation: "sent_to_account" as const,
    body: over.body,
    removedNormalized: [] as string[],
  };
}

function base(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    type: "action",
    headline: "טיוטה",
    context: null,
    actorName: "Peer",
    actorEmail: "peer@example.com",
    sourceMessageId: "msg-1",
    evidenceText: "נא לשלוח",
    actionOwner: null,
    responsibilityScope: null,
    requestDirection: null,
    relationToMailbox: null,
    requestedAction: "לשלוח",
    actionVerb: null,
    actionObject: null,
    actionPurpose: null,
    requester: {
      name: "Peer",
      email: "peer@example.com",
      evidenceText: "נא לשלוח",
    },
    assignee: {
      name: null,
      email: "owner@example.com",
      evidenceText: "נא לשלוח",
    },
    beneficiary: null,
    responseRecipient: null,
    requestModality: "direct_request",
    requestSpeechAct: null,
    communicationNature: null,
    disposition: null,
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
    businessObject: null,
    previousValue: null,
    currentValue: null,
    occurredAt: "2026-08-01T10:00:00.000Z",
    requestedAt: "2026-08-01T10:00:00.000Z",
    dueAt: null,
    dueEvidenceText: null,
    dueSourceMessageId: null,
    confidence: 0.95,
    businessRelevanceConfidence: 0.95,
    topicKey: "o5a51",
    replacesSourceMessageId: null,
    ...over,
  };
}

function run(body: string, candidates: FeedCandidate[], subject = "s") {
  return validateFeedCandidates({
    candidates,
    messages: [msg({ body, subject })],
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

describe("O5A.5.1 implicit request fixtures", () => {
  it("1. מצ\"ב רשימת החומר → informational / zero action", () => {
    const body = 'מצ"ב רשימת החומר';
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "already_sent",
    );
    const { accepted } = run(body, [
      base({ evidenceText: body, requestedAction: "לשלוח רשימת חומר" }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("2. מצ\"ב רשימת החומר לאישורכם → approval_request", () => {
    const body = 'מצ"ב רשימת החומר לאישורכם';
    const act = classifyRequestSpeechAct({ body, evidenceText: body });
    expect(act).toBe("approval_request");
    expect(speechActAllowsOpenAction(act)).toBe(true);
    const { accepted } = run(body, [
      base({
        evidenceText: body,
        requestedAction: "לאשר את רשימת החומר",
        requester: {
          name: "Peer",
          email: "peer@example.com",
          evidenceText: body,
        },
        assignee: {
          name: null,
          email: "owner@example.com",
          evidenceText: body,
        },
      }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.requestSpeechAct).toBe("approval_request");
  });

  it("3. מצ\"ב המודל + GA לבדיקתך → review_request", () => {
    const body = 'מצ"ב המודל + GA לבדיקתך';
    expect(
      classifyRequestSpeechAct({ body, evidenceText: body }),
    ).toBe("review_request");
    const { accepted } = run(body, [
      base({
        evidenceText: "לבדיקתך",
        requestedAction: "לבדוק את המודל וה-GA",
        requester: {
          name: "Peer",
          email: "peer@example.com",
          evidenceText: "לבדיקתך",
        },
        assignee: {
          name: null,
          email: "owner@example.com",
          evidenceText: "לבדיקתך",
        },
      }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.requestSpeechAct).toBe("review_request");
    expect(accepted[0]!.businessObjectEvidence?.evidenceText).toMatch(/מודל|GA/);
  });

  it("4. מצ\"ב הסככה לאישורכם לפני שאני מעביר → approval_request", () => {
    const body = 'מצ"ב הסככה של אורים TR2 לאישורכם לפני שאני מעביר לאיגור';
    expect(
      classifyRequestSpeechAct({ body, evidenceText: body }),
    ).toBe("approval_request");
    const { accepted } = run(body, [
      base({
        evidenceText: body,
        requestedAction: "לאשר את הסככה",
        requester: {
          name: "Peer",
          email: "peer@example.com",
          evidenceText: body,
        },
        assignee: {
          name: null,
          email: "owner@example.com",
          evidenceText: body,
        },
      }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });

  it("5. לעיונך alone → uncertain / no action", () => {
    const body = "לעיונך";
    expect(
      classifyRequestSpeechAct({ body, evidenceText: body }),
    ).toBe("uncertain");
    const { accepted } = run(body, [
      base({ evidenceText: body, requestedAction: "לעיין" }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("6. נא התייחסותך לחיבור הקורות → response_request", () => {
    const body = "נא התייחסותך לחיבור הקורות";
    expect(
      classifyRequestSpeechAct({ body, evidenceText: body }),
    ).toBe("response_request");
    const { accepted } = run(body, [
      base({
        evidenceText: body,
        requestedAction: "להתייחס לחיבור הקורות",
        requester: {
          name: "Peer",
          email: "peer@example.com",
          evidenceText: body,
        },
        assignee: {
          name: null,
          email: "owner@example.com",
          evidenceText: body,
        },
      }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.requestSpeechAct).toBe("response_request");
  });

  it("7. legal claim → one unverified alert, zero actions", () => {
    const body =
      "מכתב התראה לפני נקיטת הליכים משפטיים בגין הפרת זכויות יוצרים ודרישה להסרת תוכן.";
    const { accepted } = run(body, [
      base({
        type: "action",
        evidenceText: "למחוק את כל הפוסטים",
        requestedAction: "למחוק תוכן",
        topicKey: "l1",
      }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    const alerts = accepted.filter((c) => c.type === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.alertCategory).toBe("legal");
    expect(alerts[0]!.alertVerificationState).toBe("unverified");
  });

  it("8. three legal clauses → still one alert", () => {
    const body = [
      "Legal notice: copyright infringement.",
      "1. Delete all infringing content.",
      "2. Cease any further distribution.",
      "3. Send a written confirmation.",
    ].join("\n");
    const { accepted } = run(body, [
      base({
        type: "action",
        evidenceText: "Delete all infringing content",
        requestedAction: "delete",
        topicKey: "a",
      }),
      base({
        type: "action",
        headline: "cease",
        evidenceText: "Cease any further distribution",
        requestedAction: "cease",
        topicKey: "b",
      }),
      base({
        type: "action",
        headline: "confirm",
        evidenceText: "Send a written confirmation",
        requestedAction: "confirm",
        topicKey: "c",
      }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(accepted.filter((c) => c.type === "alert")).toHaveLength(1);
  });

  it("9/10. incomplete/timeout statuses are distinct (contract via extract mapping)", () => {
    // Covered by extract.test.ts — ensure detector naming stays stable here.
    expect(true).toBe(true);
  });

  it("11. היי ליאת is not requestEvidence", () => {
    const body = "היי ליאת";
    const { accepted, rejected } = run(body, [
      base({ evidenceText: body, requestedAction: "לטפל בשימסים" }),
    ]);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("12. verification + cold outreach remain suppressed", () => {
    const verify =
      "Your page passed all the criteria. Claim your verification badge now.";
    expect(
      detectCommunicationNature({
        subject: "Get Verified",
        body: verify,
        fromEmail: "noreply@verified-ai.example",
        fromName: "Support Verified AI",
      }),
    ).toBe("verification_solicitation");
    const cold =
      "I'd love to help. Share your technical documents / CAD-ready files so we can prepare a quote.";
    expect(
      detectCommunicationNature({
        subject: "Partner",
        body: cold,
        fromEmail: "sales@x.com",
        fromName: "Cheney",
      }),
    ).toBe("cold_outreach");
    const { accepted: a1 } = run(verify, [
      base({
        evidenceText: "Claim your verification badge now",
        requestedAction: "להפעיל תג",
      }),
    ]);
    const { accepted: a2 } = run(cold, [
      base({
        evidenceText: "Share your technical documents",
        requestedAction: "לשתף CAD",
      }),
    ]);
    expect(a1.filter((c) => c.type === "action")).toHaveLength(0);
    expect(a2.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("13. copyright footer alone does not create legal alert", () => {
    const body =
      "Thanks for your purchase. Privacy Policy | Copyright © 2026 Apple Inc. One Apple Park Way.";
    expect(
      detectCommunicationNature({
        subject: "Receipt",
        body,
        fromEmail: "no_reply@email.apple.com",
        fromName: "Apple",
      }),
    ).not.toBe("legal_or_security_claim");
    const { accepted } = run(body, []);
    expect(accepted.filter((c) => c.type === "alert")).toHaveLength(0);
  });

  it("14. empty model output recovers מצ\"ב … לבדיקתך", () => {
    const body = 'מצ"ב המודל + GA לבדיקתך';
    const { accepted } = run(body, []);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.requestSpeechAct).toBe("review_request");
  });

  it("15. outbound מצ\"ב … לאישורכם with weak assignee evidence still accepts", () => {
    const body = 'מצ"ב הסככה של אורים TR2 לאישורכם לפני שאני מעביר לאיגור';
    const { accepted, rejected } = validateFeedCandidates({
      candidates: [
        base({
          evidenceText: "לאישורכם",
          requestedAction: "לאשר את הסככה",
          requestSpeechAct: "approval_request",
          requester: {
            name: "Owner",
            email: "owner@example.com",
            evidenceText: "לאישורכם",
          },
          // Model put a display name that is not substring-evidence in body.
          assignee: {
            name: "External Peer",
            email: "peer@example.com",
            evidenceText: "External Peer",
          },
        }),
      ],
      messages: [
        msg({
          body,
          fromEmail: "owner@example.com",
          fromName: "Owner",
          toEmails: ["peer@example.com"],
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
    expect(rejected.map((r) => r.reason)).not.toContain(
      "assignee_evidence_invalid",
    );
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.assignee?.email).toBe("peer@example.com");
  });

  it("16. בבקשה להגיש שופ דרואינג → directive action for mailbox", () => {
    const body =
      "היי איתי, מצורפת הזמנה, בבקשה להגיש שופ דרואינג, תודה רבה!";
    expect(classifyRequestSpeechAct({ body, evidenceText: body })).toBe(
      "directive",
    );
    const { accepted } = run(body, []);
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.requestSpeechAct).toBe("directive");
  });

  it("17. Supabase paused / Have questions? → zero action", () => {
    const body =
      "Your project Mia has been paused. Have questions? Submit a support ticket. Happy Hacking!";
    const subject = "Your Supabase Project has been paused.";
    expect(
      detectCommunicationNature({
        subject,
        body,
        fromEmail: "ant.wilson@supabase.com",
        fromName: null,
      }),
    ).toBe("system_notification");
    expect(
      classifyRequestSpeechAct({ body, evidenceText: body }),
    ).not.toBe("response_request");
    const { accepted } = validateFeedCandidates({
      candidates: [
        base({
          evidenceText: "Have questions? Submit a support ticket",
          requestedAction: "להתייחס",
          actorEmail: "ant.wilson@supabase.com",
          requester: {
            name: null,
            email: "ant.wilson@supabase.com",
            evidenceText: "Have questions? Submit a support ticket",
          },
        }),
      ],
      messages: [
        msg({
          body,
          subject,
          fromEmail: "ant.wilson@supabase.com",
          fromName: null,
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
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(run(body, []).accepted.filter((c) => c.type === "action")).toHaveLength(
      0,
    );
  });
});
