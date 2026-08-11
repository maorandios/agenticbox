-- Phase 1: SECURITY DEFINER RPCs for private schema + pgmq.
-- search_path fixed; EXECUTE only for service_role; no dynamic SQL from user input.

create or replace function private.normalize_webhook_type(p_event_type text)
returns table (
  event_type_base text,
  suffix_flags jsonb
)
language plpgsql
immutable
set search_path = pg_catalog, private
as $$
declare
  v_base text := lower(coalesce(p_event_type, ''));
  v_flags jsonb := '{}'::jsonb;
  v_changed boolean := true;
begin
  while v_changed loop
    v_changed := false;
    if right(v_base, 12) = '.transformed' then
      v_flags := v_flags || '{"transformed": true}'::jsonb;
      v_base := left(v_base, length(v_base) - 12);
      v_changed := true;
    elsif right(v_base, 10) = '.truncated' then
      v_flags := v_flags || '{"truncated": true}'::jsonb;
      v_base := left(v_base, length(v_base) - 10);
      v_changed := true;
    elsif right(v_base, 8) = '.cleaned' then
      v_flags := v_flags || '{"cleaned": true}'::jsonb;
      v_base := left(v_base, length(v_base) - 8);
      v_changed := true;
    elsif right(v_base, 9) = '.metadata' then
      v_flags := v_flags || '{"metadata": true}'::jsonb;
      v_base := left(v_base, length(v_base) - 9);
      v_changed := true;
    end if;
  end loop;

  event_type_base := v_base;
  suffix_flags := v_flags;
  return next;
end;
$$;

revoke all on function private.normalize_webhook_type(text) from public, anon, authenticated;
grant execute on function private.normalize_webhook_type(text) to service_role;

