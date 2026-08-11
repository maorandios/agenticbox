import "server-only";
import { GMAIL_READONLY_SCOPES } from "./scopes";

export function getNylasConfig() {
  const apiKey = process.env.NYLAS_API_KEY?.trim();
  const apiUri = (process.env.NYLAS_API_URI ?? "https://api.us.nylas.com").trim();
  const clientId = process.env.NYLAS_CLIENT_ID?.trim();
  const redirectUri = (
    process.env.NYLAS_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/mail/oauth/callback`
  ).trim();

  if (!apiKey || !clientId) {
    throw new Error("Nylas env is not configured (NYLAS_API_KEY, NYLAS_CLIENT_ID)");
  }

  return {
    apiKey,
    apiUri,
    clientId,
    redirectUri,
    scopes: [...GMAIL_READONLY_SCOPES],
  };
}

export function isNylasConfigured() {
  return Boolean(
    process.env.NYLAS_API_KEY?.trim() && process.env.NYLAS_CLIENT_ID?.trim(),
  );
}

export { GMAIL_READONLY_SCOPES };
