-- Phase 1: private tables — grant id, oauth state, raw sources, webhook payloads.
-- Not exposed via Data API. Access only through SECURITY DEFINER RPCs (service_role).

create table private.mail_account_credentials (
  mail_account_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  nylas_grant_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nylas_grant_id),
  unique (user_id, mail_account_id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete cascade
);

create table private.oauth_states (
  id uuid primary key default gen_random_uuid(),
  nonce text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  redirect_path text,
  created_at timestamptz not null default now()
);

create index oauth_states_user_idx on private.oauth_states (user_id, expires_at);

create table private.message_raw_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mail_account_id uuid not null,
  message_id uuid not null,
  raw_html text,
  source_encoding text,
  captured_at timestamptz not null default now(),
  unique (message_id),
  foreign key (user_id, mail_account_id)
    references public.mail_accounts (user_id, id)
    on delete cascade,
  foreign key (user_id, message_id)
    references public.messages (user_id, id)
    on delete cascade
);

create table private.webhook_payloads (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- Link ledger → private payload (optional FK; set after both exist)
alter table public.webhook_events
  add constraint webhook_events_private_payload_fk
  foreign key (private_payload_id)
  references private.webhook_payloads (id)
  on delete set null;

revoke all on table private.mail_account_credentials from public, anon, authenticated;
revoke all on table private.oauth_states from public, anon, authenticated;
revoke all on table private.message_raw_sources from public, anon, authenticated;
revoke all on table private.webhook_payloads from public, anon, authenticated;

grant all on table private.mail_account_credentials to service_role;
grant all on table private.oauth_states to service_role;
grant all on table private.message_raw_sources to service_role;
grant all on table private.webhook_payloads to service_role;

alter table private.mail_account_credentials enable row level security;
alter table private.oauth_states enable row level security;
alter table private.message_raw_sources enable row level security;
alter table private.webhook_payloads enable row level security;
