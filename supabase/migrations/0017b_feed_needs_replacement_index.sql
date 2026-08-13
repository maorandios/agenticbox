-- O5A.3.1b: partial index using needs_replacement (after 0017 enum commit).
-- Safe to apply only after 0017 has been committed.

create index if not exists feed_items_needs_replacement_idx
  on public.feed_items (user_id, status)
  where status = 'needs_replacement';
