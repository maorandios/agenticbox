/**
 * O5A.6.4 — General downstream recall fixtures (no OpenAI).
 * Must-pass recoveries + must-stay-filtered safety cases.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeDedupeKey } from "@/server/feed/context";
import {
  evidenceMatchesHaystack,
  extractCurrentMessageLead,
  normalizeEvidenceText,
} from "@/server/feed/evidence-match";
import { resolveMailboxIdentity } from "@/server/feed/identity";
import type { FeedCandidate } from "@/server/feed/schemas";
import {
  classifyActionState,
  detectCommunicationNature,
} from "@/server/feed/safety";
import { classifyRequestSpeechAct } from "@/server/feed/speech-act";
import { validateFeedCandidates } from "@/server/feed/validate";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-o5a64",
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
  removedNormalized?: string[];
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
    isAccountOwner:
      (over.fromEmail ?? "peer@example.com") === "owner@example.com",
    accountRelation: "sent_to_account" as const,
    body: over.body,
    removedNormalized: over.removedNormalized ?? ([] as string[]),
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
    requestedAction: "לשלוח מסמך",
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
  fromName?: string | null;
  toEmails?: string[];
  direction?: "inbound" | "outbound";
  candidates: FeedCandidate[];
  removedNormalized?: string[];
}) {
  const messages = [
    msg({
      body: opts.body,
      subject: opts.subject,
      fromEmail: opts.fromEmail,
      fromName: opts.fromName,
      toEmails: opts.toEmails,
      direction: opts.direction,
      removedNormalized: opts.removedNormalized,
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

describe("O5A.6.4 evidence normalization", () => {
  it("NFKC + HTML entities + quotes match deterministically", () => {
    const hay = normalizeEvidenceText("מצ&quot;ב מסמך לאישורך");
    expect(hay).toContain('מצ"ב');
    expect(
      evidenceMatchesHaystack('מצ"ב מסמך לאישורך', "מצ&quot;ב מסמך לאישורך"),
    ).toBe(true);
  });

  it("forward lead extraction keeps CURRENT ask", () => {
    const body =
      'היי, תוריד את הקבצים בבקשה.---------- Forwarded message ---------From: x';
    expect(extractCurrentMessageLead(body)).toMatch(/תוריד/);
    expect(extractCurrentMessageLead(body)).not.toMatch(/Forwarded/);
  });
});

describe("O5A.6.4 must-pass recoveries", () => {
  it("1. בקשת עיון ויצירת קשר", () => {
    const subject = "אשמח שתציץ בתוכן ותדבר איתי";
    const body = "שלום, בהמשך לשיחתנו מצורף תיאור הפרויקט לסקירה.";
    expect(
      classifyRequestSpeechAct({
        body,
        evidenceText: subject,
        subject,
      }),
    ).toMatch(/review_request|response_request/);
    const { accepted } = runValidate({
      subject,
      body,
      candidates: [
        baseCandidate({
          evidenceText: "אשמח שתציץ בתוכן ותדבר איתי",
          requestedAction: "לעיין בתוכן ולחזור עם שיחה",
          requestEvidence: {
            sourceMessageId: "msg-1",
            evidenceText: "אשמח שתציץ בתוכן ותדבר איתי",
            evidenceType: "request",
            fromCurrentMessage: true,
          },
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });

  it("2. בקשת ביצוע המצורפת ל־Forward", () => {
    const body =
      "הזמנת סככות — לטיפולכם דיטלינג וכו\n---------- Forwarded message ----------\nFrom: someone\nמצ\"ב הזמנת רכש לטיפולכם.";
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "requested",
    );
    expect(extractCurrentMessageLead(body)).toMatch(/לטיפולכם דיטלינג/);
    expect(extractCurrentMessageLead(body)).not.toMatch(/מצ/);
    const { accepted, rejected } = runValidate({
      body,
      subject: "FW: הזמנת רכש",
      candidates: [
        baseCandidate({
          evidenceText: "לטיפולכם דיטלינג",
          requestedAction: "לטפל בדיטלינג להזמנת סככות",
        }),
        baseCandidate({
          evidenceText: 'מצ"ב הזמנת רכש לטיפולכם',
          requestedAction: "לחתום על הזמנת רכש",
          sourceMessageId: "msg-1",
          topicKey: "nested-forward-ask",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action").length).toBeGreaterThan(
      0,
    );
    expect(
      accepted.some((c) => /דיטלינג|לטיפול/.test(c.evidenceText)),
    ).toBe(true);
    expect(
      accepted.some((c) => /לחתום|מצ/.test(c.evidenceText)),
    ).toBe(false);
    expect(rejected.some((r) => /מצ/.test(r.candidate.evidenceText))).toBe(
      true,
    );
  });

  it("2b. Outlook inline From/Sent lead extraction", () => {
    const body =
      'הזמנת סככות אתר אורים- לטיפולכם דיטלינג וכו From: Levi, Oshrat &lt;oshrat.levi@belectric.com&gt; Sent: Monday, August 3, 2026 9:27 AM To: x Subject: PO מצ"ב הזמנת רכש לטיפולכם. יש לחתום על ההזמנה.';
    const lead = extractCurrentMessageLead(body);
    expect(lead).toMatch(/לטיפולכם דיטלינג/);
    expect(lead).not.toMatch(/יש לחתום/);
    const { accepted } = runValidate({
      body,
      subject: "FW: PO26003966 - הדפסת הזמנת רכש",
      candidates: [
        baseCandidate({
          evidenceText: "יש לחתום על ההזמנה",
          requestedAction: "לחתום על ההזמנה",
        }),
      ],
    });
    // Nested forward ask rejected; empty-recovery should surface CURRENT directive.
    expect(
      accepted.some(
        (c) =>
          c.type === "action" &&
          /לטיפול|דיטלינג|הזמנת סככות|לטפל/.test(
            `${c.evidenceText} ${c.requestedAction ?? ""} ${c.headline}`,
          ),
      ),
    ).toBe(true);
    expect(
      accepted.every(
        (c) => c.type !== "action" || !/^לבצע את הבקשה$/i.test(c.headline),
      ),
    ).toBe(true);
  });

  it("3. שליחת מסמך עם פעולה נדרשת", () => {
    const body = 'מצ"ב הסככה לאישורך';
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "requested",
    );
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לאשר את הסככה",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });

  it("4. בקשה קצרה בעברית עם business object בנושא", () => {
    const subject = "החלפת עוגן חיבור זוית לקיר";
    const body = "אשמח לאישור";
    const { accepted } = runValidate({
      subject,
      body,
      direction: "outbound",
      fromEmail: "owner@example.com",
      fromName: "Owner",
      toEmails: ["peer@example.com"],
      candidates: [
        baseCandidate({
          evidenceText: "אשמח לאישור",
          requestedAction: "לאשר החלפת עוגן",
          actorEmail: "owner@example.com",
          actorName: "Owner",
          requester: {
            name: "Owner",
            email: "owner@example.com",
            evidenceText: "אשמח לאישור",
          },
          assignee: {
            name: "Peer",
            email: "peer@example.com",
            evidenceText: "אשמח לאישור",
          },
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });

  it("5. בקשה לשינוי פרט טכני עם evidence קצר", () => {
    const body = "נא לאשר שימוש בעוגן חלופי HILTI";
    const { accepted } = runValidate({
      body,
      subject: "שינוי פרט חיבור",
      candidates: [
        baseCandidate({
          evidenceText: "נא לאשר שימוש בעוגן חלופי",
          requestedAction: "לאשר שימוש בעוגן חלופי",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(1);
  });
});

describe("O5A.6.4 must-stay-filtered", () => {
  it("1. Attachment בלבד", () => {
    const body = "Please find attached the drawing set.";
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "already_sent",
    );
    const { accepted } = runValidate({
      body,
      candidates: [baseCandidate({ evidenceText: body })],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it('2. מצ"ב רשימת החומר ללא בקשה', () => {
    const body = 'מצ"ב רשימת החומר';
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "already_sent",
    );
    const { accepted } = runValidate({
      body,
      candidates: [baseCandidate({ evidenceText: body })],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("3. Forward ללא הוראה מהשולח הנוכחי", () => {
    const body = "FYI";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: "נא לאשר את התכנית",
          requestedAction: "לאשר את התכנית",
        }),
      ],
      removedNormalized: [
        normalizeEvidenceText(
          "---------- Forwarded message ---------- From: a@b.com נא לאשר את התכנית",
        ).toLowerCase(),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("4. System notification", () => {
    const body =
      "Your project has been paused automatically due to inactivity. Happy hacking!";
    expect(
      detectCommunicationNature({
        subject: "Project paused",
        body,
        fromEmail: "noreply@system.example",
        fromName: "System",
      }),
    ).toBe("system_notification");
    const { accepted } = runValidate({
      body,
      subject: "Project paused",
      fromEmail: "noreply@system.example",
      candidates: [
        baseCandidate({
          evidenceText: "project has been paused",
          requestedAction: "לבטל השהיה",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("5. Verification scam", () => {
    const body =
      "Your page passed all the criteria. Claim your verification badge now.";
    expect(
      detectCommunicationNature({
        subject: "Get Verified",
        body,
        fromEmail: "support@verified-ai.example",
        fromName: "Verified AI",
      }),
    ).toBe("verification_solicitation");
  });

  it("6. Cold outreach", () => {
    const body =
      "I'd love to help prepare a quote and share your technical documents for CAD-ready modeling.";
    expect(
      detectCommunicationNature({
        subject: "Partnership",
        body,
        fromEmail: "sales@vendor.example",
        fromName: "Sales",
      }),
    ).toBe("cold_outreach");
  });

  it("7. Marketing", () => {
    const body =
      "What's new this month — release notes and changelog. Unsubscribe anytime.";
    expect(
      detectCommunicationNature({
        subject: "Product update",
        body,
        fromEmail: "news@vendor.example",
        fromName: "News",
      }),
    ).toBe("marketing");
  });

  it("8. Greeting בלבד", () => {
    const body = "היי מאור";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: "היי מאור",
          requestedAction: "להשיב",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("9. בקשה רק ב־quoted text", () => {
    const body = "תודה";
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: "נא לאשר את התכנית",
          requestedAction: "לאשר את התכנית",
        }),
      ],
      removedNormalized: [
        normalizeEvidenceText("נא לאשר את התכנית").toLowerCase(),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("10. Legal/suspicious not relevant as open action", () => {
    const body =
      "Copyright infringement notice. Delete all infringing content immediately.";
    const nature = detectCommunicationNature({
      subject: "Legal",
      body,
      fromEmail: "legal@unknown.example",
      fromName: "Legal",
    });
    expect(nature).toBe("legal_or_security_claim");
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          type: "action",
          evidenceText: "Delete all infringing content",
          requestedAction: "למחוק את כל התוכן",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("10b. Legal letterhead without claim stays empty (no invented alert)", () => {
    const body =
      'VB-2026/3274 שנבל, כהן & לוי משרד עורכי דין דרך עכו 140 חיפה office@example.com';
    const subject = '[התראה משפטית] שימוש בלתי מורשה בתכנים';
    expect(
      detectCommunicationNature({
        subject,
        body,
        fromEmail: "stranger@itu.edu.tr",
        fromName: null,
      }),
    ).not.toBe("legal_or_security_claim");
    const { accepted } = runValidate({
      body,
      subject,
      fromEmail: "stranger@itu.edu.tr",
      candidates: [
        baseCandidate({
          type: "alert",
          headline: "התראה משפטית",
          evidenceText: body.slice(0, 80),
          requestedAction: "לאמת דרישה משפטית",
          alertCategory: "legal",
        }),
      ],
    });
    expect(accepted.length).toBe(0);
  });

  it("11. פעולה שכבר בוצעה", () => {
    const body = "נשלח אתמול את קובץ ה־PDF לכולם";
    expect(classifyActionState({ body, evidenceText: body })).toBe(
      "completed",
    );
    const { accepted } = runValidate({
      body,
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לשלוח PDF",
        }),
      ],
    });
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
  });

  it("12. Self-request", () => {
    const body = "נא לאשר את הסככה";
    const { accepted, rejected } = runValidate({
      body,
      fromEmail: "owner@example.com",
      fromName: "Owner",
      toEmails: ["owner@example.com"],
      candidates: [
        baseCandidate({
          evidenceText: body,
          requestedAction: "לאשר את הסככה",
          actorEmail: "owner@example.com",
          requester: {
            name: "Owner",
            email: "owner@example.com",
            evidenceText: body,
          },
          assignee: {
            name: "Owner",
            email: "owner@example.com",
            evidenceText: body,
          },
        }),
      ],
    });
    // Same mailbox identity as requester and assignee must not open an action card.
    expect(accepted.filter((c) => c.type === "action")).toHaveLength(0);
    expect(rejected.length).toBeGreaterThan(0);
  });
});
