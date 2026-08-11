import { randomBytes } from "node:crypto";

/** Pure helper — safe for unit tests without Nylas/Supabase. */
export function createOauthNonce() {
  return randomBytes(32).toString("base64url");
}
