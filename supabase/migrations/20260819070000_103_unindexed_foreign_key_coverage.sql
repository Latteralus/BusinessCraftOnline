-- Supabase Advisor performance hardening, part 2: `unindexed_foreign_keys`.
--
-- Adds a covering index for every foreign key the Advisor flagged as having
-- no supporting index. All 16 are genuinely unindexed -- no existing index
-- on any of these tables has the FK column as a usable leftmost/prefix
-- column (verified against every CREATE INDEX in the migration history for
-- each table). Every one of these tables is either an economy/transaction
-- table that accumulates rows continuously (market_listings,
-- market_transactions, market_buy_orders, business_inventory,
-- market_storefront_performance_snapshots, chat_messages, mail_messages) or
-- a moderate-growth per-player/per-shipment table where the FK is used for
-- joins/filtering (characters, shipping_queue, travel_log) -- none are
-- tiny/static configuration tables, so none are skipped.
--
-- `CREATE INDEX IF NOT EXISTS` makes this migration safe to replay.

create index if not exists idx_business_inventory_city
  on public.business_inventory (city_id);

create index if not exists idx_characters_current_city
  on public.characters (current_city_id);

create index if not exists idx_chat_messages_player
  on public.chat_messages (player_id);

create index if not exists idx_mail_messages_sender_player
  on public.mail_messages (sender_player_id);

create index if not exists idx_market_buy_orders_purchaser_business
  on public.market_buy_orders (purchaser_business_id);

create index if not exists idx_market_listings_source_business
  on public.market_listings (source_business_id);

create index if not exists idx_market_listings_source_inventory
  on public.market_listings (source_inventory_id);

create index if not exists idx_market_listings_source_personal_inventory
  on public.market_listings (source_personal_inventory_id);

create index if not exists idx_market_snapshots_city
  on public.market_storefront_performance_snapshots (city_id);

create index if not exists idx_market_transactions_buyer_business
  on public.market_transactions (buyer_business_id);

create index if not exists idx_market_transactions_buyer_player
  on public.market_transactions (buyer_player_id);

create index if not exists idx_market_transactions_city
  on public.market_transactions (city_id);

create index if not exists idx_shipping_queue_from_city
  on public.shipping_queue (from_city_id);

create index if not exists idx_shipping_queue_to_city
  on public.shipping_queue (to_city_id);

create index if not exists idx_travel_log_from_city
  on public.travel_log (from_city_id);

create index if not exists idx_travel_log_to_city
  on public.travel_log (to_city_id);
