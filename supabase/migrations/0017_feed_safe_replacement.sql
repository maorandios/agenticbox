-- O5A.3.1: Safe replacement lifecycle (ownership-hardened)
-- Do not apply without explicit approval.
-- Note: enum ADD VALUE is committed separately from any use of the new label
-- in CHECK/ partial indexes that reference 'needs_replacement' as a literal
-- in the same transaction on some Postgres versions. This file only ADDS the
-- value and does not filter rows by it in a CHECK; the partial index filters
-- by status after the value exists (same migration is OK on PG14+ when
-- ADD VALUE is not run inside an explicit multi-statement abort window).
-- If apply fails on enum use, split the partial index to a follow-up migration.

-- 1) New status for wrong cards awaiting a validated replacement.
alter type public.feed_item_status add value if not exists 'needs_replacement';

-- 2) Reverse pointer: old item → replacement id (set only after successful insert).
alter table public.feed_items
  add column if not exists superseded_by_feed_item_id uuid;

-- 3) Same-tenant composite FK (unique (user_id, id) already exists from 0012).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feed_items_superseded_by_feed_item_id_fkey'
  ) then
    alter table public.feed_items
      add constraint feed_items_superseded_by_feed_item_id_fkey
      foreign key (user_id, superseded_by_feed_item_id)
      references public.feed_items (user_id, id)
      on delete set null;
  end if;
end $$;

-- 4) Never point at self.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feed_items_superseded_by_not_self'
  ) then
    alter table public.feed_items
      add constraint feed_items_superseded_by_not_self
      check (
        superseded_by_feed_item_id is null
        or superseded_by_feed_item_id <> id
      );
  end if;
end $$;

-- 5) Lookup index for reverse pointer (no DELETE of existing rows).
create index if not exists feed_items_superseded_by_idx
  on public.feed_items (user_id, superseded_by_feed_item_id)
  where superseded_by_feed_item_id is not null;

-- Partial index on needs_replacement lives in 0017b (enum label visibility).
