import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0012_feed_intelligence.sql"),
  "utf8",
);

describe("0012 feed intelligence migration contract", () => {
  it("creates feed tables with service_role-only access", () => {
    expect(migration).toMatch(/create table public\.thread_intelligence_state/i);
    expect(migration).toMatch(/create table public\.feed_items/i);
    expect(migration).toMatch(/create table public\.feed_extraction_runs/i);
    expect(migration).toMatch(/unique \(dedupe_key\)/i);
    expect(migration).toMatch(
      /revoke all on table public\.feed_items from public, anon, authenticated/i,
    );
    expect(migration).toMatch(/grant all on table public\.feed_items to service_role/i);
  });

  it("creates dedicated feed_jobs queue wrappers", () => {
    expect(migration).toMatch(/pgmq\.create\('feed_jobs'\)/i);
    expect(migration).toMatch(/public\.feed_jobs_send/i);
    expect(migration).toMatch(/public\.feed_jobs_read/i);
    expect(migration).toMatch(/public\.feed_jobs_archive/i);
    expect(migration).not.toMatch(/pgmq\.create\('mail_jobs'\)/);
    expect(migration).not.toMatch(/pgmq\.create\('onyx_jobs'\)/);
    expect(migration).not.toMatch(/public\.mail_jobs_/);
    expect(migration).not.toMatch(/public\.onyx_jobs_/);
  });

  it("does not store email content in job wrappers", () => {
    expect(migration).not.toMatch(/feed_jobs_send[\s\S]{0,400}plain_text/i);
    expect(migration).not.toMatch(/feed_jobs_send[\s\S]{0,400}subject/i);
  });

  it("blocks parallel processing per thread", () => {
    expect(migration).toMatch(
      /feed_extraction_runs_active_thread_uidx[\s\S]*where status = 'processing'/i,
    );
  });
});

describe("Feed extractor has no Onyx Chat import", () => {
  it("does not import onyx chat/adapter ask in feed modules", () => {
    const files = [
      "src/server/feed/extract.ts",
      "src/server/feed/process.ts",
      "src/server/feed/worker.ts",
      "src/server/feed/enqueue.ts",
      "src/server/feed/context.ts",
      "src/server/feed/persist.ts",
      "src/server/feed/eligibility.ts",
      "src/server/feed/model-access.ts",
    ];
    for (const file of files) {
      const text = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(text).not.toMatch(/@\/server\/onyx\/chat/);
      expect(text).not.toMatch(/send-chat-message/);
      expect(text).not.toMatch(/from \"@\/server\/onyx\/adapter\"/);
    }
  });
});

describe("0013 feed quality calibration migration contract", () => {
  const migration13 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0013_feed_quality_calibration.sql",
    ),
    "utf8",
  );

  it("adds versioning and supersede reason without deletes", () => {
    expect(migration13).toMatch(/extraction_version/i);
    expect(migration13).toMatch(/status_reason/i);
    expect(migration13).toMatch(/actual_model/i);
    expect(migration13).toMatch(/prefilter_skipped/i);
    expect(migration13).toMatch(/alter column thread_id drop not null/i);
    expect(migration13).not.toMatch(/delete from public\.feed_items/i);
  });
});

describe("0014 feed request attribution migration contract", () => {
  const migration14 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0014_feed_request_attribution.sql",
    ),
    "utf8",
  );

  it("adds attribution columns without deletes", () => {
    expect(migration14).toMatch(/responsibility_scope/i);
    expect(migration14).toMatch(/due_evidence_text/i);
    expect(migration14).toMatch(/requester_email/i);
    expect(migration14).not.toMatch(/delete from public\.feed_items/i);
  });
});

describe("0015 feed request direction migration contract", () => {
  const migration15 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0015_feed_request_direction.sql",
    ),
    "utf8",
  );

  it("adds request_direction without deletes", () => {
    expect(migration15).toMatch(/request_direction/i);
    expect(migration15).not.toMatch(/delete from public\.feed_items/i);
  });
});

describe("0016 feed request roles migration contract", () => {
  const migration16 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0016_feed_request_roles.sql",
    ),
    "utf8",
  );

  it("adds role precision columns without deletes", () => {
    expect(migration16).toMatch(/response_recipient_email/i);
    expect(migration16).toMatch(/relation_to_mailbox/i);
    expect(migration16).toMatch(/semantic_precision_confidence/i);
    expect(migration16).toMatch(/request_evidence_json/i);
    expect(migration16).not.toMatch(/delete from public\.feed_items/i);
  });
});

describe("0017 feed safe replacement migration contract", () => {
  const migration17 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0017_feed_safe_replacement.sql",
    ),
    "utf8",
  );
  const migration17b = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0017b_feed_needs_replacement_index.sql",
    ),
    "utf8",
  );

  it("adds needs_replacement, superseded_by, ownership FK, not-self check", () => {
    expect(migration17).toMatch(/needs_replacement/);
    expect(migration17).toMatch(/superseded_by_feed_item_id/);
    expect(migration17).toMatch(
      /foreign key \(user_id, superseded_by_feed_item_id\)/i,
    );
    expect(migration17).toMatch(/references public\.feed_items \(user_id, id\)/i);
    expect(migration17).toMatch(/on delete set null/i);
    expect(migration17).toMatch(/superseded_by_feed_item_id <> id/i);
    expect(migration17).not.toMatch(/delete from public\.feed_items/i);
    expect(migration17b).toMatch(/needs_replacement/);
  });
});

describe("0019 feed replacement FK delete scope migration contract", () => {
  const migration19 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0019_feed_replacement_fk_delete_scope.sql",
    ),
    "utf8",
  );

  it("uses column-specific ON DELETE SET NULL for both composite FKs", () => {
    expect(migration19).toMatch(
      /on delete set null \(superseded_by_feed_item_id\)/i,
    );
    expect(migration19).toMatch(
      /on delete set null \(supersedes_feed_item_id\)/i,
    );
    // Reject bare ON DELETE SET NULL without a column list.
    expect(migration19).not.toMatch(/on delete set null\s*;/i);
    expect(migration19).toMatch(/server_version_num[\s\S]*150000/i);
    expect(migration19).toMatch(/feed_items_supersedes_idx/);
    expect(migration19).not.toMatch(/delete from public\.feed_items/i);
  });
});

describe("0020 feed alert type migration contract", () => {
  const migration20 = readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/0020_feed_alert_type.sql",
    ),
    "utf8",
  );

  it("adds alert enum value and alert metadata columns without deletes", () => {
    expect(migration20).toMatch(/feed_item_type[\s\S]*add value[\s\S]*'alert'/i);
    expect(migration20).toMatch(/alert_category/);
    expect(migration20).toMatch(/alert_verification_state/);
    expect(migration20).toMatch(/communication_nature/);
    expect(migration20).toMatch(/action_state/);
    expect(migration20).not.toMatch(/delete from public\.feed_items/i);
  });
});
