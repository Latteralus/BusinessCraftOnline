-- Phase 14: economy automation ticks
-- Adds wage tick bookkeeping and unpaid gating fields.

alter table public.employee_assignments
  add column if not exists last_wage_charged_at timestamptz null;

create index if not exists idx_employee_assignments_last_wage_charged_at
  on public.employee_assignments(last_wage_charged_at)
  where last_wage_charged_at is not null;

alter table public.employees
  add column if not exists unpaid_wage_due numeric(12, 2) not null default 0 check (unpaid_wage_due >= 0),
  add column if not exists unpaid_since timestamptz null,
  add column if not exists last_unassigned_for_unpaid_at timestamptz null;

create index if not exists idx_employees_player_status_unpaid
  on public.employees(player_id, status, unpaid_wage_due);

-- Migration complete: add wage automation state fields for unpaid tracking and tick idempotency

