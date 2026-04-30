-- Make employee firing a single authoritative database transaction.

create or replace function public.fire_employee_atomic(
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

  v_assigned_business_id := v_assignment.business_id;

  if v_assignment.id is not null then
    delete from public.employee_assignments
    where id = v_assignment.id;
  end if;

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

  delete from public.employee_skills
  where employee_id = p_employee_id;

  delete from public.employees
  where id = p_employee_id
    and player_id = p_player_id;

  return jsonb_build_object(
    'employee', to_jsonb(v_employee),
    'assigned_business_id', v_assigned_business_id
  );
end;
$$;

revoke all on function public.fire_employee_atomic(uuid, uuid) from public;
grant execute on function public.fire_employee_atomic(uuid, uuid) to authenticated;
