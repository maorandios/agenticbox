-- O5A.3: Request roles precision (response recipient, evidence JSON, semantic confidence)
-- Does not delete feed_items. Do not apply without explicit approval.

alter table public.feed_items
  add column if not exists response_recipient_name text,
  add column if not exists response_recipient_email text,
  add column if not exists relation_to_mailbox text,
  add column if not exists semantic_precision_confidence numeric(4,3),
  add column if not exists action_verb text,
  add column if not exists action_object text,
  add column if not exists action_purpose text,
  add column if not exists request_evidence_json jsonb,
  add column if not exists supporting_evidence_json jsonb,
  add column if not exists requester_display_name text,
  add column if not exists assignee_display_name text;

create index if not exists feed_items_relation_to_mailbox_idx
  on public.feed_items (user_id, relation_to_mailbox, status);
