import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNylasClient } from "./client";
import { getNylasConfig } from "./config";
import { createOauthNonce } from "./oauth-nonce";

export { createOauthNonce };

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function persistOauthState(params: {
  userId: string;
  nonce: string;
  redirectPath?: string | null;
}) {
  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
  const { data, error } = await admin.rpc("create_oauth_state", {
    p_user_id: params.userId,
    p_nonce: params.nonce,
    p_expires_at: expiresAt,
    p_redirect_path: params.redirectPath ?? "/settings",
  });

  if (error) {
    throw new Error(`Failed to create oauth state: ${error.message}`);
  }

  return { stateId: data as string, expiresAt };
}

export async function consumeOauthState(params: {
  nonce: string;
  userId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_oauth_state", {
    p_nonce: params.nonce,
    p_user_id: params.userId,
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already used")) {
      return { ok: false as const, reason: "used" as const };
    }
    if (message.includes("expired")) {
      return { ok: false as const, reason: "expired" as const };
    }
    if (message.includes("mismatch")) {
      return { ok: false as const, reason: "user_mismatch" as const };
    }
    if (message.includes("invalid")) {
      return { ok: false as const, reason: "invalid" as const };
    }
    return { ok: false as const, reason: "invalid" as const };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false as const, reason: "invalid" as const };
  }

  return {
    ok: true as const,
    stateId: row.state_id as string,
    redirectPath: (row.redirect_path as string | null) ?? "/settings",
  };
}

export function buildGmailAuthUrl(state: string) {
  const nylas = getNylasClient();
  const config = getNylasConfig();
  return nylas.auth.urlForOAuth2({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    provider: "google",
    accessType: "offline",
    state,
    scope: config.scopes,
  });
}

export async function exchangeOauthCode(code: string) {
  const nylas = getNylasClient();
  const config = getNylasConfig();
  return nylas.auth.exchangeCodeForToken({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    code,
  });
}

export async function destroyNylasGrant(grantId: string) {
  const nylas = getNylasClient();
  await nylas.grants.destroy({ grantId });
}
