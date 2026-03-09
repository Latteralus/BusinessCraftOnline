-- Phase 10: per-line retooling for extraction and manufacturing

alter table public.extraction_slots
  add column if not exists configured_item_key text null check (configured_item_key is null or char_length(trim(configured_item_key)) between 1 and 64),
  add column if not exists pending_item_key text null check (pending_item_key is null or char_length(trim(pending_item_key)) between 1 and 64),
  add column if not exists retool_started_at timestamptz null,
  add column if not exists retool_complete_at timestamptz null;

update public.extraction_slots es
set configured_item_key = case b.type
  when 'mine' then 'iron_ore'
  when 'farm' then 'wheat'
  when 'water_company' then 'water'
  when 'logging_camp' then 'raw_wood'
  when 'oil_well' then 'crude_oil'
  else configured_item_key
end
from public.businesses b
where b.id = es.business_id
  and es.configured_item_key is null;

create table if not exists public.manufacturing_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  employee_id uuid null references public.employees(id) on delete set null,
  configured_recipe_key text null check (configured_recipe_key is null or char_length(trim(configured_recipe_key)) between 1 and 64),
  pending_recipe_key text null check (pending_recipe_key is null or char_length(trim(pending_recipe_key)) between 1 and 64),
  status text not null default 'idle' check (status in ('active', 'idle', 'resting', 'retooling')),
  worker_assigned boolean not null default false,
  output_progress numeric(12, 4) not null default 0,
  input_progress jsonb not null default '{}'::jsonb,
  last_tick_at timestamptz null,
  retool_started_at timestamptz null,
  retool_complete_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, line_number)
);

insert into public.manufacturing_lines (
  business_id,
  line_number,
  configured_recipe_key,
  status,
  worker_assigned,
  output_progress,
  input_progress,
  last_tick_at,
  created_at,
  updated_at
)
select
  business_id,
  1,
  active_recipe_key,
  case
    when status in ('active', 'idle') then status
    else 'idle'
  end,
  worker_assigned,
  coalesce(output_progress, 0),
  coalesce(input_progress, '{}'::jsonb),
  last_tick_at,
  created_at,
  updated_at
from public.manufacturing_jobs mj
where not exists (
  select 1
  from public.manufacturing_lines ml
  where ml.business_id = mj.business_id
);

create index if not exists idx_manufacturing_lines_business
  on public.manufacturing_lines(business_id);

create index if not exists idx_manufacturing_lines_employee
  on public.manufacturing_lines(employee_id);

create index if not exists idx_manufacturing_lines_status
  on public.manufacturing_lines(status);

alter table public.manufacturing_lines enable row level security;

create policy "manufacturing_lines_select_own"
  on public.manufacturing_lines
  for select
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "manufacturing_lines_insert_own"
  on public.manufacturing_lines
  for insert
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "manufacturing_lines_update_own"
  on public.manufacturing_lines
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

create policy "manufacturing_lines_delete_own"
  on public.manufacturing_lines
  for delete
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );
