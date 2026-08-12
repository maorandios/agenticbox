import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { stableJsonHash } from "@/server/onyx/normalize/hash";
import {
  buildOnyxDocumentId,
  normalizeThreadDocument,
  selectMessageBody,
  type ThreadNormalizeInput,
} from "@/server/onyx/normalize/thread-document";

function baseInput(
  partial?: Partial<ThreadNormalizeInput>,
): ThreadNormalizeInput {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    mailAccountId: "22222222-2222-2222-2222-222222222222",
    threadId: "33333333-3333-3333-3333-333333333333",
    providerThreadId: "provider-thread-1",
    subject: "הצעת מחיר",
    messages: [
      {
        id: "m2",
        subject: "הצעת מחיר",
        plainText: "שלום, המחיר הוא 100",
        cleanConversation: null,
        direction: "inbound",
        providerDateAt: "2024-02-02T10:00:00.000Z",
        participants: [
          { role: "from", email: "a@example.com", name: "Alice" },
          { role: "to", email: "b@example.com", name: null },
        ],
        attachments: [],
      },
      {
        id: "m1",
        subject: "הצעת מחיר",
        plainText: "היי",
        cleanConversation: null,
        direction: "outbound",
        providerDateAt: "2024-02-01T09:00:00.000Z",
        participants: [
          { role: "from", email: "b@example.com", name: "Bob" },
          { role: "to", email: "a@example.com", name: "Alice" },
        ],
        attachments: [
          { filename: "quote.pdf", mimeType: "application/pdf", sizeBytes: 1200 },
        ],
      },
    ],
    ...partial,
  };
}

describe("thread normalizer", () => {
  it("builds stable document id", () => {
    expect(
      buildOnyxDocumentId("u1", "t1"),
    ).toBe("user:u1:thread:t1");
  });

  it("orders sections chronologically and uses Hebrew labels", () => {
    const doc = normalizeThreadDocument(baseInput());
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0].text).toContain("הודעה: 1");
    expect(doc.sections[0].text).toContain("היי");
    expect(doc.sections[1].text).toContain("הודעה: 2");
    expect(doc.sections[1].text).toContain("המחיר הוא 100");
    expect(doc.sections[0].text).toContain("כיוון: יוצא");
    expect(doc.sections[1].text).toContain("כיוון: נכנס");
    expect(doc.sections[0].link).toContain("/source/thread/");
    expect(doc.sections[0].link).toContain("message=m1");
  });

  it("uses ללא נושא when subject missing", () => {
    const doc = normalizeThreadDocument(baseInput({ subject: "  " }));
    expect(doc.semanticIdentifier).toBe("ללא נושא");
    expect(doc.title).toBe("ללא נושא");
  });

  it("prefers clean_conversation over plain_text", () => {
    const selected = selectMessageBody({
      id: "m",
      subject: "s",
      plainText: "plain",
      cleanConversation: "clean only",
      direction: "inbound",
      providerDateAt: null,
      participants: [],
      attachments: [],
    });
    expect(selected.source).toBe("clean_conversation");
    expect(selected.text).toBe("clean only");
  });

  it("falls back to plain_text and tracks quality", () => {
    const doc = normalizeThreadDocument(baseInput());
    expect(doc.quality.plainTextFallbackCount).toBe(2);
    expect(doc.quality.cleanConversationCount).toBe(0);
  });

  it("includes attachment metadata only", () => {
    const doc = normalizeThreadDocument(baseInput());
    expect(doc.sections[0].text).toContain("quote.pdf");
    expect(doc.sections[0].text).toContain("application/pdf");
    expect(doc.metadata.has_attachments).toBe("true");
    expect(doc.metadata.attachment_count).toBe("1");
  });

  it("never includes html tags from plain bodies", () => {
    const doc = normalizeThreadDocument(
      baseInput({
        messages: [
          {
            id: "m1",
            subject: "s",
            plainText: "Hello world",
            cleanConversation: null,
            direction: "inbound",
            providerDateAt: "2024-01-01T00:00:00.000Z",
            participants: [{ role: "from", email: "x@y.com", name: null }],
            attachments: [],
          },
        ],
      }),
    );
    expect(doc.sections[0].text).not.toMatch(/<\/?[a-z][\s\S]*>/i);
  });

  it("keeps hash stable for same content and changes when body changes", () => {
    const a = normalizeThreadDocument(baseInput());
    const b = normalizeThreadDocument(baseInput());
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const changed = normalizeThreadDocument(
      baseInput({
        messages: [
          {
            ...baseInput().messages[1],
            id: "m1",
            plainText: "changed",
            providerDateAt: "2024-02-01T09:00:00.000Z",
            participants: baseInput().messages[1].participants,
            attachments: baseInput().messages[1].attachments,
            subject: "הצעת מחיר",
            cleanConversation: null,
            direction: "outbound",
          },
          baseInput().messages[0],
        ],
      }),
    );
    expect(changed.contentHash).not.toBe(a.contentHash);
    expect(stableJsonHash({ x: 1 })).not.toBe(stableJsonHash({ x: 2 }));
  });

  it("metadata uses string | string[] only", () => {
    const doc = normalizeThreadDocument(baseInput());
    for (const value of Object.values(doc.metadata)) {
      expect(
        typeof value === "string" ||
          (Array.isArray(value) && value.every((x) => typeof x === "string")),
      ).toBe(true);
    }
    expect(doc.metadata.source_type).toBe("email_thread");
    expect(doc.metadata.user_id).toBe(baseInput().userId);
  });
});
