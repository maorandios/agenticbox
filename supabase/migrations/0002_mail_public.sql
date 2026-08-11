-- Phase 1: public mail tables (internal mail_account_id only; grant credentials stay private)
-- authenticated: no INSERT/UPDATE/DELETE; no direct table use from clients.
-- Application API reads/writes via service_role after session checks.

create type public.mail_provider as enum ('google', 'microsoft');
create type public.mail_sync_status as enum (
  'pending',
  'syncing',
  'ready',
  'error',
  'needs_reconnect',
  'disconnected'
);
create type public.message_direction as enum ('inbound', 'outbound');
create type public.participant_role as enum ('from', 'to', 'cc', 'bcc', 'reply_to');
create type public.extraction_status as enum (
  'pending',
  'sanitized_ok',
  'sanitize_failed',
  'clean_pending',
  'clean_ok',
  'clean_failed',
  'clean_skipped'
);
create type public.webhook_processing_status as enum (
  'pending',
  'processing',
  'done',
  'failed',
  'ignored'
);
create type public.sync_phase as enum ('backfill', 'idle', 'webhook');

create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.mail_provider not null,
  email text not null,
  aliases jsonb not null default '[]'::jsonb,
  sync_status public.mail_sync_status not null default 'pending',
  last_successful_sync_at timestamptz,
  backfill_cursor text,
  backfill_completed_at timestamptz,
  thread_count_synced integer not null default 0,
  error_code text,
  error_message_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email),
  unique (user_id, id)
);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  provider_thread_id text not null,
  subject text not null default '',
  snippet text not null default '',
  latest_message_at timestamptz,
  message_count integer not null default 0,
  unread boolean not null default false,
  starred boolean not null default false,
  folders text[] not null default '{}',
  participants_summary jsonb not null default '[]'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mail_account_id, provider_thread_id),
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete cascade
);

create index threads_user_latest_idx
  on public.threads (user_id, latest_message_at desc nulls last);
create index threads_account_latest_idx
  on public.threads (mail_account_id, latest_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  thread_id uuid not null,
  provider_message_id text not null,
  provider_thread_id text not null,
  subject text not null default '',
  snippet text not null default '',
  sanitized_html text,
  plain_text text,
  clean_conversation text,
  extraction_status public.extraction_status not null default 'pending',
  provider_date_at timestamptz,
  received_at timestamptz not null default now(),
  synced_at timestamptz,
  direction public.message_direction not null,
  in_reply_to text,
  references_header text,
  unread boolean not null default false,
  starred boolean not null default false,
  is_draft boolean not null default false,
  quoted_text text,
  signature_plain text,
  signature_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mail_account_id, provider_message_id),
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete cascade,
  foreign key (user_id, thread_id)
    references public.threads (user_id, id)
    on delete cascade
);

create index messages_thread_date_idx
  on public.messages (thread_id, provider_date_at asc nulls last);
create index messages_user_date_idx
  on public.messages (user_id, provider_date_at desc nulls last);

create table public.message_participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null,
  role public.participant_role not null,
  email text not null,
  name text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (message_id, role, email),
  foreign key (user_id, message_id)
    references public.messages (user_id, id)
    on delete cascade
);

create table public.attachments_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null,
  provider_attachment_id text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  is_inline boolean not null default false,
  content_id text,
  disposition text,
  created_at timestamptz not null default now(),
  unique (message_id, provider_attachment_id),
  foreign key (user_id, message_id)
    references public.messages (user_id, id)
    on delete cascade
);

create table public.sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  phase public.sync_phase not null default 'idle',
  checkpoint jsonb not null default '{}'::jsonb,
  status text not null default 'idle',
  last_error_safe text,
  updated_at timestamptz not null default now(),
  unique (mail_account_id),
  unique (user_id, id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete cascade
);

-- Ledger only: no raw payload. Points at private.webhook_payloads when present.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  event_type_base text not null,
  suffix_flags jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processing_status public.webhook_processing_status not null default 'pending',
  attempts integer not null default 0,
  last_error_safe text,
  processed_at timestamptz,
  payload_hash text,
  private_payload_id uuid,
  created_at timestamptz not null default now()
);

create index webhook_events_status_idx
  on public.webhook_events (processing_status, received_at);

-- Permissions: service_role only for mail tables. No authenticated writes/reads via Data API.
revoke all on table public.mail_accounts from public, anon, authenticated;
revoke all on table public.threads from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.message_participants from public, anon, authenticated;
revoke all on table public.attachments_metadata from public, anon, authenticated;
revoke all on table public.sync_state from public, anon, authenticated;
revoke all on table public.webhook_events from public, anon, authenticated;

grant all on table public.mail_accounts to service_role;
grant all on table public.threads to service_role;
grant all on table public.messages to service_role;
grant all on table public.message_participants to service_role;
grant all on table public.attachments_metadata to service_role;
grant all on table public.sync_state to service_role;
grant all on table public.webhook_events to service_role;

alter table public.mail_accounts enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.message_participants enable row level security;
alter table public.attachments_metadata enable row level security;
alter table public.sync_state enable row level security;
alter table public.webhook_events enable row level security;

-- No policies for anon/authenticated → Data API cannot read/write even if grants leak.
-- service_role bypasses RLS.
