import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0011_onyx_index_state.sql"),
  "utf8",
);

describe("0011_onyx_index_state migration contract", () => {
  it("defines onyx_index_state with required columns and statuses", () => {
    expect(migration).toMatch(/create table public\.onyx_index_state/i);
    for (const col of [
      "user_id",
      "mail_account_id",
      "thread_id",
      "onyx_document_id",
      "content_hash",
      "status",
      "attempt_count",
      "last_error_code",
      "last_error_message",
      "last_attempt_at",
      "indexed_at",
    ]) {
      expect(migration).toContain(col);
    }
    for (const status of [
      "pending",
      "processing",
      "indexed",
      "failed",
      "stale",
      "deleting",
      "deleted",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it("enforces uniqueness, composite FKs, and RESTRICT on thread/account delete", () => {
    expect(migration).toMatch(/unique \(user_id, thread_id\)/i);
    expect(migration).toMatch(/unique \(onyx_document_id\)/i);
    expect(migration).toMatch(
      /foreign key \(user_id, mail_account_id\)\s+references public\.mail_accounts/i,
    );
    expect(migration).toMatch(
      /foreign key \(user_id, thread_id\)\s+references public\.threads/i,
    );
    expect(migration).toMatch(/on delete restrict/i);
  });

  it("creates worker indexes", () => {
    expect(migration).toMatch(/onyx_index_state_user_status_idx/i);
    expect(migration).toMatch(/onyx_index_state_account_status_idx/i);
    expect(migration).toMatch(/onyx_index_state_status_attempt_idx/i);
  });

  it("enables RLS and revokes client grants", () => {
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(
      /revoke all on table public\.onyx_index_state from public, anon, authenticated/i,
    );
    expect(migration).not.toMatch(
      /create policy[\s\S]*on public\.onyx_index_state[\s\S]*to authenticated/i,
    );
  });

  it("creates onyx_jobs queue with service_role-only wrappers", () => {
    expect(migration).toMatch(/pgmq\.create\('onyx_jobs'\)/i);
    expect(migration).toMatch(/public\.onyx_jobs_send/i);
    expect(migration).toMatch(/public\.onyx_jobs_read/i);
    expect(migration).toMatch(/public\.onyx_jobs_archive/i);
    expect(migration).toMatch(
      /grant execute on function public\.onyx_jobs_send\(jsonb\) to service_role/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.onyx_jobs_send\(jsonb\)\s+from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.onyx_jobs_read\(integer, integer\)\s+from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.onyx_jobs_archive\(bigint\)\s+from public, anon, authenticated/i,
    );
  });

  it("does not put email content fields in queue helpers", () => {
    expect(migration).not.toMatch(/onyx_jobs_send[\s\S]{0,400}plain_text/i);
    expect(migration).not.toMatch(/onyx_jobs_send[\s\S]{0,400}subject/i);
  });
});
