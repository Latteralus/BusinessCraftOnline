-- Phase 9: manufacturing
-- Creates manufacturing_jobs table owned by production.

create table if not exists public.manufacturing_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  active_recipe_key text null check (active_recipe_key is null or char_length(trim(active_recipe_key)) between 1 and 64),
  status text not null default 'idle' check (status in ('active', 'idle')),
  worker_assigned boolean not null default false,
  last_tick_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id)
);

create index if not exists idx_manufacturing_jobs_business
  on public.manufacturing_jobs(business_id);

create index if not exists idx_manufacturing_jobs_status
  on public.manufacturing_jobs(status);

alter table public.manufacturing_jobs enable row level security;

create policy "manufacturing_jobs_select_own"
  on public.manufacturing_jobs
  for select
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "manufacturing_jobs_insert_own"
  on public.manufacturing_jobs
  for insert
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "manufacturing_jobs_update_own"
  on public.manufacturing_jobs
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

create policy "manufacturing_jobs_delete_own"
  on public.manufacturing_jobs
  for delete
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

-- Migration complete: create manufacturing_jobs table with ownership RLS and indexes

