-- Make exact production slot/line worker placement transactional.

create or replace function public.assign_extraction_slot_worker_atomic(
  p_player_id uuid,
  p_slot_id uuid,
  p_employee_id uuid
)
returns public.extraction_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.extraction_slots;
  v_business public.businesses;
  v_employee public.employees;
  v_assignment public.employee_assignments;
  v_other_id uuid;
  v_next_status text;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_slot
  from public.extraction_slots
  where id = p_slot_id
  for update;

  if v_slot.id is null then
    raise exception 'Extraction slot not found.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = v_slot.business_id
    and player_id = p_player_id
    and type in ('mine', 'farm', 'water_company', 'logging_camp', 'oil_well')
  for update;

  if v_business.id is null then
    raise exception 'Extraction business not found.';
  end if;

  if v_slot.status = 'retooling' then
    raise exception 'Cannot assign a worker while this line is retooling.';
  end if;

  if v_slot.employee_id is not null and v_slot.employee_id <> p_employee_id then
    raise exception 'Extraction slot already has a worker.';
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

  if v_employee.status <> 'assigned' then
    raise exception 'Employee must be active before slot assignment.';
  end if;

  select *
  into v_assignment
  from public.employee_assignments
  where employee_id = p_employee_id
  for update;

  if v_assignment.id is null or v_assignment.business_id <> v_slot.business_id then
    raise exception 'Employee must be assigned to this business before slot assignment.';
  end if;

  if v_assignment.role <> 'production' then
    raise exception 'Employee must be assigned with production role before slot assignment.';
  end if;

  select id
  into v_other_id
  from public.extraction_slots
  where employee_id = p_employee_id
    and id <> p_slot_id
  limit 1;

  if v_other_id is not null then
    raise exception 'Employee is already assigned to another production line.';
  end if;

  select id
  into v_other_id
  from public.manufacturing_lines
  where employee_id = p_employee_id
  limit 1;

  if v_other_id is not null then
    raise exception 'Employee is already assigned to another production line.';
  end if;

  v_next_status := case
    when v_slot.retool_complete_at is not null or v_slot.pending_item_key is not null then 'retooling'
    when v_business.type in ('mine', 'farm', 'water_company') then 'active'
    when v_business.type = 'logging_camp' and v_slot.tool_item_key = 'axe' then 'active'
    when v_business.type = 'oil_well' and v_slot.tool_item_key = 'drill_bit' then 'active'
    else 'idle'
  end;

  update public.employee_assignments
  set slot_number = v_slot.slot_number,
      updated_at = now()
  where id = v_assignment.id;

  update public.extraction_slots
  set employee_id = p_employee_id,
      status = v_next_status,
      updated_at = now()
  where id = v_slot.id
  returning * into v_slot;

  return v_slot;
end;
$$;

create or replace function public.unassign_extraction_slot_worker_atomic(
  p_player_id uuid,
  p_slot_id uuid
)
returns public.extraction_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.extraction_slots;
  v_business public.businesses;
  v_assignment public.employee_assignments;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_slot
  from public.extraction_slots
  where id = p_slot_id
  for update;

  if v_slot.id is null then
    raise exception 'Extraction slot not found.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = v_slot.business_id
    and player_id = p_player_id
    and type in ('mine', 'farm', 'water_company', 'logging_camp', 'oil_well');

  if v_business.id is null then
    raise exception 'Extraction business not found.';
  end if;

  if v_slot.employee_id is not null then
    select *
    into v_assignment
    from public.employee_assignments
    where employee_id = v_slot.employee_id
    for update;

    if v_assignment.id is not null
      and v_assignment.business_id = v_slot.business_id
      and v_assignment.slot_number = v_slot.slot_number
    then
      update public.employee_assignments
      set slot_number = null,
          updated_at = now()
      where id = v_assignment.id;
    end if;
  end if;

  update public.extraction_slots
  set employee_id = null,
      status = case when status = 'retooling' then 'retooling' else 'idle' end,
      updated_at = now()
  where id = v_slot.id
  returning * into v_slot;

  return v_slot;
end;
$$;

