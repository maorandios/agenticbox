import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

function readMigration(name: string) {
  return readFileSync(path.join(migrationsDir, name), "utf8");
}

describe("mail migrations contracts", () => {
  it("keeps nylas_grant_id and oauth_states in private schema only", () => {
    const pub = readMigration("0002_mail_public.sql");
    const priv = readMigration("0003_mail_private.sql");

    expect(pub).not.toMatch(/\bnylas_grant_id\b/);
    expect(pub).not.toMatch(/\bgrant_id\b/);
    expect(pub).not.toMatch(/\boauth_states\b/);
    expect(pub).not.toMatch(/\braw_html\b/);
    expect(priv).toMatch(/private\.mail_account_credentials/);
    expect(priv).toMatch(/nylas_grant_id/);
    expect(priv).toMatch(/private\.oauth_states/);
    expect(priv).toMatch(/private\.message_raw_sources/);
    expect(priv).toMatch(/private\.webhook_payloads/);
  });

  it("uses composite tenant foreign keys on messages", () => {
    const pub = readMigration("0002_mail_public.sql");
    expect(pub).toMatch(
      /foreign key \(user_id, mail_account_id\)\s+references public\.mail_accounts \(user_id, id\)/,
    );
    expect(pub).toMatch(
      /foreign key \(user_id, thread_id\)\s+references public\.threads \(user_id, id\)/,
    );
  });

  it("defines atomic webhook ingest RPC locked to service_role", () => {
    const rpc = readMigration("0004_secure_rpcs.sql");
    expect(rpc).toMatch(/create or replace function private\.ingest_nylas_webhook/);
    expect(rpc).toMatch(/pgmq\.send/);
    expect(rpc).toMatch(
      /revoke all on function private\.ingest_nylas_webhook[\s\S]*from public, anon, authenticated/,
    );
    expect(rpc).toMatch(
      /grant execute on function private\.ingest_nylas_webhook[\s\S]*to service_role/,
    );
    expect(rpc).toMatch(/set search_path =/);
  });

  it("revokes authenticated writes on public mail tables", () => {
    const pub = readMigration("0002_mail_public.sql");
    expect(pub).toMatch(
      /revoke all on table public\.messages from public, anon, authenticated/,
    );
    expect(pub).toMatch(/grant all on table public\.messages to service_role/);
  });

  it("adds grant lookup helpers and service_role public wrappers", () => {
    const helpers = readMigration("0006_oauth_lookup_helpers.sql");
    const wrappers = readMigration("0007_public_service_rpc_wrappers.sql");
    expect(helpers).toMatch(/private\.find_mail_account_by_grant/);
    expect(helpers).toMatch(/private\.delete_mail_account_grant/);
    expect(wrappers).toMatch(/public\.create_oauth_state/);
    expect(wrappers).toMatch(/public\.find_mail_account_by_grant/);
    expect(wrappers).toMatch(
      /revoke all on function public\.create_oauth_state[\s\S]*from public, anon, authenticated/,
    );
    expect(wrappers).toMatch(
      /grant execute on function public\.create_oauth_state[\s\S]*to service_role/,
    );
  });

  it("adds backfill progress columns and queue wrappers", () => {
    const mig = readMigration("0008_backfill_progress_and_queue_wrappers.sql");
    expect(mig).toMatch(/message_count_synced/);
    expect(mig).toMatch(/public\.mail_jobs_send/);
    expect(mig).toMatch(/public\.upsert_message_raw_source/);
    expect(mig).toMatch(
      /revoke all on function public\.mail_jobs_send[\s\S]*from public, anon, authenticated/,
    );
  });

  it("adds onyx index state and dedicated onyx_jobs queue", () => {
    const mig = readMigration("0011_onyx_index_state.sql");
    expect(mig).toMatch(/public\.onyx_index_state/);
    expect(mig).toMatch(/pgmq\.create\('onyx_jobs'\)/);
    expect(mig).toMatch(/on delete restrict/);
  });

  it("adds feed intelligence tables and dedicated feed_jobs queue", () => {
    const mig = readMigration("0012_feed_intelligence.sql");
    expect(mig).toMatch(/public\.feed_items/);
    expect(mig).toMatch(/public\.thread_intelligence_state/);
    expect(mig).toMatch(/public\.feed_extraction_runs/);
    expect(mig).toMatch(/pgmq\.create\('feed_jobs'\)/);
  });
});