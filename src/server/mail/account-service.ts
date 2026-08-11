import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { destroyNylasGrant } from "@/server/nylas/oauth";
import {
  assertNoSecretLeak,
  toMailAccountDto,
  type MailAccountDto,
} from "./account-dto";

type DbMailAccount = {
  id: string;
  user_id: string;
  email: string;
  provider: string;
  sync_status: string;
  last_successful_sync_at: string | null;
  error_message_safe: string | null;
  aliases: unknown;
};

export async function getMailAccountForUser(
  userId: string,
): Promise<MailAccountDto | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mail_accounts")
    .select(
      "id, user_id, email, provider, sync_status, last_successful_sync_at, error_message_safe, aliases, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
    )
    .eq("user_id", userId)
    .neq("sync_status", "disconnected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mail account: ${error.message}`);
  }
  if (!data) {
    // Also surface the latest disconnected account for reconnect UI
    const disconnected = await admin
      .from("mail_accounts")
      .select(
        "id, user_id, email, provider, sync_status, last_successful_sync_at, error_message_safe, aliases, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (disconnected.error) {
      throw new Error(`Failed to load mail account: ${disconnected.error.message}`);
    }
    if (!disconnected.data) return null;
    const dto = toMailAccountDto(disconnected.data as DbMailAccount);
    assertNoSecretLeak(dto);
    return dto;
  }

  const dto = toMailAccountDto(data as DbMailAccount);
  assertNoSecretLeak(dto);
  return dto;
}

/**
 * Idempotent upsert by Nylas grant id (and email per user).
 * grant_id is written only via private RPC — never selected into API responses.
 */
export async function upsertMailAccountFromGrant(params: {
  userId: string;
  grantId: string;
  email: string;
  provider?: "google" | "microsoft";
}): Promise<{ account: MailAccountDto; created: boolean }> {
  const admin = createAdminClient();
  const email = params.email.trim().toLowerCase();
  const provider = params.provider ?? "google";

  const { data: byGrant, error: grantLookupError } = await admin.rpc(
    "find_mail_account_by_grant",
    { p_nylas_grant_id: params.grantId },
  );
  if (grantLookupError) {
    throw new Error(`Grant lookup failed: ${grantLookupError.message}`);
  }

  const grantRow = Array.isArray(byGrant) ? byGrant[0] : byGrant;
  if (grantRow) {
    if (grantRow.user_id !== params.userId) {
      throw new Error("Grant already linked to another user");
    }

    const { data: updated, error: updateError } = await admin
      .from("mail_accounts")
      .update({
        email,
        provider,
        sync_status: "pending",
        error_code: null,
        error_message_safe: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", grantRow.mail_account_id)
      .eq("user_id", params.userId)
      .select(
        "id, email, provider, sync_status, last_successful_sync_at, error_message_safe, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
      )
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Failed to update mail account: ${updateError?.message ?? "unknown"}`,
      );
    }

    const { error: credError } = await admin.rpc("upsert_mail_account_grant", {
      p_mail_account_id: grantRow.mail_account_id,
      p_user_id: params.userId,
      p_nylas_grant_id: params.grantId,
    });
    if (credError) {
      throw new Error(`Failed to store grant: ${credError.message}`);
    }

    const dto = toMailAccountDto(updated);
    assertNoSecretLeak(dto);
    return { account: dto, created: false };
  }

  const { data: existingByEmail } = await admin
    .from("mail_accounts")
    .select(
      "id, email, provider, sync_status, last_successful_sync_at, error_message_safe",
    )
    .eq("user_id", params.userId)
    .eq("email", email)
    .maybeSingle();

  if (existingByEmail) {
    const { data: updated, error: updateError } = await admin
      .from("mail_accounts")
      .update({
        provider,
        sync_status: "pending",
        error_code: null,
        error_message_safe: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingByEmail.id)
      .eq("user_id", params.userId)
      .select(
        "id, email, provider, sync_status, last_successful_sync_at, error_message_safe, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
      )
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Failed to reconnect mail account: ${updateError?.message ?? "unknown"}`,
      );
    }

    const { error: credError } = await admin.rpc("upsert_mail_account_grant", {
      p_mail_account_id: existingByEmail.id,
      p_user_id: params.userId,
      p_nylas_grant_id: params.grantId,
    });
    if (credError) {
      throw new Error(`Failed to store grant: ${credError.message}`);
    }

    const dto = toMailAccountDto(updated);
    assertNoSecretLeak(dto);
    return { account: dto, created: false };
  }

  const { data: inserted, error: insertError } = await admin
    .from("mail_accounts")
    .insert({
      user_id: params.userId,
      email,
      provider,
      sync_status: "pending",
      aliases: [],
    })
    .select(
      "id, email, provider, sync_status, last_successful_sync_at, error_message_safe, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
    )
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `Failed to create mail account: ${insertError?.message ?? "unknown"}`,
    );
  }

  const { error: credError } = await admin.rpc("upsert_mail_account_grant", {
    p_mail_account_id: inserted.id,
    p_user_id: params.userId,
    p_nylas_grant_id: params.grantId,
  });
  if (credError) {
    await admin.from("mail_accounts").delete().eq("id", inserted.id);
    throw new Error(`Failed to store grant: ${credError.message}`);
  }

  const dto = toMailAccountDto(inserted);
  assertNoSecretLeak(dto);
  return { account: dto, created: true };
}

export async function disconnectMailAccountForUser(userId: string): Promise<{
  ok: true;
  account: MailAccountDto;
} | { ok: false; reason: "not_found" }> {
  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("mail_accounts")
    .select(
      "id, email, provider, sync_status, last_successful_sync_at, error_message_safe, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
    )
    .eq("user_id", userId)
    .neq("sync_status", "disconnected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mail account: ${error.message}`);
  }
  if (!account) {
    return { ok: false, reason: "not_found" };
  }

  const { data: grantId, error: grantError } = await admin.rpc(
    "get_mail_account_grant",
    { p_mail_account_id: account.id },
  );
  if (grantError) {
    throw new Error(`Failed to load grant: ${grantError.message}`);
  }

  if (typeof grantId === "string" && grantId.length > 0) {
    try {
      await destroyNylasGrant(grantId);
    } catch {
      // Still disconnect locally if Nylas revoke fails (grant may already be gone).
    }
  }

  await admin.rpc("delete_mail_account_grant", {
    p_mail_account_id: account.id,
  });

  const { data: updated, error: updateError } = await admin
    .from("mail_accounts")
    .update({
      sync_status: "disconnected",
      error_code: null,
      error_message_safe: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .eq("user_id", userId)
    .select(
      "id, email, provider, sync_status, last_successful_sync_at, error_message_safe, thread_count_synced, message_count_synced, sync_started_at, sync_finished_at, sync_rate_limit_hits, sync_retry_count, backfill_completed_at",
    )
    .single();

  if (updateError || !updated) {
    throw new Error(
      `Failed to disconnect mail account: ${updateError?.message ?? "unknown"}`,
    );
  }

  const dto = toMailAccountDto(updated);
  assertNoSecretLeak(dto);
  return { ok: true, account: dto };
}
