-- Phase O3: Onyx index state + dedicated onyx_jobs queue
-- Index state maps Onyx document_id ↔ (user_id, mail_account_id, thread_id).
-- Thread FK uses ON DELETE RESTRICT so a thread cannot disappear before
-- onyx_document_id is used for an Onyx delete job (product has no thread-delete
-- flow yet; future: deleting → delete job → deleted → cleanup).

create type public.onyx_index_status as enum (
  'pending',
  'processing',
  'indexed',
  'failed',
  'stale',
  'deleting',
  'deleted'
);

create table public.onyx_index_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  thread_id uuid not null,
  onyx_document_id text not null,
  content_hash text,
  status public.onyx_index_status not null default 'pending',
  attempt_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  last_attempt_at timestamptz,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, thread_id),
  unique (onyx_document_id),
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete restrict,
  foreign key (user_id, thread_id)
    references public.threads (user_id, id)
    on delete restrict
);

create index onyx_index_state_user_status_idx
  on public.onyx_index_state (user_id, status);

create index onyx_index_state_account_status_idx
  on public.onyx_index_state (mail_account_id, status);

create index onyx_index_state_status_attempt_idx
  on public.onyx_index_state (status, last_attempt_at);

alter table public.onyx_index_state enable row level security;

revoke all on table public.onyx_index_state from public, anon, authenticated;
grant all on table public.onyx_index_state to service_role;

-- Dedicated queue (never mix with mail_jobs)
select pgmq.create('onyx_jobs');

create or replace function private.onyx_jobs_send(p_message jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
declare
  v_id bigint;
begin
  select pgmq.send('onyx_jobs', p_message) into v_id;
  return v_id;
end;
$$;

revoke all on function private.onyx_jobs_send(jsonb)
  from public, anon, authenticated;
grant execute on function private.onyx_jobs_send(jsonb) to service_role;

create or replace function private.onyx_jobs_read(
  p_vt integer default 120,
  p_qty integer default 5
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return query select * from pgmq.read('onyx_jobs', p_vt, p_qty);
end;
$$;

revoke all on function private.onyx_jobs_read(integer, integer)
  from public, anon, authenticated;
grant execute on function private.onyx_jobs_read(integer, integer) to service_role;

create or replace function private.onyx_jobs_archive(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return pgmq.archive('onyx_jobs', p_msg_id);
end;
$$;

revoke all on function private.onyx_jobs_archive(bigint)
  from public, anon, authenticated;
grant execute on function private.onyx_jobs_archive(bigint) to service_role;

-- Public wrappers for PostgREST / supabase-js (service_role only)
create or replace function public.onyx_jobs_send(p_message jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.onyx_jobs_send(p_message);
end;
$$;

revoke all on function public.onyx_jobs_send(jsonb)
  from public, anon, authenticated;
grant execute on function public.onyx_jobs_send(jsonb) to service_role;

create or replace function public.onyx_jobs_read(
  p_vt integer default 120,
  p_qty integer default 5
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return query select * from private.onyx_jobs_read(p_vt, p_qty);
end;
$$;

revoke all on function public.onyx_jobs_read(integer, integer)
  from public, anon, authenticated;
grant execute on function public.onyx_jobs_read(integer, integer) to service_role;

create or replace function public.onyx_jobs_archive(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.onyx_jobs_archive(p_msg_id);
end;
$$;

revoke all on function public.onyx_jobs_archive(bigint)
  from public, anon, authenticated;
grant execute on function public.onyx_jobs_archive(bigint) to service_role;
