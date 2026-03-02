-- Phase 8: production domain
-- Creates extraction_slots table owned by production.

create table if not exists public.extraction_slots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  slot_number integer not null check (slot_number > 0),
  employee_id uuid null references public.employees(id) on delete set null,
  status text not null default 'idle' check (status in ('active', 'idle', 'resting', 'tool_broken')),
  tool_item_key text null check (tool_item_key is null or char_length(trim(tool_item_key)) between 1 and 64),
  last_extracted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slot_number)
);

create index if not exists idx_extraction_slots_business
  on public.extraction_slots(business_id);

create index if not exists idx_extraction_slots_employee
  on public.extraction_slots(employee_id);

create index if not exists idx_extraction_slots_status
  on public.extraction_slots(status);

alter table public.extraction_slots enable row level security;

create policy "extraction_slots_select_own"
  on public.extraction_slots
  for select
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "extraction_slots_insert_own"
  on public.extraction_slots
  for insert
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "extraction_slots_update_own"
  on public.extraction_slots
  for update
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "extraction_slots_delete_own"
  on public.extraction_slots
  for delete
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

-- Migration complete: create extraction_slots with ownership RLS and indexes

