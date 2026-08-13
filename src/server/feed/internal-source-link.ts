/**
 * O5C.1.1 — Strict parser for AgenticBox-owned Onyx section links.
 * Indexer writes: `/source/thread/{threadId}?message={messageId}` (never from email body).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RELATIVE_PATH_RE =
  /^\/source\/thread\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function appOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns threadId only for exact internal source links we control.
 * Query/fragment never supply the thread id. Foreign hosts rejected.
 */
export function parseInternalThreadSourceLink(
  link: string | null | undefined,
): string | null {
  if (link == null) return null;
  const raw = link.trim();
  if (!raw) return null;
  // Reject traversal / backslash tricks early.
  if (raw.includes("..") || raw.includes("\\")) return null;

  // Relative form: /source/thread/{uuid} with optional ?query and #fragment (ignored).
  if (raw.startsWith("/")) {
    let pathOnly = raw;
    const q = pathOnly.indexOf("?");
    if (q >= 0) pathOnly = pathOnly.slice(0, q);
    const h = pathOnly.indexOf("#");
    if (h >= 0) pathOnly = pathOnly.slice(0, h);
    const m = RELATIVE_PATH_RE.exec(pathOnly);
    if (!m?.[1] || !UUID_RE.test(m[1])) return null;
    return m[1].toLowerCase();
  }

  // Absolute URL — origin must match APP URL.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const expected = appOrigin();
  if (!expected) return null;
  if (url.origin.toLowerCase() !== expected) return null;
  const m = RELATIVE_PATH_RE.exec(url.pathname);
  if (!m?.[1] || !UUID_RE.test(m[1])) return null;
  // Explicitly ignore searchParams / hash for ownership.
  return m[1].toLowerCase();
}
