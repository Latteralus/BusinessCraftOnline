create table if not exists public.store_shelf_items (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_key text not null,
  quality integer not null check (quality >= 1 and quality <= 100),
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (business_id, item_key, quality)
);

create index if not exists idx_store_shelf_items_owner_business
  on public.store_shelf_items(owner_player_id, business_id);

create index if not exists idx_store_shelf_items_business
  on public.store_shelf_items(business_id);

alter table public.store_shelf_items enable row level security;

create policy "store_shelf_items_select_own"
  on public.store_shelf_items
  for select
  using (auth.uid() = owner_player_id);

create policy "store_shelf_items_insert_own"
  on public.store_shelf_items
  for insert
  with check (
    auth.uid() = owner_player_id
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
        and b.type in ('general_store', 'specialty_store')
    )
  );

create policy "store_shelf_items_update_own"
  on public.store_shelf_items
  for update
  using (auth.uid() = owner_player_id)
  with check (
    auth.uid() = owner_player_id
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
        and b.type in ('general_store', 'specialty_store')
    )
  );

create policy "store_shelf_items_delete_own"
  on public.store_shelf_items
  for delete
  using (auth.uid() = owner_player_id);
