-- Phase 6: employees domain
-- Creates employee_skills table owned by employees.

create table if not exists public.employee_skills (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  skill_key text not null check (
    skill_key in (
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
  level integer not null default 1 check (level between 1 and 100),
  xp integer not null default 0 check (xp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, skill_key)
);

create index if not exists idx_employee_skills_employee
  on public.employee_skills(employee_id);

create index if not exists idx_employee_skills_skill_level
  on public.employee_skills(skill_key, level desc);

alter table public.employee_skills enable row level security;

create policy "employee_skills_select_own"
  on public.employee_skills
  for select
  using (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  );

create policy "employee_skills_insert_own"
  on public.employee_skills
  for insert
  with check (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  );

create policy "employee_skills_update_own"
  on public.employee_skills
  for update
  using (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  );

create policy "employee_skills_delete_own"
  on public.employee_skills
  for delete
  using (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  );

-- Migration complete: create employee_skills table with ownership constraints and RLS
