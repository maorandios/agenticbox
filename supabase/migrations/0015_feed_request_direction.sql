-- O5A.2: Request direction for sent-by-owner vs inbound vs external cards
-- Does not delete feed_items.

alter table public.feed_items
  add column if not exists request_direction text;

create index if not exists feed_items_request_direction_idx
  on public.feed_items (user_id, request_direction, status);
