-- Atomic employee hiring and contract acceptance.
-- Keeps balance checks, ledger writes, and state changes inside one database transaction.

create or replace function public.hire_employee_atomic(
  p_player_id uuid,
  p_business_id uuid,
  p_first_name text,
  p_last_name text,
  p_employee_type text,
  p_specialty_skill_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses;
  v_balance numeric;
  v_hire_cost numeric(12, 2);
  v_wage_per_hour numeric(12, 2);
  v_base_level integer;
  v_specialist_skill text;
  v_employee public.employees;
  v_skills jsonb;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = p_business_id
    and player_id = p_player_id
  for update;

  if v_business.id is null then
    raise exception 'Business not found.';
  end if;

  case p_employee_type
    when 'temp' then
      v_hire_cost := 0;
      v_wage_per_hour := 40;
      v_base_level := 1;
    when 'part_time' then
      v_hire_cost := 200;
      v_wage_per_hour := 28;
      v_base_level := 6;
    when 'full_time' then
      v_hire_cost := 500;
      v_wage_per_hour := 25;
      v_base_level := 10;
    when 'specialist' then
      v_hire_cost := 1000;
      v_wage_per_hour := 55;
      v_base_level := 20;
    else
      raise exception 'Employee type is invalid.';
  end case;

  if p_specialty_skill_key is not null and p_specialty_skill_key not in (
    'mining',
    'farming',
    'logging',
    'metalworking',
    'carpentry',
    'brewing',
    'food_production',
    'logistics',
    'retail'
  ) then
    raise exception 'Specialty skill is invalid.';
  end if;

  select coalesce(sum(case when entry_type = 'credit' then amount else -amount end), 0)::numeric
  into v_balance
  from public.business_accounts
  where business_id = p_business_id;

  if v_balance < v_hire_cost then
    raise exception 'Insufficient business funds. Hire cost is $% and balance is $%.',
      to_char(v_hire_cost, 'FM999999999990.00'),
      to_char(v_balance, 'FM999999999990.00');
  end if;

  insert into public.employees (
    player_id,
    employer_business_id,
    first_name,
    last_name,
    employee_type,
    status,
    specialty_skill_key,
    hire_cost,
    wage_per_hour,
    last_wage_charged_at,
    shift_ends_at
  )
  values (
    p_player_id,
    p_business_id,
    p_first_name,
    p_last_name,
    p_employee_type,
    'available',
    p_specialty_skill_key,
    v_hire_cost,
    v_wage_per_hour,
    null,
    null
  )
  returning * into v_employee;

  if v_hire_cost > 0 then
    insert into public.business_accounts (
      business_id,
      amount,
      entry_type,
      category,
      reference_id,
      description
    )
    values (
      p_business_id,
      v_hire_cost,
      'debit',
      'employee_hire',
      v_employee.id,
      'Hiring cost: ' || v_employee.first_name || ' ' || v_employee.last_name
    );
  end if;

  v_specialist_skill := coalesce(p_specialty_skill_key, 'logistics');

  insert into public.employee_skills (employee_id, skill_key, level, xp)
  select
    v_employee.id,
    skill_key,
    case when skill_key = v_specialist_skill then v_base_level else greatest(1, v_base_level - 4) end,
    0
  from unnest(array[
    'mining',
    'farming',
    'logging',
    'metalworking',
    'carpentry',
    'brewing',
    'food_production',
    'logistics',
    'retail'
  ]) as skill_key;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.skill_key), '[]'::jsonb)
  into v_skills
  from public.employee_skills s
  where s.employee_id = v_employee.id;

  return jsonb_build_object(
    'employee',
    to_jsonb(v_employee),
    'skills',
    v_skills
  );
end;
$$;

create or replace function public.accept_contract_atomic(
  p_player_id uuid,
  p_contract_id uuid
)
returns public.contracts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contracts;
  v_business public.businesses;
  v_balance numeric;
  v_contract_value numeric(14, 2);
  v_accepted_at timestamptz := now();
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_contract
  from public.contracts
  where id = p_contract_id
    and owner_player_id = p_player_id
  for update;

  if v_contract.id is null then
    raise exception 'Contract not found.';
  end if;

  if v_contract.status <> 'open' then
    raise exception 'Only open contracts can be accepted.';
  end if;

  if v_contract.expires_at is not null and v_contract.expires_at <= v_accepted_at then
    update public.contracts
    set status = 'expired',
        updated_at = v_accepted_at
    where id = v_contract.id
    returning * into v_contract;

    raise exception 'Contract has expired.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = v_contract.business_id
    and player_id = p_player_id
  for update;

  if v_business.id is null then
    raise exception 'Business not found.';
  end if;

  v_contract_value := round((v_contract.required_quantity * v_contract.unit_price)::numeric, 2);

  select coalesce(sum(case when entry_type = 'credit' then amount else -amount end), 0)::numeric
  into v_balance
  from public.business_accounts
  where business_id = v_contract.business_id;

  if v_balance < v_contract_value then
    raise exception 'Insufficient business funds. Contract acceptance requires $% and balance is $%.',
      to_char(v_contract_value, 'FM999999999990.00'),
      to_char(v_balance, 'FM999999999990.00');
  end if;

  insert into public.business_accounts (
    business_id,
    amount,
    entry_type,
    category,
    reference_id,
    description
  )
  values (
    v_contract.business_id,
    v_contract_value,
    'debit',
    'contract_acceptance',
    v_contract.id,
    'Contract acceptance: ' || v_contract.title
  );

  update public.contracts
  set status = 'accepted',
      accepted_at = v_accepted_at,
      due_at = coalesce(due_at, v_accepted_at + interval '24 hours'),
      updated_at = v_accepted_at
  where id = v_contract.id
  returning * into v_contract;

  return v_contract;
end;
$$;

revoke all on function public.hire_employee_atomic(uuid, uuid, text, text, text, text) from public;
revoke all on function public.accept_contract_atomic(uuid, uuid) from public;

grant execute on function public.hire_employee_atomic(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.accept_contract_atomic(uuid, uuid) to authenticated;
