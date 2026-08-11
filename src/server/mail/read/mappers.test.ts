import { describe, expect, it } from "vitest";
import { assertNoSecretLeak } from "@/server/mail/account-dto";
import {
  participantIdFromEmail,
  rewriteSanitizedHtmlForClient,
  toParticipant,
  toThreadDto,
} from "@/server/mail/read/mappers";

describe("mail read mappers", () => {
  it("builds participant from email when name missing", () => {
    const p = toParticipant({ email: "Ada.Lovelace@Example.com", name: null });
    expect(p.id).toBe("p:ada.lovelace@example.com");
    expect(p.email).toBe("ada.lovelace@example.com");
    expect(p.name.length).toBeGreaterThan(0);
    expect(p.initials.length).toBeGreaterThan(0);
  });

  it("rewrites cid to attachment proxy and blocks remote images", () => {
    const map = new Map([["img001", "att-uuid"]]);
    const { html, blockedExternalImageCount } = rewriteSanitizedHtmlForClient({
      html: `<p>hi</p><img src="cid:img001"><img src="https://track.example/pixel.gif">`,
      cidToAttachmentId: map,
    });
    expect(html).toContain("/api/mail/attachments/att-uuid");
    expect(html).not.toContain("cid:img001");
    expect(html).toContain("data-blocked-src=");
    expect(html).not.toMatch(/\ssrc="https:\/\/track\.example/);
    expect(blockedExternalImageCount).toBe(1);
  });

  it("maps thread dto without provider ids", () => {
    const thread = toThreadDto({
      id: "t1",
      subject: "Hello",
      snippet: "world",
      unread: true,
      latest_message_at: "2026-01-01T00:00:00.000Z",
      participants_summary: [{ email: "a@b.com", name: "A" }],
      folders: ["INBOX"],
    });
    expect(thread.id).toBe("t1");
    expect(thread.participantIds).toEqual([participantIdFromEmail("a@b.com")]);
    expect(JSON.stringify(thread)).not.toMatch(/provider/i);
    expect(JSON.stringify(thread)).not.toMatch(/grant/i);
    expect(JSON.stringify(thread)).not.toMatch(/raw/i);
  });
});

describe("assertNoSecretLeak for mail payloads", () => {
  it("allows public account/provider field", () => {
    expect(() =>
      assertNoSecretLeak({
        account: { id: "1", email: "a@b.com", provider: "google" },
      }),
    ).not.toThrow();
  });

  it("rejects raw html and provider message ids", () => {
    expect(() => assertNoSecretLeak({ raw_html: "<b>x</b>" })).toThrow();
    expect(() =>
      assertNoSecretLeak({ provider_message_id: "msg" }),
    ).toThrow();
  });
});
