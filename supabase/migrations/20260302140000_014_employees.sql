-- Phase 6: employees domain
-- Creates employees table owned by employees.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  first_name text not null check (char_length(trim(first_name)) between 1 and 40),
  last_name text not null check (char_length(trim(last_name)) between 1 and 40),
  employee_type text not null check (employee_type in ('temp', 'part_time', 'full_time', 'specialist')),
  status text not null default 'available' check (status in ('available', 'assigned', 'resting', 'unpaid', 'fired')),
  specialty_skill_key text null check (
    specialty_skill_key is null
    or specialty_skill_key in (
      'mining',
      'farming',
      'logging',
      'metalworking',
      'carpentry',
      'brewing',
      'food_production',
      'logistics',
      'retail'
    )
  ),
  hire_cost numeric(12, 2) not null default 0 check (hire_cost >= 0),
  shift_ends_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employees_player_created
  on public.employees(player_id, created_at desc);

create index if not exists idx_employees_player_status
  on public.employees(player_id, status);

create index if not exists idx_employees_player_type
  on public.employees(player_id, employee_type);

alter table public.employees enable row level security;

create policy "employees_select_own"
  on public.employees
  for select
  using (player_id = auth.uid());

create policy "employees_insert_own"
  on public.employees
  for insert
  with check (player_id = auth.uid());

create policy "employees_update_own"
  on public.employees
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy "employees_delete_own"
  on public.employees
  for delete
  using (player_id = auth.uid());

-- Migration complete: create employees table with ownership constraints and RLS
