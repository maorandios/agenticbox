export function resolveDirection(params: {
  from: Array<{ email?: string | null }> | undefined;
  accountEmail: string;
  aliases: string[];
}): "inbound" | "outbound" {
  const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
  const owned = new Set(
    [params.accountEmail, ...params.aliases].map(normalize).filter(Boolean),
  );
  const fromEmails = (params.from ?? []).map((p) => normalize(p.email));
  if (fromEmails.some((email) => owned.has(email))) return "outbound";
  return "inbound";
}
