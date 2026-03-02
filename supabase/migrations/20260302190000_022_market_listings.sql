-- Phase 12: market domain
-- Creates market listings and transaction history for player and NPC market purchases.

create table if not exists public.market_listings (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  source_business_id uuid not null references public.businesses(id) on delete cascade,
  source_inventory_id uuid null references public.business_inventory(id) on delete set null,
  city_id uuid not null references public.cities(id) on delete restrict,
  item_key text not null check (char_length(trim(item_key)) between 1 and 64),
  quality integer not null check (quality between 1 and 100),
  quantity integer not null check (quantity > 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0 and reserved_quantity <= quantity),
  unit_price numeric(14, 2) not null check (unit_price > 0),
  listing_type text not null default 'sell' check (listing_type in ('sell')),
  status text not null check (status in ('active', 'filled', 'cancelled', 'expired')),
  expires_at timestamptz null,
  filled_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_transactions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid null references public.market_listings(id) on delete set null,
  seller_player_id uuid not null references public.players(id) on delete cascade,
  buyer_player_id uuid null references public.players(id) on delete set null,
  buyer_type text not null check (buyer_type in ('player', 'npc')),
  seller_business_id uuid not null references public.businesses(id) on delete cascade,
  buyer_business_id uuid null references public.businesses(id) on delete set null,
  city_id uuid not null references public.cities(id) on delete restrict,
  item_key text not null check (char_length(trim(item_key)) between 1 and 64),
  quality integer not null check (quality between 1 and 100),
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price > 0),
  gross_total numeric(14, 2) not null check (gross_total >= 0),
  market_fee numeric(14, 2) not null check (market_fee >= 0),
  net_total numeric(14, 2) not null check (net_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_market_listings_owner_status_created
  on public.market_listings(owner_player_id, status, created_at desc);

create index if not exists idx_market_listings_city_item_price
  on public.market_listings(city_id, item_key, unit_price asc)
  where status = 'active';

create index if not exists idx_market_transactions_seller_created
  on public.market_transactions(seller_player_id, created_at desc);

create index if not exists idx_market_transactions_listing_created
  on public.market_transactions(listing_id, created_at desc)
  where listing_id is not null;

alter table public.market_listings enable row level security;
alter table public.market_transactions enable row level security;

create policy "market_listings_select_authenticated"
  on public.market_listings
  for select
  using (auth.uid() is not null and (status = 'active' or owner_player_id = auth.uid()));

create policy "market_listings_insert_own"
  on public.market_listings
  for insert
  with check (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = source_business_id
        and b.player_id = auth.uid()
    )
  );

create policy "market_listings_update_own"
  on public.market_listings
  for update
  using (owner_player_id = auth.uid())
  with check (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = source_business_id
        and b.player_id = auth.uid()
    )
  );

create policy "market_listings_delete_own"
  on public.market_listings
  for delete
  using (owner_player_id = auth.uid());

create policy "market_transactions_select_party"
  on public.market_transactions
  for select
  using (seller_player_id = auth.uid() or buyer_player_id = auth.uid());

create policy "market_transactions_insert_authenticated"
  on public.market_transactions
  for insert
  with check (auth.uid() is not null);

-- Migration complete: market listings + market transaction history with indexes and RLS
