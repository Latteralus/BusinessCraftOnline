-- Phase 19 patch: atomic inventory increments for tick workers.
-- Prevents lost output when concurrent ticks try to write the same inventory row.

create or replace function public.add_business_inventory_quantity(
  p_owner_player_id uuid,
  p_business_id uuid,
  p_city_id uuid,
  p_item_key text,
  p_quality integer,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner_player_id is null then
    raise exception 'owner_player_id is required.';
  end if;
  if p_business_id is null then
    raise exception 'business_id is required.';
  end if;
  if p_city_id is null then
    raise exception 'city_id is required.';
  end if;
  if p_item_key is null or char_length(trim(p_item_key)) = 0 then
    raise exception 'item_key is required.';
  end if;
  if p_quality is null or p_quality < 1 or p_quality > 100 then
    raise exception 'quality must be between 1 and 100.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0.';
  end if;

  insert into public.business_inventory (
    owner_player_id,
    business_id,
    city_id,
    item_key,
    quantity,
    quality,
    reserved_quantity
  )
  values (
    p_owner_player_id,
    p_business_id,
    p_city_id,
    p_item_key,
    p_quantity,
    p_quality,
    0
  )
  on conflict (business_id, item_key, quality)
  do update
    set quantity = public.business_inventory.quantity + excluded.quantity,
        updated_at = now();
end;
$$;

grant execute on function public.add_business_inventory_quantity(uuid, uuid, uuid, text, integer, integer) to service_role;
