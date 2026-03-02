-- Phase 8: production domain
-- Creates tool_durability table owned by production.

create table if not exists public.tool_durability (
  id uuid primary key default gen_random_uuid(),
  extraction_slot_id uuid not null references public.extraction_slots(id) on delete cascade,
  item_type text not null check (item_type in ('pickaxe', 'axe', 'drill_bit')),
  uses_remaining integer not null check (uses_remaining >= 0),
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extraction_slot_id)
);

create index if not exists idx_tool_durability_slot
  on public.tool_durability(extraction_slot_id);

create index if not exists idx_tool_durability_item_type
  on public.tool_durability(item_type);

alter table public.tool_durability enable row level security;

create policy "tool_durability_select_own"
  on public.tool_durability
  for select
  using (
    exists (
      select 1
      from public.extraction_slots es
      join public.businesses b on b.id = es.business_id
      where es.id = extraction_slot_id
        and b.player_id = auth.uid()
    )
  );

create policy "tool_durability_insert_own"
  on public.tool_durability
  for insert
  with check (
    exists (
      select 1
      from public.extraction_slots es
      join public.businesses b on b.id = es.business_id
      where es.id = extraction_slot_id
        and b.player_id = auth.uid()
    )
  );

create policy "tool_durability_update_own"
  on public.tool_durability
  for update
  using (
    exists (
      select 1
      from public.extraction_slots es
      join public.businesses b on b.id = es.business_id
      where es.id = extraction_slot_id
        and b.player_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.extraction_slots es
      join public.businesses b on b.id = es.business_id
      where es.id = extraction_slot_id
        and b.player_id = auth.uid()
    )
  );

create policy "tool_durability_delete_own"
  on public.tool_durability
  for delete
  using (
    exists (
      select 1
      from public.extraction_slots es
      join public.businesses b on b.id = es.business_id
      where es.id = extraction_slot_id
        and b.player_id = auth.uid()
    )
  );

-- Migration complete: create tool_durability with ownership RLS and indexes

