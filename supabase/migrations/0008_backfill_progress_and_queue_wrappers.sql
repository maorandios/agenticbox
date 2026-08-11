-- Phase 2B: backfill progress counters + public wrappers for queue/raw RPCs

alter table public.mail_accounts
  add column if not exists message_count_synced integer not null default 0;

alter table public.mail_accounts
  add column if not exists sync_started_at timestamptz;

alter table public.mail_accounts
  add column if not exists sync_finished_at timestamptz;

alter table public.mail_accounts
  add column if not exists sync_rate_limit_hits integer not null default 0;

alter table public.mail_accounts
  add column if not exists sync_retry_count integer not null default 0;

create or replace function public.mail_jobs_send(p_message jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.mail_jobs_send(p_message);
end;
$$;

revoke all on function public.mail_jobs_send(jsonb) from public, anon, authenticated;
grant execute on function public.mail_jobs_send(jsonb) to service_role;

create or replace function public.mail_jobs_read(
  p_vt integer default 60,
  p_qty integer default 5
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = pg_catalog, private, pgmq
as $$
begin
  return query select * from private.mail_jobs_read(p_vt, p_qty);
end;
$$;

revoke all on function public.mail_jobs_read(integer, integer) from public, anon, authenticated;
grant execute on function public.mail_jobs_read(integer, integer) to service_role;

create or replace function public.mail_jobs_archive(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.mail_jobs_archive(p_msg_id);
end;
$$;

revoke all on function public.mail_jobs_archive(bigint) from public, anon, authenticated;
grant execute on function public.mail_jobs_archive(bigint) to service_role;

create or replace function public.upsert_message_raw_source(
  p_user_id uuid,
  p_mail_account_id uuid,
  p_message_id uuid,
  p_raw_html text,
  p_source_encoding text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.upsert_message_raw_source(
    p_user_id,
    p_mail_account_id,
    p_message_id,
    p_raw_html,
    p_source_encoding
  );
end;
$$;

revoke all on function public.upsert_message_raw_source(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_message_raw_source(uuid, uuid, uuid, text, text)
  to service_role;
