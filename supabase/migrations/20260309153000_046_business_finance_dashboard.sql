-- Phase 24: business finance dashboard primitives
-- Adds inventory cost-basis columns and a typed financial events table for statement reporting.

alter table public.business_inventory
  add column if not exists unit_cost numeric(14,2),
  add column if not exists total_cost numeric(14,2);

alter table public.business_inventory
  add constraint business_inventory_unit_cost_nonnegative
  check (unit_cost is null or unit_cost >= 0);

alter table public.business_inventory
  add constraint business_inventory_total_cost_nonnegative
  check (total_cost is null or total_cost >= 0);

create table if not exists public.business_financial_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_code text not null check (
    account_code in (
      'inventory',
      'cogs',
      'revenue',
      'operating_expense',
      'owner_equity',
      'owner_draw'
    )
  ),
  amount numeric(14,2) not null check (amount >= 0),
  quantity integer null,
  item_key text null check (item_key is null or char_length(trim(item_key)) between 1 and 64),
  reference_type text null check (reference_type is null or char_length(trim(reference_type)) between 1 and 64),
  reference_id uuid null,
  description text not null check (char_length(trim(description)) between 1 and 220),
  effective_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_business_financial_events_business_effective
  on public.business_financial_events(business_id, effective_at desc);

create index if not exists idx_business_financial_events_business_account
  on public.business_financial_events(business_id, account_code, effective_at desc);

alter table public.business_financial_events enable row level security;

create policy "business_financial_events_select_own"
  on public.business_financial_events
  for select
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "business_financial_events_insert_own"
  on public.business_financial_events
  for insert
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "business_financial_events_insert_service"
  on public.business_financial_events
  for insert
  to service_role
  with check (true);

create policy "business_financial_events_update_none"
  on public.business_financial_events
  for update
  using (false)
  with check (false);

comment on table public.business_financial_events is
  'Typed business finance events for accrual-style reporting such as inventory movements and COGS.';
