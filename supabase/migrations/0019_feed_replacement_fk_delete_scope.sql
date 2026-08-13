-- O5A.3.2: Fix composite self-FK ON DELETE scope (PostgreSQL 15+ required)
--
-- Bug: without a column list, ON DELETE SET NULL nulls ALL FK columns,
-- including user_id — which is incorrect for composite ownership FKs.
--
-- Prerequisite (run read-only first in SQL Editor):
--   select current_setting('server_version') as server_version;
-- Apply this migration only when PostgreSQL is 15+.
-- If older than 15: do NOT apply; fallback would be ON DELETE RESTRICT
-- (no triggers in this phase).

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception
      'migration 0019 requires PostgreSQL 15+ for column-specific ON DELETE SET NULL (got %)',
      current_setting('server_version');
  end if;
end $$;

-- 1) superseded_by → replacement (0017)
alter table public.feed_items
  drop constraint if exists feed_items_superseded_by_feed_item_id_fkey;

alter table public.feed_items
  add constraint feed_items_superseded_by_feed_item_id_fkey
  foreign key (user_id, superseded_by_feed_item_id)
  references public.feed_items (user_id, id)
  on delete set null (superseded_by_feed_item_id);

-- 2) supersedes → prior item (0012; still written by persist.ts)
alter table public.feed_items
  drop constraint if exists feed_items_user_id_supersedes_feed_item_id_fkey;

alter table public.feed_items
  add constraint feed_items_user_id_supersedes_feed_item_id_fkey
  foreign key (user_id, supersedes_feed_item_id)
  references public.feed_items (user_id, id)
  on delete set null (supersedes_feed_item_id);

-- 3) Lookup index for active supersedes pointer (column still in use).
-- superseded_by index already exists from 0017 — do not duplicate.
create index if not exists feed_items_supersedes_idx
  on public.feed_items (user_id, supersedes_feed_item_id)
  where supersedes_feed_item_id is not null;

-- Intentionally unchanged: user_id, statuses, rows, RLS, not-self CHECK,
-- unique (user_id, id), FKs to mail_accounts / threads.
