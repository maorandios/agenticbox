/**
 * Deterministic mailbox identity, participant names, and request direction.
 * Email address is the source of truth — never display names or auth.user.email.
 */

export type AccountIdentity = {
  email: string;
  type: "primary" | "alias" | "verified_team";
};

export type MailboxIdentity = {
  mailAccountId: string;
  primaryEmail: string;
  verifiedAliases: string[];
  /** Always shown for this mailbox in UI — never raw From header variants. */
  canonicalDisplayName: string;
};

export type CanonicalParticipant = {
  email: string;
  canonicalDisplayName: string;
  sourceDisplayNames: string[];
  isMailboxOwner: boolean;
};

export type ResponsibilityScope =
  | "account_owner"
  | "account_owner_team"
  | "external_person"
  | "unknown";

export type MessageAccountRelation =
  | "sent_by_account"
  | "sent_to_account"
  | "cc_to_account"
  | "bcc_to_account"
  | "external_to_external"
  | "unknown";

export type RequestDirection =
  | "requested_from_account_owner"
  | "sent_by_account_owner"
  | "external_to_external"
  | "self_commitment"
  | "team_request"
  | "unknown";

/** Product-facing relation labels (mapped from RequestDirection). */
export type RelationToMailbox =
  | "requested_from_me"
  | "sent_by_me"
  | "my_commitment"
  | "external_to_external"
  | "unknown";

const GENERIC_DISPLAY_NAMES = new Set([
  "office",
  "me",
  "mail",
  "info",
  "admin",
  "noreply",
  "no-reply",
  "support",
]);

/** Invisible / bidi marks that appear in Gmail plain text. */
const INVISIBLE =
  /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\u00AD]/g;

/**
 * Deterministic polish for external ASCII names (rotem mair → Rotem Mair).
 * Never invent Hebrew/company names absent from source data.
 */
export function improveExternalDisplayName(name: string): string {
  const trimmed = name.replace(INVISIBLE, "").trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(/\s+/);
  // Keep local-part-ish labels like "office gaash" unchanged.
  if (parts.some((p) => isGenericDisplayName(p))) return trimmed;
  if (/^[\x00-\x7F]+$/.test(trimmed) && /\s/.test(trimmed)) {
    return parts
      .map((w) =>
        w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w,
      )
      .join(" ");
  }
  return trimmed;
}

/**
 * Normalize an address for mailbox matching only:
 * trim, lowercase, strip mailto:, angle brackets / display name, invisible chars.
 * Does NOT strip +tags or unify domains.
 */
export function normalizeEmailAddress(
  email: string | null | undefined,
): string | null {
  if (email == null) return null;
  let e = String(email).replace(INVISIBLE, "").trim();
  if (!e) return null;
  if (/^mailto:/i.test(e)) e = e.slice(7).trim();
  const angle = e.match(/<([^>]+)>/);
  if (angle?.[1]) e = angle[1].trim();
  if (!e.includes("@") || /\s/.test(e)) {
    const token = e.split(/\s+/).find((t) => t.includes("@"));
    if (token) e = token.replace(/^<|>$/g, "");
  }
  e = e.toLowerCase().trim();
  if (!e.includes("@") || e.startsWith("@") || e.endsWith("@")) return null;
  return e;
}

function normalizeEmail(email: string | null | undefined): string | null {
  return normalizeEmailAddress(email);
}

export function loadAccountIdentities(opts: {
  primaryEmail: string;
  aliases: unknown;
}): AccountIdentity[] {
  const out: AccountIdentity[] = [];
  const seen = new Set<string>();

  const primary = normalizeEmail(opts.primaryEmail);
  if (primary) {
    out.push({ email: primary, type: "primary" });
    seen.add(primary);
  }

  const rawAliases = Array.isArray(opts.aliases) ? opts.aliases : [];
  for (const entry of rawAliases) {
    if (typeof entry === "string") {
      const email = normalizeEmail(entry);
      if (!email || seen.has(email)) continue;
      out.push({ email, type: "alias" });
      seen.add(email);
      continue;
    }
    if (entry && typeof entry === "object") {
      const obj = entry as { email?: unknown; type?: unknown };
      const email = normalizeEmail(
        typeof obj.email === "string" ? obj.email : null,
      );
      if (!email || seen.has(email)) continue;
      const type =
        obj.type === "verified_team"
          ? "verified_team"
          : obj.type === "primary"
            ? "primary"
            : "alias";
      out.push({ email, type });
      seen.add(email);
    }
  }

  return out;
}

export const DEFAULT_TRIG_CANONICAL_DISPLAY_NAME =
  "מאור | טריגו מידול והנדסה";