-- Atomic webhook ingest: idempotency + ledger + private payload + pgmq.send
create or replace function private.ingest_nylas_webhook(
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
set search_path = pg_catalog, public, private, pgmq, extensions
as $$
declare
  v_existing_id uuid;
  v_payload_id uuid;
  v_event_id uuid;
  v_base text;
  v_flags jsonb;
  v_msg_id bigint;
begin
  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'provider_event_id required';
  end if;
  if p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception 'event_type required';
  end if;
  if p_payload is null then
    raise exception 'payload required';
  end if;

  select we.id into v_existing_id
  from public.webhook_events we
  where we.provider_event_id = p_provider_event_id;

  if v_existing_id is not null then
    webhook_event_id := v_existing_id;
    enqueued := false;
    duplicate := true;
    return next;
    return;
  end if;

  select n.event_type_base, n.suffix_flags
  into v_base, v_flags
  from private.normalize_webhook_type(p_event_type) as n;

  insert into private.webhook_payloads (provider_event_id, payload)
  values (p_provider_event_id, p_payload)
  returning id into v_payload_id;

  insert into public.webhook_events (
    provider_event_id,
    event_type,
    event_type_base,
    suffix_flags,
    processing_status,
    payload_hash,
    private_payload_id
  )
  values (
    p_provider_event_id,
    p_event_type,
    v_base,
    v_flags,
    'pending',
    p_payload_hash,
    v_payload_id
  )
  returning id into v_event_id;

  -- grant id stays inside private payload / job message for service workers only
  select pgmq.send(
    'mail_jobs',
    jsonb_build_object(
      'jobType', 'process_webhook',
      'webhookEventId', v_event_id,
      'providerEventId', p_provider_event_id,
      'eventTypeBase', v_base,
      'grantId', p_grant_id
    )
  ) into v_msg_id;

  if v_msg_id is null then
    raise exception 'pgmq.send failed';
  end if;

  webhook_event_id := v_event_id;
  enqueued := true;
  duplicate := false;
  return next;
end;
$$;

revoke all on function private.ingest_nylas_webhook(text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function private.ingest_nylas_webhook(text, text, text, jsonb, text)
  to service_role;

-- Queue helpers (service_role only)
create or replace function private.mail_jobs_read(
  p_vt integer default 60,
  p_qty integer default 5
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = pg_catalog, pgmq, private
as $$
begin
  if p_vt is null or p_vt < 1 or p_vt > 3600 then
    raise exception 'invalid vt';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 50 then
    raise exception 'invalid qty';
  end if;
  return query select * from pgmq.read('mail_jobs', p_vt, p_qty);
end;
$$;

revoke all on function private.mail_jobs_read(integer, integer) from public, anon, authenticated;
grant execute on function private.mail_jobs_read(integer, integer) to service_role;

create or replace function private.mail_jobs_archive(p_msg_id bigint)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pgmq, private
as $$
begin
  if p_msg_id is null then
    raise exception 'msg_id required';
  end if;
  return pgmq.archive('mail_jobs', p_msg_id);
end;
$$;

revoke all on function private.mail_jobs_archive(bigint) from public, anon, authenticated;
grant execute on function private.mail_jobs_archive(bigint) to service_role;

create or replace function private.mail_jobs_send(p_message jsonb)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pgmq, private
as $$
declare
  v_id bigint;
begin
  if p_message is null then
    raise exception 'message required';
  end if;
  select pgmq.send('mail_jobs', p_message) into v_id;
  return v_id;
end;
$$;

revoke all on function private.mail_jobs_send(jsonb) from public, anon, authenticated;
grant execute on function private.mail_jobs_send(jsonb) to service_role;

-- Credential helpers
create or replace function private.upsert_mail_account_grant(
  p_mail_account_id uuid,
  p_user_id uuid,
  p_nylas_grant_id text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_mail_account_id is null or p_user_id is null or p_nylas_grant_id is null then
    raise exception 'mail_account_id, user_id, nylas_grant_id required';
  end if;

  insert into private.mail_account_credentials (mail_account_id, user_id, nylas_grant_id)
  values (p_mail_account_id, p_user_id, p_nylas_grant_id)
  on conflict (mail_account_id) do update
    set nylas_grant_id = excluded.nylas_grant_id,
        user_id = excluded.user_id,
        updated_at = now();
end;
$$;

revoke all on function private.upsert_mail_account_grant(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.upsert_mail_account_grant(uuid, uuid, text)
  to service_role;

create or replace function private.get_mail_account_grant(p_mail_account_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_grant text;
begin
  if p_mail_account_id is null then
    raise exception 'mail_account_id required';
  end if;
  select c.nylas_grant_id into v_grant
  from private.mail_account_credentials c
  where c.mail_account_id = p_mail_account_id;
  return v_grant;
end;
$$;

revoke all on function private.get_mail_account_grant(uuid) from public, anon, authenticated;
grant execute on function private.get_mail_account_grant(uuid) to service_role;

-- OAuth state (nonce one-time + TTL)
create or replace function private.create_oauth_state(
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
declare
  v_id uuid;
begin
  if p_user_id is null or p_nonce is null or p_expires_at is null then
    raise exception 'user_id, nonce, expires_at required';
  end if;
  insert into private.oauth_states (nonce, user_id, expires_at, redirect_path)
  values (p_nonce, p_user_id, p_expires_at, p_redirect_path)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.create_oauth_state(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function private.create_oauth_state(uuid, text, timestamptz, text)
  to service_role;

create or replace function private.consume_oauth_state(
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
declare
  v_row private.oauth_states%rowtype;
begin
  if p_nonce is null or p_user_id is null then
    raise exception 'nonce and user_id required';
  end if;

  select * into v_row
  from private.oauth_states s
  where s.nonce = p_nonce
  for update;

  if not found then
    raise exception 'invalid oauth state';
  end if;
  if v_row.used_at is not null then
    raise exception 'oauth state already used';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'oauth state expired';
  end if;
  if v_row.user_id <> p_user_id then
    raise exception 'oauth state user mismatch';
  end if;

  update private.oauth_states
  set used_at = now()
  where id = v_row.id;

  state_id := v_row.id;
  redirect_path := v_row.redirect_path;
  return next;
end;
$$;

revoke all on function private.consume_oauth_state(text, uuid)
  from public, anon, authenticated;
grant execute on function private.consume_oauth_state(text, uuid)
  to service_role;

-- Raw source store (never lose source on later sanitize failure)
create or replace function private.upsert_message_raw_source(
  p_user_id uuid,
  p_mail_account_id uuid,
  p_message_id uuid,
  p_raw_html text,
  p_source_encoding text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_mail_account_id is null or p_message_id is null then
    raise exception 'user_id, mail_account_id, message_id required';
  end if;

  insert into private.message_raw_sources (
    user_id, mail_account_id, message_id, raw_html, source_encoding
  )
  values (
    p_user_id, p_mail_account_id, p_message_id, p_raw_html, p_source_encoding
  )
  on conflict (message_id) do update
    set raw_html = excluded.raw_html,
        source_encoding = excluded.source_encoding,
        captured_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.upsert_message_raw_source(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.upsert_message_raw_source(uuid, uuid, uuid, text, text)
  to service_role;
