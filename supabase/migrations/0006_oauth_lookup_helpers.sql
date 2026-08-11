-- Phase 2A: lookup helpers for OAuth idempotency (service_role only)

create or replace function private.find_mail_account_by_grant(p_nylas_grant_id text)
returns table (
  mail_account_id uuid,
  user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_nylas_grant_id is null or length(trim(p_nylas_grant_id)) = 0 then
    raise exception 'nylas_grant_id required';
  end if;

  return query
  select c.mail_account_id, c.user_id
  from private.mail_account_credentials c
  where c.nylas_grant_id = p_nylas_grant_id;
end;
$$;

revoke all on function private.find_mail_account_by_grant(text)
  from public, anon, authenticated;
grant execute on function private.find_mail_account_by_grant(text)
  to service_role;

create or replace function private.delete_mail_account_grant(p_mail_account_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_mail_account_id is null then
    raise exception 'mail_account_id required';
  end if;
  delete from private.mail_account_credentials
  where mail_account_id = p_mail_account_id;
end;
$$;

revoke all on function private.delete_mail_account_grant(uuid)
  from public, anon, authenticated;
grant execute on function private.delete_mail_account_grant(uuid)
  to service_role;
