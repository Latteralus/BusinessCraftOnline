-- Move generic employee assignment/unassignment into transactional RPCs.

create or replace function public.assign_employee_atomic(
  p_player_id uuid,
  p_employee_id uuid,
  p_business_id uuid,
  p_role text,
  p_slot_number integer default null,
  p_wage_variance numeric default 0,
  p_role_skill_key text default 'logistics'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees;
  v_business public.businesses;
  v_assignment public.employee_assignments;
  v_existing_assignment_id uuid;
  v_role_skill_key text := coalesce(p_role_skill_key, 'logistics');
  v_skill_level integer;
  v_clamped_variance numeric;
  v_base_wage numeric;
  v_modifier numeric;
  v_wage_per_hour numeric(12, 2);
  v_shift_hours integer;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  if p_role not in ('production', 'supply') then
    raise exception 'Employee role is invalid.';
  end if;

  if p_slot_number is not null and p_slot_number < 1 then
    raise exception 'Slot number must be at least 1.';
  end if;

  if v_role_skill_key not in (
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
    raise exception 'Role skill is invalid.';
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

  if v_employee.status = 'fired' then
    raise exception 'Cannot assign a fired employee.';
  end if;

  if v_employee.status = 'unpaid' then
    raise exception 'Cannot assign an unpaid employee until wages are settled.';
  end if;

  if v_employee.employer_business_id is not null and v_employee.employer_business_id <> p_business_id then
    raise exception 'Employee belongs to a different business and cannot be reassigned.';
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

  select id
  into v_existing_assignment_id
  from public.employee_assignments
  where employee_id = p_employee_id
  for update;

  if v_existing_assignment_id is not null then
    raise exception 'Employee is already assigned.';
  end if;

  select coalesce(level, 1)
  into v_skill_level
  from public.employee_skills
  where employee_id = p_employee_id
    and skill_key = v_role_skill_key;

  v_skill_level := greatest(1, least(100, coalesce(v_skill_level, 1)));
  v_clamped_variance := greatest(-2, least(2, coalesce(p_wage_variance, 0)));

  case v_employee.employee_type
    when 'temp' then
      v_base_wage := 40;
      v_modifier := 0.5;
      v_shift_hours := 4;
    when 'part_time' then
      v_base_wage := 28;
      v_modifier := 0.5;
      v_shift_hours := 8;
    when 'full_time' then
      v_base_wage := 25;
      v_modifier := 0.5;
      v_shift_hours := 12;
    when 'specialist' then
      v_base_wage := 55;
      v_modifier := 0.75;
      v_shift_hours := 24;
    else
      raise exception 'Employee type is invalid.';
  end case;

  v_wage_per_hour := round((v_base_wage + v_skill_level * v_modifier + v_clamped_variance)::numeric, 2);

  insert into public.employee_assignments (
    employee_id,
    business_id,
    role,
    slot_number,
    wage_per_hour
  )
  values (
    p_employee_id,
    p_business_id,
    p_role,
    p_slot_number,
    v_wage_per_hour
  )
  returning * into v_assignment;

  update public.employees
  set employer_business_id = p_business_id,
      wage_per_hour = v_wage_per_hour,
      status = 'assigned',
      shift_ends_at = now() + make_interval(hours => v_shift_hours),
      updated_at = now()
  where id = p_employee_id
    and player_id = p_player_id
  returning * into v_employee;

  return jsonb_build_object(
    'employee', to_jsonb(v_employee),
    'assignment', to_jsonb(v_assignment)
  );
end;
$$;

create or replace function public.unassign_employee_atomic(
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
  v_assignment public.employee_assignments;
  v_assigned_business_id uuid;
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

  select *
  into v_assignment
  from public.employee_assignments
  where employee_id = p_employee_id
  for update;

  if v_assignment.id is null then
    raise exception 'Employee is not assigned.';
  end if;

  v_assigned_business_id := v_assignment.business_id;

  delete from public.employee_assignments
  where id = v_assignment.id;

  update public.extraction_slots
  set employee_id = null,
      updated_at = now()
  where employee_id = p_employee_id
    and status = 'retooling';

  update public.extraction_slots
  set employee_id = null,
      status = 'idle',
      updated_at = now()
  where employee_id = p_employee_id
    and status <> 'retooling';

  update public.manufacturing_lines
  set employee_id = null,
      worker_assigned = false,
      updated_at = now()
  where employee_id = p_employee_id
    and status = 'retooling';

  update public.manufacturing_lines
  set employee_id = null,
      worker_assigned = false,
      status = 'idle',
      updated_at = now()
  where employee_id = p_employee_id
    and status <> 'retooling';

  update public.employees
  set status = 'available',
      shift_ends_at = null,
      updated_at = now()
  where id = p_employee_id
    and player_id = p_player_id
  returning * into v_employee;

  return jsonb_build_object(
    'employee', to_jsonb(v_employee),
    'assigned_business_id', v_assigned_business_id
  );
end;
$$;

revoke all on function public.assign_employee_atomic(uuid, uuid, uuid, text, integer, numeric, text) from public;
revoke all on function public.unassign_employee_atomic(uuid, uuid) from public;

grant execute on function public.assign_employee_atomic(uuid, uuid, uuid, text, integer, numeric, text) to authenticated;
grant execute on function public.unassign_employee_atomic(uuid, uuid) to authenticated;
