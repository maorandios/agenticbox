-- O5A.2: Request attribution & due evidence columns
-- Does not delete feed_items.

alter table public.feed_items
  add column if not exists requested_action text,
  add column if not exists requester_name text,
  add column if not exists requester_email text,
  add column if not exists assignee_name text,
  add column if not exists assignee_email text,
  add column if not exists beneficiary_name text,
  add column if not exists beneficiary_email text,
  add column if not exists responsibility_scope text,
  add column if not exists request_modality text,
  add column if not exists attribution_confidence numeric(4,3),
  add column if not exists requested_at timestamptz,
  add column if not exists due_evidence_text text,
  add column if not exists due_source_message_id uuid;

create index if not exists feed_items_responsibility_scope_idx
  on public.feed_items (user_id, responsibility_scope, status);
