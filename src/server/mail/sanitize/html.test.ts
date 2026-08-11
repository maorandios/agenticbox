import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "@/server/mail/sanitize/html";

describe("sanitizeEmailHtml", () => {
  it("strips scripts and keeps safe markup", () => {
    const result = sanitizeEmailHtml(
      `<p>שלום</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a>`,
    );
    expect(result.extractionStatus).toBe("sanitized_ok");
    expect(result.sanitizedHtml).toContain("שלום");
    expect(result.sanitizedHtml).not.toContain("script");
    expect(result.sanitizedHtml).not.toContain("javascript:");
    expect(result.plainText).toContain("שלום");
  });

  it("preserves cid image references for later proxy", () => {
    const result = sanitizeEmailHtml(`<img src="cid:abc123" alt="x">`);
    expect(result.sanitizedHtml).toContain('src="cid:abc123"');
  });

  it("keeps table layout attributes needed for order emails", () => {
    const result = sanitizeEmailHtml(
      `<table width="100%" cellpadding="6"><tr><td width="40%" align="right"><b>מוצר</b></td><td>1</td></tr></table>`,
    );
    expect(result.sanitizedHtml).toContain('width="100%"');
    expect(result.sanitizedHtml).toContain('cellpadding="6"');
    expect(result.sanitizedHtml).toContain('align="right"');
  });
});
