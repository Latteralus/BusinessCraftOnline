-- Phase 6: employees domain
-- Creates employee_assignments table owned by employees.

create table if not exists public.employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null check (role in ('production', 'supply')),
  slot_number integer null check (slot_number is null or slot_number >= 1),
  wage_per_hour numeric(12, 2) not null check (wage_per_hour >= 0),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id)
);

create index if not exists idx_employee_assignments_business
  on public.employee_assignments(business_id);

create index if not exists idx_employee_assignments_employee
  on public.employee_assignments(employee_id);

create index if not exists idx_employee_assignments_business_role
  on public.employee_assignments(business_id, role);

create index if not exists idx_employee_assignments_business_slot
  on public.employee_assignments(business_id, slot_number)
  where slot_number is not null;

alter table public.employee_assignments enable row level security;

create policy "employee_assignments_select_own"
  on public.employee_assignments
  for select
  using (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  );

create policy "employee_assignments_insert_own"
  on public.employee_assignments
  for insert
  with check (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "employee_assignments_update_own"
  on public.employee_assignments
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
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "employee_assignments_delete_own"
  on public.employee_assignments
  for delete
  using (
    exists (
      select 1
      from public.employees e
      where e.id = employee_id
        and e.player_id = auth.uid()
    )
  );

-- Migration complete: create employee_assignments table with ownership constraints and RLS
