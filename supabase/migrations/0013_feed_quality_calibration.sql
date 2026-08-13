-- O5A.1: Feed quality calibration metadata
-- Adds extraction_version + status_reason; does not delete feed_items.
-- thread_id nullable only for model-probe / batch-meta runs (no generation).

alter table public.feed_items
  add column if not exists extraction_version text,
  add column if not exists status_reason text,
  add column if not exists action_owner text,
  add column if not exists business_object text,
  add column if not exists business_relevance_confidence numeric(4,3);

create index if not exists feed_items_extraction_version_idx
  on public.feed_items (user_id, extraction_version);

alter table public.feed_extraction_runs
  alter column thread_id drop not null;

alter table public.feed_extraction_runs
  add column if not exists extraction_version text,
  add column if not exists eligibility_classification text,
  add column if not exists prefilter_skipped boolean not null default false,
  add column if not exists actual_model text;

create index if not exists feed_extraction_runs_version_idx
  on public.feed_extraction_runs (user_id, extraction_version, started_at desc);
