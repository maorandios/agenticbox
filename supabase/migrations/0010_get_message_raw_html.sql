-- Phase 2C: allow service_role to re-sanitize from private raw for display
-- (returns HTML text only to server; never exposed to authenticated clients directly).

create or replace function private.get_message_raw_html(
  p_user_id uuid,
  p_message_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_html text;
begin
  if p_user_id is null or p_message_id is null then
    raise exception 'user_id and message_id required';
  end if;

  select s.raw_html
    into v_html
  from private.message_raw_sources s
  where s.user_id = p_user_id
    and s.message_id = p_message_id;

  return v_html;
end;
$$;

revoke all on function private.get_message_raw_html(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.get_message_raw_html(uuid, uuid) to service_role;

create or replace function public.get_message_raw_html(
  p_user_id uuid,
  p_message_id uuid
)
returns text
language sql
security definer
set search_path = pg_catalog, private
as $$
  select private.get_message_raw_html(p_user_id, p_message_id);
$$;

revoke all on function public.get_message_raw_html(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_message_raw_html(uuid, uuid) to service_role;