create or replace function public.assign_manufacturing_line_worker_atomic(
  p_player_id uuid,
  p_line_id uuid,
  p_employee_id uuid
)
returns public.manufacturing_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.manufacturing_lines;
  v_business public.businesses;
  v_employee public.employees;
  v_assignment public.employee_assignments;
  v_other_id uuid;
  v_next_status text;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_line
  from public.manufacturing_lines
  where id = p_line_id
  for update;

  if v_line.id is null then
    raise exception 'Manufacturing line not found.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = v_line.business_id
    and player_id = p_player_id
    and type in ('sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop')
  for update;

  if v_business.id is null then
    raise exception 'Manufacturing business not found.';
  end if;

  if v_line.employee_id is not null and v_line.employee_id <> p_employee_id then
    raise exception 'Manufacturing line already has a worker.';
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

  if v_employee.status <> 'assigned' then
    raise exception 'Employee must be active before line assignment.';
  end if;

  select *
  into v_assignment
  from public.employee_assignments
  where employee_id = p_employee_id
  for update;

  if v_assignment.id is null or v_assignment.business_id <> v_line.business_id or v_assignment.role <> 'production' then
    raise exception 'Employee must be assigned to this business with a production role.';
  end if;

  select id
  into v_other_id
  from public.extraction_slots
  where employee_id = p_employee_id
  limit 1;

  if v_other_id is not null then
    raise exception 'Employee is already assigned to another production line.';
  end if;

  select id
  into v_other_id
  from public.manufacturing_lines
  where employee_id = p_employee_id
    and id <> p_line_id
  limit 1;

  if v_other_id is not null then
    raise exception 'Employee is already assigned to another production line.';
  end if;

  v_next_status := case
    when v_line.status = 'retooling' then 'retooling'
    when v_line.configured_recipe_key is null then 'idle'
    else 'active'
  end;

  update public.employee_assignments
  set slot_number = v_line.line_number,
      updated_at = now()
  where id = v_assignment.id;

  update public.manufacturing_lines
  set employee_id = p_employee_id,
      worker_assigned = true,
      status = v_next_status,
      updated_at = now()
  where id = v_line.id
  returning * into v_line;

  return v_line;
end;
$$;

create or replace function public.unassign_manufacturing_line_worker_atomic(
  p_player_id uuid,
  p_line_id uuid
)
returns public.manufacturing_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.manufacturing_lines;
  v_business public.businesses;
  v_assignment public.employee_assignments;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_line
  from public.manufacturing_lines
  where id = p_line_id
  for update;

  if v_line.id is null then
    raise exception 'Manufacturing line not found.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = v_line.business_id
    and player_id = p_player_id
    and type in ('sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop');

  if v_business.id is null then
    raise exception 'Manufacturing business not found.';
  end if;

  if v_line.employee_id is not null then
    select *
    into v_assignment
    from public.employee_assignments
    where employee_id = v_line.employee_id
    for update;

    if v_assignment.id is not null
      and v_assignment.business_id = v_line.business_id
      and v_assignment.slot_number = v_line.line_number
    then
      update public.employee_assignments
      set slot_number = null,
          updated_at = now()
      where id = v_assignment.id;
    end if;
  end if;

  update public.manufacturing_lines
  set employee_id = null,
      worker_assigned = false,
      status = case when status = 'retooling' then 'retooling' else 'idle' end,
      updated_at = now()
  where id = v_line.id
  returning * into v_line;

  return v_line;
end;
$$;

revoke all on function public.assign_extraction_slot_worker_atomic(uuid, uuid, uuid) from public;
revoke all on function public.unassign_extraction_slot_worker_atomic(uuid, uuid) from public;
revoke all on function public.assign_manufacturing_line_worker_atomic(uuid, uuid, uuid) from public;
revoke all on function public.unassign_manufacturing_line_worker_atomic(uuid, uuid) from public;

grant execute on function public.assign_extraction_slot_worker_atomic(uuid, uuid, uuid) to authenticated;
grant execute on function public.unassign_extraction_slot_worker_atomic(uuid, uuid) to authenticated;
grant execute on function public.assign_manufacturing_line_worker_atomic(uuid, uuid, uuid) to authenticated;
grant execute on function public.unassign_manufacturing_line_worker_atomic(uuid, uuid) to authenticated;
