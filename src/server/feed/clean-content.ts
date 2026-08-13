/**
 * Conservative Feed-only content cleaner.
 * Prefer leaving extra text over deleting the message body.
 */

export type CleanedMessageBody = {
  cleanText: string;
  removedKinds: Array<
    "quote" | "signature" | "disclaimer" | "unsubscribe" | "headers"
  >;
  /** Lowercased normalized text of removed sections — for evidence rejection. */
  removedNormalized: string[];
};

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

const QUOTE_SPLITTERS = [
  // Forward blocks (incl. Gmail concatenated without leading newline)
  /-{2,}\s*Forwarded message\s*-{2,}/i,
  /-{2,}\s*Original Message\s*-{2,}/i,
  // Gmail often concatenates without a leading newline: "חסר אוטוקאדOn Tue…wrote:"
  /(?<![A-Za-z])On\s+[A-Z][a-z]{2},?\s+[A-Z][a-z]{2}\s+\d{1,2}.+?\bwrote:\s*/i,
  /(?<![A-Za-z])On\s+.+?\bwrote:\s*/i,
  /\nOn .+ wrote:\s*\n/i,
  /\nFrom:\s.+\nSent:\s/i,
  /\nFrom:\s.+\nDate:\s/i,
  /\n-+\s*Original Message\s*-+/i,
  /\nמאת:\s.+\nנשלח:\s/i,
  /\nמאת:\s.+\nאל:\s/i,
  /\nב-\d{1,2}[./]\d{1,2}[./]\d{2,4}.+כתב:/,
  // Gmail Hebrew inline quotes (often without newlines; may include times like 6:43)
  /בתאריך יום .{0,120}?מאת\s+/i,
  /\u200f?בתאריך יום .{0,120}?מאת\s+/i,
];

const UNSUBSCRIBE_LINE =
  /(?:unsubscribe|opt[\s-]?out|הסרה מרשימת תפוצה|להסרה מהרשימה|ניהול העדפות דיוור)/i;

const DISCLAIMER_MARKERS =
  /(?:this (?:e-?mail|message) (?:and any attachments )?(?:is|are) confidential|הודעה זו ושליחותיה מיועדות|confidentiality notice|legal disclaimer)/i;

const SIGNATURE_MARKERS =
  /(?:^|\n)--\s*\n|^\s*Sent from my (?:iPhone|Android)|נשלח מה-iPhone|^Best regards,?\s*$|^בברכה,?\s*$/im;

/**
 * Strip quoted history / footers conservatively. Never returns empty if input had content
 * unless the entire body matched a quote-only pattern with a short lead-in.
 */
export function cleanFeedMessageBody(raw: string): CleanedMessageBody {
  const removedKinds: CleanedMessageBody["removedKinds"] = [];
  const removedNormalized: string[] = [];
  let text = raw.replace(/\r\n/g, "\n");

  // Ensure Forward/Original separators are not glued to CURRENT lead text.
  text = text.replace(
    /([^\s\n])(-{2,}\s*(?:Forwarded message|Original Message)\s*-{2,})/gi,
    "$1\n$2",
  );

  if (!normalizeWhitespace(text)) {
    return { cleanText: "", removedKinds: [], removedNormalized: [] };
  }

  for (const splitter of QUOTE_SPLITTERS) {
    const idx = text.search(splitter);
    if (idx >= 0) {
      const lead = text.slice(0, idx).trim();
      // Keep a real current-message lead-in; avoid wiping quote-only bodies.
      if (lead.length >= 2) {
        const removed = text.slice(idx);
        text = text.slice(0, idx);
        removedKinds.push("quote");
        removedNormalized.push(normalizeForMatch(removed));
        break;
      }
    }
  }

  // Trailing quoted lines starting with >
  const lines = text.split("\n");
  let cut = lines.length;
  while (cut > 0 && /^\s*>/.test(lines[cut - 1] ?? "")) {
    cut -= 1;
  }
  if (cut < lines.length && cut > 2) {
    const removed = lines.slice(cut).join("\n");
    text = lines.slice(0, cut).join("\n");
    removedKinds.push("quote");
    removedNormalized.push(normalizeForMatch(removed));
  }

  const unsubIdx = text.search(UNSUBSCRIBE_LINE);
  if (unsubIdx > 80) {
    const removed = text.slice(unsubIdx);
    text = text.slice(0, unsubIdx);
    removedKinds.push("unsubscribe");
    removedNormalized.push(normalizeForMatch(removed));
  }

  const discIdx = text.search(DISCLAIMER_MARKERS);
  if (discIdx > 120) {
    const removed = text.slice(discIdx);
    text = text.slice(0, discIdx);
    removedKinds.push("disclaimer");
    removedNormalized.push(normalizeForMatch(removed));
  }

  const sigMatch = text.search(SIGNATURE_MARKERS);
  if (sigMatch >= 0) {
    const lead = text.slice(0, sigMatch).trim();
    const after = text.slice(sigMatch);
    // Only treat as signature if there is a real body and a relatively short trailing block.
    if (
      lead.length >= 5 &&
      after.length < Math.max(280, text.length * 0.45)
    ) {
      text = text.slice(0, sigMatch);
      removedKinds.push("signature");
      removedNormalized.push(normalizeForMatch(after));
    }
  }

  // Header-looking preamble blocks (From/Sent/To/Subject) at top of forwarded body.
  const headerBlock =
    /^(?:From|Sent|To|Subject|מאת|נשלח|אל|נושא)\s*:.+(?:\n(?:From|Sent|To|Subject|Cc|מאת|נשלח|אל|נושא|עותק)\s*:.+){1,6}\n+/i;
  if (headerBlock.test(text)) {
    const removed = text.match(headerBlock)?.[0] ?? "";
    text = text.replace(headerBlock, "");
    if (removed) {
      removedKinds.push("headers");
      removedNormalized.push(normalizeForMatch(removed));
    }
  }

  const cleanText = normalizeWhitespace(text);
  // Safety: if stripping wiped the body entirely, restore original.
  // Short legitimate bodies (e.g. "תודה.") after signature removal must stay.
  if (!cleanText && normalizeWhitespace(raw).length > 0) {
    return {
      cleanText: normalizeWhitespace(raw),
      removedKinds: [],
      removedNormalized: [],
    };
  }

  return { cleanText, removedKinds, removedNormalized };
}

export function evidenceLooksRemoved(opts: {
  evidenceText: string;
  cleanText: string;
  removedNormalized: string[];
}): boolean {
  const evidence = normalizeForMatch(opts.evidenceText);
  if (!evidence) return true;
  const clean = normalizeForMatch(opts.cleanText);
  if (clean.includes(evidence)) return false;
  return opts.removedNormalized.some((block) => block.includes(evidence));
}
