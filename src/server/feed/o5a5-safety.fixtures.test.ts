/**
 * O5A.5 — Feed safety / semantic evidence fixtures (no OpenAI).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeDedupeKey } from "@/server/feed/context";
import { resolveMailboxIdentity } from "@/server/feed/identity";
import type { FeedCandidate } from "@/server/feed/schemas";
import {
  classifyActionState,
  detectCommunicationNature,
  isGreetingOnlyEvidence,
} from "@/server/feed/safety";
import { validateFeedCandidates } from "@/server/feed/validate";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-safety",
  primaryEmail: "owner@example.com",
  aliases: [],
  canonicalDisplayName: "Owner Example",
});

const identities = [{ email: "owner@example.com", type: "primary" as const }];

function msg(over: {
  id?: string;
  fromEmail?: string;
  fromName?: string | null;
  toEmails?: string[];
  body: string;
  subject?: string | null;
  direction?: "inbound" | "outbound";
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
    direction: over.direction ?? ("inbound" as const),
    isAccountOwner: (over.fromEmail ?? "peer@example.com") === "owner@example.com",
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
    evidenceText: "נא לשלוח",
    actionOwner: null,
    responsibilityScope: null,
    requestDirection: null,
    relationToMailbox: null,
    requestedAction: "לשלוח את רשימת החומר",
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
    topicKey: "safety",
    replacesSourceMessageId: null,
    ...over,
  };
}

function runValidate(opts: {
  body: string;
  candidates: FeedCandidate[];
  fromEmail?: string;
  fromName?: string | null;
  subject?: string;
  priorBody?: string;
  toEmails?: string[];
}) {
  const messages = [
    ...(opts.priorBody
      ? [
          msg({
            id: "msg-0",
            body: opts.priorBody,
            fromEmail: "owner@example.com",
            direction: "outbound",
            toEmails: ["peer@example.com"],
          }),
        ]
      : []),
    msg({
      body: opts.body,
      fromEmail: opts.fromEmail,
      fromName: opts.fromName,
      subject: opts.subject,
      toEmails: opts.toEmails,
    }),
  ];
  return validateFeedCandidates({
    candidates: opts.candidates,
    messages,
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

describe("O5A.5 safety fixtures", () => {
  it("1. מצ\"ב רשימת החומר → already_sent, zero actions", () => {
    const body = 'מצ"ב רשימת החומר';
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "already_sent",
    );
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לשלוח את רשימת החומר",
          requestEvidence: {
            sourceMessageId: "msg-1",
            evidenceText: body,
            evidenceType: "request",
            fromCurrentMessage: true,
          },
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("2. נא לשלוח את רשימת החומר → requested, one action", () => {
    const body = "נא לשלוח את רשימת החומר";
    expect(classifyActionState({ body, evidenceText: body })).toBe("requested");
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לשלוח את רשימת החומר",
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
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });

  it("3. אשלח את רשימת החומר מחר → committed + due evidence", () => {
    const body = "אשלח את רשימת החומר מחר";
    expect(classifyActionState({ body, evidenceText: body })).toBe("committed");
    const { accepted } = runValidate({
      body,
      fromEmail: "owner@example.com",
      fromName: "Owner",
      toEmails: ["peer@example.com"],
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לשלוח את רשימת החומר",
          actorEmail: "owner@example.com",
          actorName: "Owner",
          requester: {
            name: "Owner",
            email: "owner@example.com",
            evidenceText: body,
          },
          assignee: {
            name: "Peer",
            email: "peer@example.com",
            evidenceText: body,
          },
          dueAt: "2026-08-02T10:00:00.000Z",
          dueEvidenceText: "מחר",
          dueSourceMessageId: "msg-1",
          requestModality: "commitment",
        }),
      ],
    });
    const actions = accepted.filter((c) => c.type === "action");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.dueAt).toBeTruthy();
    expect(actions[0]!.dueEvidenceText).toMatch(/מחר/);
  });

  it("4. unsolicited verification badge → verification_solicitation suppress", () => {
    const body =
      "Your page passed all the criteria. Claim your verification badge now: https://evil.example/activate";
    expect(
      detectCommunicationNature({
        subject: "Get Verified",
        body,
        fromEmail: "noreply@verified-ai.example",
        fromName: "Support Verified AI",
      }),
    ).toBe("verification_solicitation");
    const { accepted, rejected } = runValidate({
      body,
      fromEmail: "noreply@verified-ai.example",
      fromName: "Support Verified AI",
      subject: "Get Verified",
      candidates: [
        baseCandidate({
          evidenceText: "Claim your verification badge now",
          requestedAction: "להפעיל תג אימות",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(rejected.some((r) => r.reason === "verification_solicitation")).toBe(
      true,
    );
  });

  it("5. user-initiated verification completion → alert possible, not action", () => {
    const body =
      "You requested verification. Please complete the verification setup you started to finish activating your account.";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: "complete the verification setup you started",
          requestedAction: "להשלים אימות",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(accepted.filter((c) => c.type === "alert").length).toBeGreaterThanOrEqual(
      0,
    );
    const alerts = accepted.filter((c) => c.type === "alert");
    if (alerts.length > 0) {
      expect(alerts[0]!.alertVerificationState).toBe("unverified");
    }
  });

  it("6. cold outreach CAD quote → suppress", () => {
    const body =
      "I'd love to help. Share your technical documents / CAD-ready files so we can prepare a quote.";
    expect(
      detectCommunicationNature({
        subject: "Partnership",
        body,
        fromEmail: "sales@vendor.example",
        fromName: "Vendor",
      }),
    ).toBe("cold_outreach");
    const { accepted, rejected } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: "Share your technical documents",
          requestedAction: "לשתף מסמכי CAD",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(rejected.some((r) => r.reason === "cold_outreach")).toBe(true);
  });

  it("7. project paused notice → no invented unpause action", () => {
    const body = "הפרויקט הושהה עד להודעה חדשה.";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לבטל השהיה של הפרויקט",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("8. legal demand with three clauses → one legal alert, zero actions", () => {
    const body = [
      "Legal notice: copyright infringement claim.",
      "1. Delete all infringing content.",
      "2. Cease any further distribution.",
      "3. Send a written confirmation within 48 hours.",
    ].join("\n");
    const { accepted } = runValidate({
      body,
      subject: "DMCA",
      candidates: [
        baseCandidate({
          type: "action",
          evidenceText: "Delete all infringing content",
          requestedAction: "למחוק תוכן",
          topicKey: "legal-1",
        }),
        baseCandidate({
          type: "action",
          headline: "להפסיק הפצה",
          evidenceText: "Cease any further distribution",
          requestedAction: "להפסיק הפצה",
          topicKey: "legal-2",
        }),
        baseCandidate({
          type: "action",
          headline: "לאשר בכתב",
          evidenceText: "Send a written confirmation within 48 hours",
          requestedAction: "לאשר בכתב",
          topicKey: "legal-3",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    const alerts = accepted.filter((c) => c.type === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.alertCategory).toBe("legal");
    expect(alerts[0]!.alertVerificationState).toBe("unverified");
  });

  it("9. greeting-only evidence with prior shimsim context → no action", () => {
    expect(isGreetingOnlyEvidence("היי ליאת")).toBe(true);
    const { accepted, rejected } = runValidate({
      priorBody: "נשלח קובץ השימסים לעיון",
      body: "היי ליאת",
      candidates: [
        baseCandidate({
          evidenceText: "היי ליאת",
          requestedAction: "לטפל בשימסים",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("10. מצ\"ב לאישורך → action requiring approval of attached subject", () => {
    const body = 'מצ"ב לאישורך את קובץ הסככה';
    expect(classifyActionState({ body, evidenceText: body })).toBe("requested");
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לאשר את קובץ הסככה",
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
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
    expect(accepted[0]!.requestedAction).toMatch(/לאשר|סככה/);
  });

  it("11. short model-approval request still actionable", () => {
    const body = "נא לאשר את המודל";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לאשר את המודל",
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
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });

  it("12. real payment failure → one payment alert", () => {
    const body = "Payment failed for invoice #4421. Your card was declined.";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          type: "action",
          evidenceText: "Payment failed for invoice #4421",
          requestedAction: "לטפל בתשלום",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    const alerts = accepted.filter((c) => c.type === "alert");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0]!.alertCategory).toBe("payment");
  });

  it("13. real security alert → one alert", () => {
    const body = "Security alert: new sign-in from an unrecognized device.";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          type: "action",
          evidenceText: "Security alert: new sign-in",
          requestedAction: "לאשר התחברות",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(accepted.filter((c) => c.type === "alert").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("14. release notes / product update → suppress", () => {
    const body =
      "What's new this week. Release notes and product update. Unsubscribe anytime.";
    expect(
      detectCommunicationNature({
        subject: "Product update",
        body,
        fromEmail: "news@vendor.example",
        fromName: "Product",
      }),
    ).toBe("marketing");
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: "Release notes and product update",
          requestedAction: "לקרוא עדכון",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("15. already-completed information → zero action", () => {
    const body = "רשימת החומר נשלחה אתמול כפי שביקשת.";
    expect(classifyActionState({ body, evidenceText: body })).toBe("completed");
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לשלוח את רשימת החומר",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });
});
