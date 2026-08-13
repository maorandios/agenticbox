-- O5A.5: Feed alert type + alert metadata columns
-- Apply manually after human review. Do not auto-apply via CLI.

alter type public.feed_item_type add value if not exists 'alert';

alter table public.feed_items
  add column if not exists alert_category text
    check (
      alert_category is null
      or alert_category in (
        'legal',
        'security',
        'payment',
        'service',
        'operational',
        'suspicious_sender'
      )
    ),
  add column if not exists alert_verification_state text
    check (
      alert_verification_state is null
      or alert_verification_state in (
        'unverified',
        'verified',
        'not_required'
      )
    ),
  add column if not exists communication_nature text,
  add column if not exists action_state text
    check (
      action_state is null
      or action_state in (
        'requested',
        'committed',
        'completed',
        'already_sent',
        'informational',
        'uncertain'
      )
    );

comment on column public.feed_items.alert_category is
  'O5A.5 alert category when type=alert';
comment on column public.feed_items.alert_verification_state is
  'O5A.5 verification state for sensitive alerts';
