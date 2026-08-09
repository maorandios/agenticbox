/** First grapheme of first name + first grapheme of last name. */
export function getDisplayInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  const graphemes = (value: string) => {
    if (segmenter) {
      return [...segmenter.segment(value)].map((s) => s.segment);
    }
    return Array.from(value);
  };

  const parts = trimmed.split(/\s+/).filter(Boolean);
  let initials: string;

  if (parts.length === 1) {
    initials = graphemes(parts[0]).slice(0, 2).join("");
  } else {
    const first = graphemes(parts[0])[0] ?? "";
    const last = graphemes(parts[parts.length - 1])[0] ?? "";
    initials = `${first}${last}`;
  }

  if (!initials) return "?";
  return /[A-Za-z]/.test(initials) ? initials.toUpperCase() : initials;
}
