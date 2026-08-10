const relativeFormatter = new Intl.RelativeTimeFormat("he", { numeric: "auto" });

export function formatThreadTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 60) {
    return relativeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return relativeFormatter.format(diffDays, "day");
  }

  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatFullDate(iso: string) {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** Full message timestamp, e.g. "12 באוגוסט 2026, 11:42" */
export function formatMessageDateTime(iso: string) {
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${datePart}, ${timePart}`;
}

/** Compact stamp in bubble metadata: "8 באוג׳ · 14:20" */
export function formatCompactMessageStamp(iso: string) {
  const date = new Date(iso);
  const dayMonth = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${dayMonth} · ${timePart}`;
}

/** Compact stamp for quoted summary: "7 באוג׳, 17:30" */
export function formatQuotedMessageStamp(iso: string) {
  const date = new Date(iso);
  const dayMonth = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${dayMonth}, ${timePart}`;
}

/** Tooltip / details: "8 באוגוסט 2026 בשעה 14:20" */
export function formatMessageDateTimeLong(iso: string) {
  const date = new Date(iso);
  const datePart = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${datePart} בשעה ${timePart}`;
}

export function formatThreadOpenedLabel(iso: string) {
  return `נפתח ב־${formatFullDate(iso)}`;
}

export function formatLastActivityLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const timePart = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (dayDiff === 0) return `הודעה אחרונה היום ב־${timePart}`;
  if (dayDiff === 1) return `הודעה אחרונה אתמול ב־${timePart}`;
  return `הודעה אחרונה ב־${formatFullDate(iso)}, ${timePart}`;
}
