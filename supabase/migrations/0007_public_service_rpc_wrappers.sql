-- Phase 2A: public SECURITY DEFINER wrappers for service_role RPC access.
-- PostgREST/supabase-js invoke public schema; bodies delegate to private.*.
-- EXECUTE revoked from PUBLIC/anon/authenticated.

create or replace function public.create_oauth_state(
  p_user_id uuid,
  p_nonce text,
  p_expires_at timestamptz,
  p_redirect_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.create_oauth_state(p_user_id, p_nonce, p_expires_at, p_redirect_path);
end;
$$;

revoke all on function public.create_oauth_state(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_oauth_state(uuid, text, timestamptz, text)
  to service_role;

create or replace function public.consume_oauth_state(
  p_nonce text,
  p_user_id uuid
)
returns table (
  state_id uuid,
  redirect_path text
)
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return query select * from private.consume_oauth_state(p_nonce, p_user_id);
end;
$$;

revoke all on function public.consume_oauth_state(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_oauth_state(text, uuid)
  to service_role;

create or replace function public.upsert_mail_account_grant(
  p_mail_account_id uuid,
  p_user_id uuid,
  p_nylas_grant_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  perform private.upsert_mail_account_grant(
    p_mail_account_id, p_user_id, p_nylas_grant_id
  );
end;
$$;

revoke all on function public.upsert_mail_account_grant(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.upsert_mail_account_grant(uuid, uuid, text)
  to service_role;

create or replace function public.get_mail_account_grant(p_mail_account_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return private.get_mail_account_grant(p_mail_account_id);
end;
$$;

revoke all on function public.get_mail_account_grant(uuid)
  from public, anon, authenticated;
grant execute on function public.get_mail_account_grant(uuid)
  to service_role;

create or replace function public.find_mail_account_by_grant(p_nylas_grant_id text)
returns table (
  mail_account_id uuid,
  user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return query select * from private.find_mail_account_by_grant(p_nylas_grant_id);
end;
$$;

revoke all on function public.find_mail_account_by_grant(text)
  from public, anon, authenticated;
grant execute on function public.find_mail_account_by_grant(text)
  to service_role;

create or replace function public.delete_mail_account_grant(p_mail_account_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  perform private.delete_mail_account_grant(p_mail_account_id);
end;
$$;

revoke all on function public.delete_mail_account_grant(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_mail_account_grant(uuid)
  to service_role;

create or replace function public.ingest_nylas_webhook(
  p_provider_event_id text,
  p_event_type text,
  p_grant_id text,
  p_payload jsonb,
  p_payload_hash text default null
)
returns table (
  webhook_event_id uuid,
  enqueued boolean,
  duplicate boolean
)
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  return query
  select *
  from private.ingest_nylas_webhook(
    p_provider_event_id,
    p_event_type,
    p_grant_id,
    p_payload,
    p_payload_hash
  );
end;
$$;

revoke all on function public.ingest_nylas_webhook(text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.ingest_nylas_webhook(text, text, text, jsonb, text)
  to service_role;
