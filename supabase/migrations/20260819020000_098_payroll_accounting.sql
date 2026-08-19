-- AccountingFixPlan Phase B: fix payroll accounting (plan item 39).
--
-- Standardizes payroll onto the canonical payroll_expense account and posts
-- a real double-entry journal transaction for every wage event:
--   - earned + enough cash:   Debit Payroll Expense / Credit Cash
--   - earned + insufficient:  Debit Payroll Expense / Credit Wages Payable
--   - later settlement:       Debit Wages Payable / Credit Cash
--     (never re-recognizes Payroll Expense -- it was already recognized at
--     accrual time)
--
-- business_financial_events previously only allowed 6 account_code values
-- (from migration 046, before the Chart of Accounts existed) and had never
-- been widened since. Add payroll_expense and wages_payable so the accrual
-- event this migration's RPC writes is actually valid.

alter table public.business_financial_events
  drop constraint business_financial_events_account_code_check;

alter table public.business_financial_events
  add constraint business_financial_events_account_code_check
  check (
    account_code in (
      'inventory',
      'cogs',
      'revenue',
      'operating_expense',
      'owner_equity',
      'owner_draw',
      'payroll_expense',
      'wages_payable'
    )
  );

-- ---------------------------------------------------------------------------
-- New atomic RPC replacing tick-wages' inline branch logic. Previously the
-- edge function did a plain `business_accounts` insert (paid branch) or a
-- multi-step, non-atomic sequence of `employees`/`employee_assignments`/
-- `extraction_slots` writes (unpaid branch) with zero accounting entries
-- either way -- the wage never touched business_financial_events or the
-- journal, so it was invisible to every finance report. This RPC does the
-- full accounting for one employee's wage charge in one transaction.
--
-- The wage amount and charge-window anchor timestamp are still computed by
-- the calling tick (chargeWindowCount/last_wage_charged_at bookkeeping is
-- unrelated to the accounting bug this phase fixes), but every write that
-- moves cash, recognizes expense, or changes the liability now happens here.
-- ---------------------------------------------------------------------------

