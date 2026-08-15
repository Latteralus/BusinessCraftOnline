-- Phase 84: Buy orders for the open market.
-- Adds market_buy_orders, the demand-side counterpart to market_listings.
-- A buy order commits funds up front (escrowed via ledger entries in a later
-- migration) the same way a sell listing commits inventory up front via
-- reserved_quantity. See 086_market_buy_order_settlement_functions.sql for
-- the RPCs that place, sweep, fulfill, and cancel these orders.

create table public.market_buy_orders (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  purchaser_type text not null check (purchaser_type in ('business', 'personal')),
  purchaser_business_id uuid null references public.businesses(id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete restrict,
  item_key text not null check (char_length(trim(item_key)) between 1 and 64),
  quality_min integer not null check (quality_min between 1 and 100),
  quality_max integer not null check (quality_max between 1 and 100),
  quantity integer not null check (quantity >= 0),
  max_unit_price numeric(14, 2) not null check (max_unit_price > 0),
  status text not null check (status in ('active', 'filled', 'cancelled', 'expired')),
  expires_at timestamptz null,
  filled_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_buy_orders_quality_range check (quality_max >= quality_min),
  constraint market_buy_orders_purchaser_check check (
    (purchaser_type = 'business' and purchaser_business_id is not null)
    or
    (purchaser_type = 'personal' and purchaser_business_id is null)
  )
);

create index idx_market_buy_orders_owner_status_created
  on public.market_buy_orders(owner_player_id, status, created_at desc);

create index idx_market_buy_orders_city_item_price
  on public.market_buy_orders(city_id, item_key, max_unit_price desc)
  where status = 'active';

alter table public.market_buy_orders enable row level security;

create policy "market_buy_orders_select_active_or_own"
  on public.market_buy_orders
  for select
  using (status = 'active' or owner_player_id = auth.uid());

create policy "market_buy_orders_insert_own"
  on public.market_buy_orders
  for insert
  with check (
    owner_player_id = auth.uid()
    and (
      (
        purchaser_type = 'business'
        and exists (
          select 1
          from public.businesses b
          where b.id = purchaser_business_id
            and b.player_id = auth.uid()
        )
      )
      or purchaser_type = 'personal'
    )
  );

create policy "market_buy_orders_update_own"
  on public.market_buy_orders
  for update
  using (owner_player_id = auth.uid())
  with check (owner_player_id = auth.uid());

-- Migration complete: create market_buy_orders table with RLS and matching indexes