export function resolveMailboxIdentity(opts: {
  mailAccountId: string;
  primaryEmail: string;
  aliases: unknown;
  canonicalDisplayName?: string | null;
}): MailboxIdentity {
  const identities = loadAccountIdentities({
    primaryEmail: opts.primaryEmail,
    aliases: opts.aliases,
  });
  const primary =
    identities.find((i) => i.type === "primary")?.email ??
    normalizeEmailAddress(opts.primaryEmail) ??
    "";
  const canonical =
    opts.canonicalDisplayName?.trim() ||
    (primary === "office@trigo-models.com"
      ? DEFAULT_TRIG_CANONICAL_DISPLAY_NAME
      : primary.split("@")[0] || "בעל התיבה");
  return {
    mailAccountId: opts.mailAccountId,
    primaryEmail: primary,
    verifiedAliases: identities
      .filter((i) => i.type !== "primary")
      .map((i) => i.email),
    canonicalDisplayName: canonical,
  };
}

export function mailboxIdentitiesFrom(
  mailbox: MailboxIdentity,
): AccountIdentity[] {
  return loadAccountIdentities({
    primaryEmail: mailbox.primaryEmail,
    aliases: mailbox.verifiedAliases,
  });
}

export function resolveResponsibilityScope(
  assigneeEmail: string | null,
  accountIdentities: AccountIdentity[],
): ResponsibilityScope {
  const email = normalizeEmail(assigneeEmail);
  if (!email) return "unknown";

  const match = accountIdentities.find((id) => id.email === email);
  if (!match) return "external_person";
  if (match.type === "verified_team") return "account_owner_team";
  return "account_owner";
}

export function isAccountIdentityEmail(
  email: string | null | undefined,
  accountIdentities: AccountIdentity[],
): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  return accountIdentities.some((id) => id.email === e);
}

export function resolveMessageAccountRelation(opts: {
  fromEmail: string | null | undefined;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  accountIdentities: AccountIdentity[];
}): MessageAccountRelation {
  const { accountIdentities } = opts;
  if (isAccountIdentityEmail(opts.fromEmail, accountIdentities)) {
    return "sent_by_account";
  }
  if (opts.toEmails.some((e) => isAccountIdentityEmail(e, accountIdentities))) {
    return "sent_to_account";
  }
  if (opts.ccEmails.some((e) => isAccountIdentityEmail(e, accountIdentities))) {
    return "cc_to_account";
  }
  if (opts.bccEmails.some((e) => isAccountIdentityEmail(e, accountIdentities))) {
    return "bcc_to_account";
  }
  const known =
    Boolean(normalizeEmailAddress(opts.fromEmail)) &&
    (opts.toEmails.length > 0 ||
      opts.ccEmails.length > 0 ||
      opts.bccEmails.length > 0);
  if (known) return "external_to_external";
  return "unknown";
}

/**
 * Recompute request direction + responsibility from verified emails.
 * Model suggestion is ignored for the final values.
 */
export function resolveRequestAttribution(opts: {
  requesterEmail: string | null | undefined;
  assigneeEmail: string | null | undefined;
  requestModality: string | null | undefined;
  sourceFromEmail: string | null | undefined;
  accountIdentities: AccountIdentity[];
}): {
  requestDirection: RequestDirection;
  responsibilityScope: ResponsibilityScope;
  relationToMailbox: RelationToMailbox;
} {
  const identities = opts.accountIdentities;
  const requester = normalizeEmailAddress(opts.requesterEmail);
  const assignee = normalizeEmailAddress(opts.assigneeEmail);
  const fromIsOwner = isAccountIdentityEmail(opts.sourceFromEmail, identities);
  const requesterIsOwner = isAccountIdentityEmail(requester, identities);
  const assigneeIsOwner = isAccountIdentityEmail(assignee, identities);
  const assigneeMatch = assignee
    ? identities.find((id) => id.email === assignee)
    : undefined;

  const modality = opts.requestModality ?? null;

  if (modality === "commitment" && fromIsOwner) {
    return {
      requestDirection: "self_commitment",
      responsibilityScope: "account_owner",
      relationToMailbox: "my_commitment",
    };
  }

  if (requesterIsOwner && assignee && !assigneeIsOwner) {
    return {
      requestDirection: "sent_by_account_owner",
      responsibilityScope: "external_person",
      relationToMailbox: "sent_by_me",
    };
  }

  if (assigneeMatch?.type === "verified_team") {
    return {
      requestDirection: "team_request",
      responsibilityScope: "account_owner_team",
      relationToMailbox: "requested_from_me",
    };
  }

  if (assigneeIsOwner && requester && !requesterIsOwner) {
    return {
      requestDirection: "requested_from_account_owner",
      responsibilityScope: "account_owner",
      relationToMailbox: "requested_from_me",
    };
  }

  if (requester && assignee && !requesterIsOwner && !assigneeIsOwner) {
    return {
      requestDirection: "external_to_external",
      responsibilityScope: "external_person",
      relationToMailbox: "external_to_external",
    };
  }

  const scope = resolveResponsibilityScope(assignee, identities);
  if (scope === "account_owner") {
    return {
      requestDirection: "requested_from_account_owner",
      responsibilityScope: "account_owner",
      relationToMailbox: "requested_from_me",
    };
  }
  if (scope === "account_owner_team") {
    return {
      requestDirection: "team_request",
      responsibilityScope: "account_owner_team",
      relationToMailbox: "requested_from_me",
    };
  }
  if (scope === "external_person") {
    return {
      requestDirection: fromIsOwner
        ? "sent_by_account_owner"
        : "external_to_external",
      responsibilityScope: "external_person",
      relationToMailbox: fromIsOwner ? "sent_by_me" : "external_to_external",
    };
  }

  return {
    requestDirection: "unknown",
    responsibilityScope: "unknown",
    relationToMailbox: "unknown",
  };
}

