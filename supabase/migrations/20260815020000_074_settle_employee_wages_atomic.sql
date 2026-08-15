-- settleEmployeeWages (src/domains/employees/service.ts) posted the wage debit,
-- then made two more separate network calls (restore-to-open-spot, then the
-- employees row update that clears unpaid_wage_due). If either of those later
-- calls threw, the debit had already posted but unpaid_wage_due never cleared,
-- so a retry re-charged the same wage. Move the debit + debt-clear into one
-- atomic RPC, modeled on assign_employee_atomic's locking pattern; the
-- restore-to-open-spot step stays in application code as a best-effort
-- follow-up that no longer has any financial side effect riding on it.

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
    perform public.append_business_account_entry(
      p_player_id,
      v_employee.employer_business_id,
      v_unpaid_wage_due,
      'debit',
      'employee_wage_settlement',
      'Wage settlement: ' || v_employee.first_name || ' ' || v_employee.last_name,
      v_employee.id
    );
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
