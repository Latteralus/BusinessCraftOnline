-- CityPlan Phase 4: Government Procurement Contracts, part 1 -- schema. Per
-- Documents/Plans/CityPlan.md ("Phase 4 - Government Procurement Contracts",
-- "Shared Government Contract Provider Model", "Federal Contract Provider -
-- Initial Placeholder"). Two new tables owned by the `government` domain
-- (see src/domains/government/DOMAIN.md, which has carried a forward note
-- about this since Phase 3):
--
--   government_contract_providers -- one row per city (provider_type='city')
--     plus a single static federal placeholder (provider_type='federal'),
--     so city and federal procurement share one contract engine instead of
--     diverging into incompatible systems later.
--
--   government_contracts -- the actual contract rows. Municipal replenishment
--     contracts (contract_type='replenishment') point at a city_stockpiles
--     row and are created automatically by migration 118's due-sweep;
--     federal contracts stay empty/disabled in this pass (no automation
--     targets provider_type='federal' yet) per the plan's explicit
--     instruction not to simulate federal economics in v1.
--
-- Mutation model matches every other table in this domain (city_stockpiles,
-- city_resource_modifiers, city_routes): RLS is select-only for authenticated
-- players, every write happens through a security definer RPC. Migration 118
-- adds the replenishment-creation RPCs; migration 119 adds the player-facing
-- award/deliver RPCs.

-- ---------------------------------------------------------------------------
-- 1. government_contract_providers
-- ---------------------------------------------------------------------------

create table if not exists public.government_contract_providers (
  id uuid primary key default gen_random_uuid(),
  provider_type text not null check (provider_type in ('city', 'federal')),
  city_id uuid references public.cities(id) on delete cascade,
  provider_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- city providers must carry a city_id; the federal provider must not --
  -- keeps "federal contracts don't simulate a per-city context" structurally
  -- true rather than just a convention.
  check (
    (provider_type = 'city' and city_id is not null)
    or (provider_type = 'federal' and city_id is null)
  )
);

create unique index if not exists idx_government_contract_providers_city
  on public.government_contract_providers(city_id)
  where provider_type = 'city';

alter table public.government_contract_providers enable row level security;

drop policy if exists "government_contract_providers_select_authenticated" on public.government_contract_providers;
create policy "government_contract_providers_select_authenticated"
  on public.government_contract_providers
  for select
  using (auth.uid() is not null);

-- One provider per active city, keyed off the city's existing human-readable
-- slug (matches the plan's own "city:boise" example exactly), plus a single
-- static Federal provider. Re-runnable via ON CONFLICT so a later migration
-- adding a new active city doesn't need to duplicate this seed.
insert into public.government_contract_providers (provider_type, city_id, provider_key, display_name, is_active)
select 'city', c.id, 'city:' || c.slug, c.name || ' Government', true
from public.cities c
where c.is_active
on conflict (provider_key) do nothing;

insert into public.government_contract_providers (provider_type, city_id, provider_key, display_name, is_active, metadata)
values ('federal', null, 'federal:us', 'United States Federal Government', true, '{}'::jsonb)
on conflict (provider_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. government_contracts
-- ---------------------------------------------------------------------------

create table if not exists public.government_contracts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.government_contract_providers(id) on delete cascade,
  city_id uuid references public.cities(id) on delete cascade,
  stockpile_id uuid references public.city_stockpiles(id) on delete set null,
  contract_type text not null check (contract_type in ('replenishment', 'federal_placeholder', 'future_project')),
  agency_key text,
  item_key text not null,
  quantity_requested numeric not null check (quantity_requested > 0),
  quantity_delivered numeric not null default 0 check (quantity_delivered >= 0),
  minimum_quality integer not null default 1 check (minimum_quality between 1 and 100),
  unit_price numeric not null check (unit_price >= 0),
  total_value numeric not null check (total_value >= 0),
  status text not null default 'available' check (
    status in ('available', 'awarded', 'in_progress', 'fulfilled', 'closed', 'expired', 'cancelled')
  ),
  urgency text not null default 'normal' check (urgency in ('normal', 'low', 'critical')),
  awarded_business_id uuid references public.businesses(id) on delete set null,
  posted_at timestamptz not null default now(),
  deadline_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quantity_delivered <= quantity_requested)
);

create index if not exists idx_government_contracts_status on public.government_contracts(status);
create index if not exists idx_government_contracts_city on public.government_contracts(city_id);
create index if not exists idx_government_contracts_provider on public.government_contracts(provider_id);

-- Idempotency guard for automatic replenishment (plan: "!equivalentActiveContract"),
-- enforced structurally rather than only by an application-side check so
-- concurrent workers can never create two live contracts for the same
-- stockpile. A stockpile can have at most one live (not yet closed/expired/
-- cancelled) contract at a time.
create unique index if not exists idx_government_contracts_stockpile_live
  on public.government_contracts(stockpile_id)
  where stockpile_id is not null and status in ('available', 'awarded', 'in_progress');

alter table public.government_contracts enable row level security;

drop policy if exists "government_contracts_select_authenticated" on public.government_contracts;
create policy "government_contracts_select_authenticated"
  on public.government_contracts
  for select
  using (auth.uid() is not null);

-- Migration complete: government_contract_providers (seeded: one per active
-- city + one static federal placeholder) and government_contracts (empty --
-- migration 118 wires up automatic replenishment contract creation).
