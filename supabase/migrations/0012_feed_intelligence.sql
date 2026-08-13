-- Phase O5A: Feed Intelligence POC
-- Tables: thread_intelligence_state, feed_items, feed_extraction_runs
-- Queue: feed_jobs (pgmq) — never mix with mail or onyx queues

create type public.feed_item_type as enum (
  'action',
  'change',
  'decision',
  'due'
);

create type public.feed_item_status as enum (
  'new',
  'open',
  'scheduled',
  'handled',
  'irrelevant',
  'cancelled',
  'superseded'
);

create type public.feed_intelligence_status as enum (
  'idle',
  'processing',
  'ready',
  'failed',
  'needs_review'
);

create type public.feed_extraction_run_status as enum (
  'pending',
  'processing',
  'completed',
  'failed',
  'skipped'
);

create table public.thread_intelligence_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  thread_id uuid not null,
  source_content_hash text,
  state_json jsonb not null default '{"openActions":[],"decisions":[],"deadlines":[],"currentFacts":[],"resolvedItems":[]}'::jsonb,
  last_processed_message_id uuid,
  last_extracted_at timestamptz,
  status public.feed_intelligence_status not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, thread_id),
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete restrict,
  foreign key (user_id, thread_id)
    references public.threads (user_id, id)
    on delete restrict
);

create index thread_intelligence_state_user_status_idx
  on public.thread_intelligence_state (user_id, status);

create index thread_intelligence_state_account_idx
  on public.thread_intelligence_state (mail_account_id, status);

alter table public.thread_intelligence_state enable row level security;
revoke all on table public.thread_intelligence_state from public, anon, authenticated;
grant all on table public.thread_intelligence_state to service_role;

create table public.feed_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  thread_id uuid not null,
  source_message_id uuid,
  type public.feed_item_type not null,
  headline text not null,
  context text,
  actor_name text,
  actor_email text,
  evidence_text text not null,
  occurred_at timestamptz not null,
  due_at timestamptz,
  confidence numeric(4,3) not null,
  importance numeric(4,3) not null,
  topic_key text not null,
  dedupe_key text not null,
  status public.feed_item_status not null default 'new',
  supersedes_feed_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key),
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete restrict,
  foreign key (user_id, thread_id)
    references public.threads (user_id, id)
    on delete restrict,
  foreign key (user_id, supersedes_feed_item_id)
    references public.feed_items (user_id, id)
    on delete set null
);

create index feed_items_user_account_status_occurred_idx
  on public.feed_items (user_id, mail_account_id, status, occurred_at desc);

create index feed_items_user_type_idx
  on public.feed_items (user_id, type);

create index feed_items_thread_idx
  on public.feed_items (user_id, thread_id, created_at desc);

alter table public.feed_items enable row level security;
revoke all on table public.feed_items from public, anon, authenticated;
grant all on table public.feed_items to service_role;

create table public.feed_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  thread_id uuid not null,
  trigger_message_id uuid,
  source_content_hash text,
  status public.feed_extraction_run_status not null default 'pending',
  model text,
  openai_response_id text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  candidate_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  context_coverage text,
  latency_ms integer,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete restrict,
  foreign key (user_id, thread_id)
    references public.threads (user_id, id)
    on delete restrict
);

create index feed_extraction_runs_user_started_idx
  on public.feed_extraction_runs (user_id, started_at desc);

create index feed_extraction_runs_thread_hash_idx
  on public.feed_extraction_runs (user_id, thread_id, source_content_hash);

create unique index feed_extraction_runs_active_thread_uidx
  on public.feed_extraction_runs (user_id, thread_id)
  where status = 'processing';

alter table public.feed_extraction_runs enable row level security;
revoke all on table public.feed_extraction_runs from public, anon, authenticated;
grant all on table public.feed_extraction_runs to service_role;

-- Dedicated queue
select pgmq.create('feed_jobs');

create or replace function private.feed_jobs_send(p_message jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
declare
  v_id bigint;
begin
  select pgmq.send('feed_jobs', p_message) into v_id;
  return v_id;
end;
$$;

revoke all on function private.feed_jobs_send(jsonb)
  from public, anon, authenticated;
grant execute on function private.feed_jobs_send(jsonb) to service_role;

create or replace function private.feed_jobs_read(
  p_vt integer default 180,
  p_qty integer default 3
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return query select * from pgmq.read('feed_jobs', p_vt, p_qty);
end;
$$;

revoke all on function private.feed_jobs_read(integer, integer)
  from public, anon, authenticated;
grant execute on function private.feed_jobs_read(integer, integer) to service_role;

create or replace function private.feed_jobs_archive(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return pgmq.archive('feed_jobs', p_msg_id);
end;
$$;

revoke all on function private.feed_jobs_archive(bigint)
  from public, anon, authenticated;
grant execute on function private.feed_jobs_archive(bigint) to service_role;

create or replace function public.feed_jobs_send(p_message jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.feed_jobs_send(p_message);
end;
$$;

revoke all on function public.feed_jobs_send(jsonb)
  from public, anon, authenticated;
grant execute on function public.feed_jobs_send(jsonb) to service_role;

create or replace function public.feed_jobs_read(
  p_vt integer default 180,
  p_qty integer default 3
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return query select * from private.feed_jobs_read(p_vt, p_qty);
end;
$$;

revoke all on function public.feed_jobs_read(integer, integer)
  from public, anon, authenticated;
grant execute on function public.feed_jobs_read(integer, integer) to service_role;

create or replace function public.feed_jobs_archive(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.feed_jobs_archive(p_msg_id);
end;
$$;

revoke all on function public.feed_jobs_archive(bigint)
  from public, anon, authenticated;
grant execute on function public.feed_jobs_archive(bigint) to service_role;