export function relationToMailboxFromDirection(
  direction: RequestDirection | null | undefined,
): RelationToMailbox {
  switch (direction) {
    case "requested_from_account_owner":
    case "team_request":
      return "requested_from_me";
    case "sent_by_account_owner":
      return "sent_by_me";
    case "self_commitment":
      return "my_commitment";
    case "external_to_external":
      return "external_to_external";
    default:
      return "unknown";
  }
}

function looksLikeEmail(name: string): boolean {
  return name.includes("@");
}

function isGenericDisplayName(name: string): boolean {
  return GENERIC_DISPLAY_NAMES.has(name.trim().toLowerCase());
}

/**
 * Single source of truth for participant display names in Feed cards.
 * Mailbox owner always → canonicalDisplayName. Never trust UI/message.from alone.
 */
export function resolveCanonicalParticipantName(opts: {
  email: string | null | undefined;
  sourceDisplayName?: string | null;
  mailboxIdentity: MailboxIdentity;
  knownParticipants?: CanonicalParticipant[];
}): string {
  const email = normalizeEmailAddress(opts.email);
  const mailboxEmails = new Set([
    opts.mailboxIdentity.primaryEmail,
    ...opts.mailboxIdentity.verifiedAliases,
  ]);

  if (email && mailboxEmails.has(email)) {
    return opts.mailboxIdentity.canonicalDisplayName;
  }

  const known = opts.knownParticipants?.find((p) => p.email === email);
  if (known?.canonicalDisplayName) return known.canonicalDisplayName;

  const source = opts.sourceDisplayName?.replace(INVISIBLE, "").trim() || "";
  if (source && !looksLikeEmail(source) && !isGenericDisplayName(source)) {
    return improveExternalDisplayName(source);
  }

  if (email) return email;
  return improveExternalDisplayName(source) || "משתתף";
}

/**
 * Build a registry of participants seen in a thread / envelope.
 * Mailbox owner always wins with canonicalDisplayName.
 */
export function buildCanonicalParticipantRegistry(opts: {
  mailboxIdentity: MailboxIdentity;
  participants: Array<{ email: string | null; displayName: string | null }>;
}): CanonicalParticipant[] {
  const map = new Map<string, CanonicalParticipant>();
  const mailboxEmails = new Set([
    opts.mailboxIdentity.primaryEmail,
    ...opts.mailboxIdentity.verifiedAliases,
  ]);

  for (const p of opts.participants) {
    const email = normalizeEmailAddress(p.email);
    if (!email) continue;
    const isOwner = mailboxEmails.has(email);
    const source = p.displayName?.replace(INVISIBLE, "").trim() || "";
    const existing = map.get(email);
    const sourceDisplayNames = [
      ...(existing?.sourceDisplayNames ?? []),
      ...(source ? [source] : []),
    ];
    const uniqueSources = Array.from(new Set(sourceDisplayNames));

    let canonicalDisplayName: string;
    if (isOwner) {
      canonicalDisplayName = opts.mailboxIdentity.canonicalDisplayName;
    } else {
      const candidates = uniqueSources.filter(
        (n) => n && !looksLikeEmail(n) && !isGenericDisplayName(n),
      );
      // Prefer Hebrew / non-ASCII full names over latin transliterations.
      candidates.sort((a, b) => {
        const aHe = /[\u0590-\u05FF]/.test(a) ? 1 : 0;
        const bHe = /[\u0590-\u05FF]/.test(b) ? 1 : 0;
        if (aHe !== bHe) return bHe - aHe;
        return b.length - a.length;
      });
      canonicalDisplayName = improveExternalDisplayName(
        candidates[0] || email,
      );
    }

    map.set(email, {
      email,
      canonicalDisplayName,
      sourceDisplayNames: uniqueSources,
      isMailboxOwner: isOwner,
    });
  }

  // Ensure mailbox owner entry exists even if not in participants list
  if (!map.has(opts.mailboxIdentity.primaryEmail)) {
    map.set(opts.mailboxIdentity.primaryEmail, {
      email: opts.mailboxIdentity.primaryEmail,
      canonicalDisplayName: opts.mailboxIdentity.canonicalDisplayName,
      sourceDisplayNames: [],
      isMailboxOwner: true,
    });
  }

  return Array.from(map.values());
}

export function actionTypeLabelForRelation(
  relation: RelationToMailbox | null,
): string {
  if (relation === "requested_from_me") return "נדרשת ממך פעולה";
  if (relation === "sent_by_me") return "בקשה ששלחת";
  if (relation === "my_commitment") return "התחייבות שלך";
  if (relation === "external_to_external") return "בקשה בין משתתפים";
  return "לא ברור מי אחראי";
}
