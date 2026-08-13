/**
 * O5A.3.1 inclusion — general rules fixtures (no golden hardcodes / IDs).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveFeedRequestCard } from "@/server/feed/compose";
import { computeDedupeKey } from "@/server/feed/context";
import {
  buildCanonicalParticipantRegistry,
  resolveCanonicalParticipantName,
  resolveMailboxIdentity,
} from "@/server/feed/identity";
import { planSafeReplacement } from "@/server/feed/replace";
import type { FeedCandidate } from "@/server/feed/schemas";
import {
  classifyRequestSpeechAct,
  refineRequestedAction,
  speechActAllowsActionCoercion,
} from "@/server/feed/speech-act";
import { validateFeedCandidates } from "@/server/feed/validate";

const mailbox = resolveMailboxIdentity({
  mailAccountId: "acc-gen",
  primaryEmail: "owner@example.com",
  aliases: [],
  canonicalDisplayName: "Owner Example",
});

const identities = [
  { email: "owner@example.com", type: "primary" as const },
];

function msg(over: Partial<{
  id: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  toNames: string[];
  body: string;
  direction: "inbound" | "outbound";
}>) {
  const toEmails = over.toEmails ?? ["b@example.com"];
  const toNames = over.toNames ?? toEmails.map(() => null as string | null);
  return {
    id: over.id ?? "msg-1",
    threadId: "t1",
    sentAt: "2026-08-01T10:00:00.000Z",
    subject: "s",
    fromEmail: over.fromEmail ?? "a@example.com",
    fromName: over.fromName ?? "Alice",
    toEmails,
    toParticipants: toEmails.map((email, i) => ({
      email,
      displayName: toNames[i] ?? null,
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
    isAccountOwner: (over.fromEmail ?? "a@example.com") === "owner@example.com",
    accountRelation: "sent_to_account" as const,
    body: over.body ?? "",
    removedNormalized: [] as string[],
  };
}

function baseAction(over: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    type: "action",
    headline: "טיוטה",
    context: null,
    actorName: "Alice",
    actorEmail: "a@example.com",
    sourceMessageId: "msg-1",
    evidenceText: "נא לשלוח",
    actionOwner: null,
    responsibilityScope: null,
    requestDirection: null,
    relationToMailbox: null,
    requestedAction: "לשלוח קובץ",
    actionVerb: null,
    actionObject: null,
    actionPurpose: null,
    requester: {
      name: "Alice",
      email: "a@example.com",
      evidenceText: "נא לשלוח",
    },
    assignee: {
      name: "Bob",
      email: "b@example.com",
      evidenceText: "נא לשלוח",
    },
    beneficiary: null,
    responseRecipient: null,
    requestModality: "direct_request",
    requestSpeechAct: null,
    attributionConfidence: 0.95,
    semanticPrecisionConfidence: 0.95,
    requestEvidence: null,
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
    topicKey: "t",
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

function run(candidate: FeedCandidate, message: ReturnType<typeof msg>) {
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

describe("O5A.3.1 general inclusion fixtures", () => {
  it("1: missing DWG is implicit directive to recipient B", () => {
    const body = "חסר קובץ DWG";
    expect(classifyRequestSpeechAct({ body, evidenceText: body })).toBe(
      "directive",
    );
    const { accepted } = run(
      baseAction({
        type: "change",
        evidenceText: body,
        requestedAction: "חסר קובץ",
        requestModality: "implicit_request",
        requester: {
          name: "Owner Example",
          email: "owner@example.com",
          evidenceText: body,
        },
        assignee: {
          name: "Recipient B",
          email: "b@example.com",
          evidenceText: body,
        },
      }),
      msg({
        fromEmail: "owner@example.com",
        fromName: "Owner Example",
        toEmails: ["b@example.com"],
        toNames: ["Recipient B"],
        body,
        direction: "outbound",
      }),
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.type).toBe("action");
    expect(accepted[0]?.requestSpeechAct).toBe("directive");
    expect(accepted[0]?.relationToMailbox).toBe("sent_by_me");
    expect(accepted[0]?.requestedAction).toMatch(/DWG/);
    expect(accepted[0]?.requestedAction).not.toMatch(/אוטוקאד/);
  });

  it("2: permission to add distribution caption — not document approval", () => {
    const body =
      "אם אתה מאשר לי להוסיף על המסמך 'מאושר להפצה' תעדכן אותי";
    expect(
      classifyRequestSpeechAct({ body, evidenceText: body }),
    ).toBe("permission_request");
    const refined = refineRequestedAction({
      body,
      action: "לאשר את המסמך",
      speechAct: "permission_request",
      requesterDisplayName: "Carol",
    });
    expect(refined).toMatch(/מאושר להפצה/);
    expect(refined).not.toMatch(/^לאשר את המסמך$/);
    expect(refined).toMatch(/Carol|לציין/);
  });

  it("3: price change stays Change — no action coercion", () => {
    const body = "המחיר השתנה מ-100 ל-120";
    expect(classifyRequestSpeechAct({ body, evidenceText: body })).toBe(
      "status_change",
    );
    const { accepted, rejected } = run(
      baseAction({
        type: "change",
        evidenceText: body,
        requestedAction: null,
        headline: "שינוי מחיר",
        requestModality: null,
        businessObject: "מחיר",
        previousValue: "100",
        currentValue: "120",
        requester: {
          name: "Alice",
          email: "a@example.com",
          evidenceText: body,
        },
        assignee: {
          name: "Bob",
          email: "b@example.com",
          evidenceText: body,
        },
      }),
      msg({ body }),
    );
    // May accept as change or reject for missing action fields — must NOT become action
    const item = accepted[0] ?? rejected[0]?.candidate;
    expect(item?.type).toBe("change");
    expect(item?.requestSpeechAct).toBe("status_change");
  });

  it("4: reported approval is status_change / not a new directive", () => {
    const body = "דוד אישר את התכנית";
    expect(classifyRequestSpeechAct({ body, evidenceText: body })).toBe(
      "status_change",
    );
    expect(
      speechActAllowsActionCoercion(
        classifyRequestSpeechAct({ body, evidenceText: body }),
      ),
    ).toBe(false);
  });

  it("5: multiple TO — only named party is assignee", () => {
    const body = "בוב, נא לאשר את הכמות";
    const { accepted } = run(
      baseAction({
        evidenceText: "נא לאשר את הכמות",
        requestedAction: "לאשר את הכמות",
        assignee: {
          name: "Bob",
          email: "b@example.com",
          evidenceText: "נא לאשר את הכמות",
        },
      }),
      msg({
        toEmails: ["b@example.com", "c@example.com"],
        toNames: ["Bob", "Carol"],
        body,
      }),
    );
    expect(accepted[0]?.assignee?.email).toBe("b@example.com");
    expect(accepted[0]?.assignee?.email).not.toBe("c@example.com");
  });

  it("6: English names in RTL attribution keep requester → assignee order", () => {
    const card = resolveFeedRequestCard({
      mailboxIdentity: mailbox,
      knownParticipants: [],
      relationToMailbox: "external_to_external",
      requesterEmail: "alice@example.com",
      requesterName: "Alice Smith",
      assigneeEmail: "bob@example.com",
      assigneeName: "Bob Jones",
      requestedAction: "לאשר כמות",
      requestedAt: "2026-08-01T10:00:00.000Z",
      dueAt: null,
    });
    expect(card.attributionLine.startsWith("Alice Smith → Bob Jones")).toBe(
      true,
    );
    expect(card.askLine).toBeNull();
  });

  it("7: three display names for one email → one canonical", () => {
    const registry = buildCanonicalParticipantRegistry({
      mailboxIdentity: mailbox,
      participants: [
        { email: "bob@example.com", displayName: "bob" },
        { email: "BOB@example.com", displayName: "B. Jones" },
        { email: "bob@example.com", displayName: "Bob Jones" },
      ],
    });
    const name = resolveCanonicalParticipantName({
      email: "bob@example.com",
      sourceDisplayName: "bob",
      mailboxIdentity: mailbox,
      knownParticipants: registry,
    });
    expect(name).toBe("Bob Jones");
    expect(
      resolveCanonicalParticipantName({
        email: "bob@example.com",
        sourceDisplayName: "B. Jones",
        mailboxIdentity: mailbox,
        knownParticipants: registry,
      }),
    ).toBe(name);
  });

  it("8: replacement failure does not supersede old item", () => {
    expect(
      planSafeReplacement({
        validationOk: true,
        persistOk: false,
        oldStatus: "needs_replacement",
      }),
    ).toEqual({
      shouldSupersedeOld: false,
      nextOldStatus: "needs_replacement",
      reportMissingReplacement: true,
    });
  });

  it("waiting line uses full canonical assignee name", () => {
    const card = resolveFeedRequestCard({
      mailboxIdentity: mailbox,
      knownParticipants: [],
      relationToMailbox: "sent_by_me",
      requesterEmail: "owner@example.com",
      requesterName: "Owner",
      assigneeEmail: "rotem@example.com",
      assigneeName: "Rotem Mair",
      requestedAction: "לאשר GA",
      requestedAt: "2026-08-01T10:00:00.000Z",
      dueAt: null,
    });
    expect(card.waitingLine).toBe("ממתינים ל־Rotem Mair");
  });
});
