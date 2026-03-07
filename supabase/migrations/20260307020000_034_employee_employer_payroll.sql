-- Phase 15: employee employer-linked payroll
-- Ensures employees retain an employer and wage even when unassigned.

alter table public.employees
  add column if not exists employer_business_id uuid null references public.businesses(id) on delete set null,
  add column if not exists wage_per_hour numeric(12, 2) not null default 0 check (wage_per_hour >= 0),
  add column if not exists last_wage_charged_at timestamptz null;

update public.employees e
set employer_business_id = ea.business_id
from public.employee_assignments ea
where ea.employee_id = e.id
  and e.employer_business_id is null;

update public.employees e
set wage_per_hour = coalesce(
  (
    select ea.wage_per_hour
    from public.employee_assignments ea
    where ea.employee_id = e.id
    limit 1
  ),
  case e.employee_type
    when 'temp' then 15
    when 'part_time' then 10
    when 'full_time' then 9
    when 'specialist' then 14
    else e.wage_per_hour
  end
)
where coalesce(e.wage_per_hour, 0) <= 0;

create index if not exists idx_employees_employer_business
  on public.employees(employer_business_id)
  where employer_business_id is not null;

create index if not exists idx_employees_last_wage_charged_at
  on public.employees(last_wage_charged_at)
  where last_wage_charged_at is not null;

-- Migration complete: add employer-linked payroll fields to employees