create or replace function public.charge_employee_wage_atomic(
  p_employee_id uuid,
  p_wage_amount numeric,
  p_charge_anchor_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees;
  v_balance numeric;
  v_now timestamptz := now();
  v_ledger_row public.business_accounts;
  v_journal_entry_id uuid;
  v_branch text;
  v_description text;
begin
  if p_wage_amount is null or p_wage_amount <= 0 then
    raise exception 'wage amount must be greater than zero';
  end if;

  select * into v_employee from public.employees where id = p_employee_id for update;
  if v_employee.id is null then
    raise exception 'Employee not found.';
  end if;
  if v_employee.employer_business_id is null then
    raise exception 'Employee is not tied to a business.';
  end if;

  -- Lock the business row to serialize against concurrent balance changes,
  -- matching settle_employee_wages_atomic's locking pattern.
  perform 1 from public.businesses where id = v_employee.employer_business_id for update;

  select public.get_business_account_balance(v_employee.employer_business_id) into v_balance;

  v_description := v_employee.first_name || ' ' || v_employee.last_name;

  if coalesce(v_balance, 0) >= p_wage_amount then
    v_branch := 'paid';

    v_ledger_row := public.append_business_account_entry(
      v_employee.player_id,
      v_employee.employer_business_id,
      p_wage_amount,
      'debit',
      'wage_payment',
      'Wage payment: ' || v_description,
      v_employee.id
    );

    v_journal_entry_id := public.post_business_journal_entry(
      v_employee.employer_business_id,
      jsonb_build_array(
        jsonb_build_object('account_code', 'payroll_expense', 'debit', p_wage_amount),
        jsonb_build_object('account_code', 'cash', 'credit', p_wage_amount)
      ),
      'wage_payment',
      v_employee.id,
      'Wage payment: ' || v_description,
      v_now
    );

    update public.business_accounts set journal_entry_id = v_journal_entry_id where id = v_ledger_row.id;

    perform public.append_business_financial_event(
      v_employee.player_id,
      v_employee.employer_business_id,
      'payroll_expense',
      p_wage_amount,
      'Wage payment: ' || v_description,
      null,
      null,
      'wage_payment',
      v_employee.id,
      v_now
    );

    update public.employees
    set last_wage_charged_at = p_charge_anchor_at,
        updated_at = v_now
    where id = v_employee.id
    returning * into v_employee;
  else
    v_branch := 'unpaid';

    v_journal_entry_id := public.post_business_journal_entry(
      v_employee.employer_business_id,
      jsonb_build_array(
        jsonb_build_object('account_code', 'payroll_expense', 'debit', p_wage_amount),
        jsonb_build_object('account_code', 'wages_payable', 'credit', p_wage_amount)
      ),
      'wage_accrual',
      v_employee.id,
      'Wage accrual (unpaid): ' || v_description,
      v_now
    );

    perform public.append_business_financial_event(
      v_employee.player_id,
      v_employee.employer_business_id,
      'payroll_expense',
      p_wage_amount,
      'Wage accrual (unpaid): ' || v_description,
      null,
      null,
      'wage_accrual',
      v_employee.id,
      v_now
    );

    update public.employees
    set status = 'unpaid',
        unpaid_wage_due = coalesce(unpaid_wage_due, 0) + p_wage_amount,
        unpaid_since = v_now,
        last_unassigned_for_unpaid_at = v_now,
        last_wage_charged_at = p_charge_anchor_at,
        updated_at = v_now
    where id = v_employee.id
    returning * into v_employee;

    delete from public.employee_assignments where employee_id = v_employee.id;
    update public.extraction_slots
    set employee_id = null, status = 'idle', updated_at = v_now
    where employee_id = v_employee.id;
  end if;

  return jsonb_build_object('branch', v_branch, 'employee', to_jsonb(v_employee));
end;
$$;

revoke all on function public.charge_employee_wage_atomic(uuid, numeric, timestamptz) from public;
grant execute on function public.charge_employee_wage_atomic(uuid, numeric, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- settle_employee_wages_atomic: now also posts the journal entry for the
-- liability payoff (Debit Wages Payable / Credit Cash) and links it to the
-- cash ledger row. Deliberately does NOT touch business_financial_events --
-- the payroll_expense was already recognized when the wage was accrued
-- (charge_employee_wage_atomic above); recognizing it again here would
-- double-count the expense.
-- ---------------------------------------------------------------------------

create or replace function public.settle_employee_wages_atomic(
  p_player_id uuid,
  p_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees;
  v_unpaid_wage_due numeric;
  v_balance numeric;
  v_ledger_row public.business_accounts;
  v_journal_entry_id uuid;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id
    and player_id = p_player_id
  for update;

  if v_employee.id is null then
    raise exception 'Employee not found.';
  end if;

  if v_employee.status <> 'unpaid' then
    raise exception 'Employee does not have unpaid wages.';
  end if;

  if v_employee.employer_business_id is null then
    raise exception 'Employee is not tied to a business.';
  end if;

  v_unpaid_wage_due := coalesce(v_employee.unpaid_wage_due, 0);

  if v_unpaid_wage_due > 0 then
    -- Lock the business row to serialize against concurrent balance changes
    -- (other wage settlements, transfers, purchases) before checking funds.
    perform 1 from public.businesses where id = v_employee.employer_business_id for update;

    select public.get_business_account_balance(v_employee.employer_business_id)
    into v_balance;

    if coalesce(v_balance, 0) < v_unpaid_wage_due then
      raise exception 'Insufficient business funds. Wage settlement is $% and balance is $%.',
        round(v_unpaid_wage_due::numeric, 2), round(coalesce(v_balance, 0)::numeric, 2);
    end if;

    -- Reuse the already-hardened ledger-append RPC rather than duplicating
    -- its insert here. auth.uid() is unaffected by SECURITY DEFINER nesting,
    -- so its own p_player_id = auth.uid() check still passes for the caller.
    v_ledger_row := public.append_business_account_entry(
      p_player_id,
      v_employee.employer_business_id,
      v_unpaid_wage_due,
      'debit',
      'employee_wage_settlement',
      'Wage settlement: ' || v_employee.first_name || ' ' || v_employee.last_name,
      v_employee.id
    );

    v_journal_entry_id := public.post_business_journal_entry(
      v_employee.employer_business_id,
      jsonb_build_array(
        jsonb_build_object('account_code', 'wages_payable', 'debit', v_unpaid_wage_due),
        jsonb_build_object('account_code', 'cash', 'credit', v_unpaid_wage_due)
      ),
      'employee_wage_settlement',
      v_employee.id,
      'Wage settlement: ' || v_employee.first_name || ' ' || v_employee.last_name
    );

    update public.business_accounts set journal_entry_id = v_journal_entry_id where id = v_ledger_row.id;
  end if;

  update public.employees
  set status = 'available',
      unpaid_wage_due = 0,
      unpaid_since = null,
      last_unassigned_for_unpaid_at = null,
      shift_ends_at = null,
      last_wage_charged_at = now(),
      updated_at = now()
  where id = p_employee_id
    and player_id = p_player_id
  returning * into v_employee;

  return jsonb_build_object('employee', to_jsonb(v_employee));
end;
$$;

revoke all on function public.settle_employee_wages_atomic(uuid, uuid) from public;
grant execute on function public.settle_employee_wages_atomic(uuid, uuid) to authenticated;

-- Migration complete: payroll accrual/settlement now post balanced journal entries and a payroll_expense financial event.
