-- Phase 65: Add optional unit_cost parameter to add_business_inventory_quantity.
-- Enables extraction and manufacturing ticks to record a cost basis for produced
-- inventory, so COGS on storefront sales reflects real production costs rather
-- than defaulting to zero.
--
-- Cost merging uses weighted-average costing: when adding units to an existing
-- inventory row the new average is (old_total_cost + new_unit_cost * new_qty)
--                                  / (old_qty + new_qty).
-- Callers that omit p_unit_cost get the original behaviour (quantity-only update).

drop function if exists public.add_business_inventory_quantity(uuid, uuid, uuid, text, integer, integer);

create or replace function public.add_business_inventory_quantity(
  p_owner_player_id uuid,
  p_business_id     uuid,
  p_city_id         uuid,
  p_item_key        text,
  p_quality         integer,
  p_quantity        integer,
  p_unit_cost       numeric default null
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
    reserved_quantity,
    unit_cost,
    total_cost
  )
  values (
    p_owner_player_id,
    p_business_id,
    p_city_id,
    p_item_key,
    p_quantity,
    p_quality,
    0,
    p_unit_cost,
    case when p_unit_cost is not null
         then round(p_unit_cost * p_quantity, 2)
         else null
    end
  )
  on conflict (business_id, item_key, quality)
  do update set
    quantity   = public.business_inventory.quantity + excluded.quantity,
    -- Weighted-average unit cost: only updated when caller supplies a cost basis.
    -- existing_total_cost is derived from total_cost if present, else unit_cost * qty.
    unit_cost  = case
      when excluded.unit_cost is not null then
        round(
          (
            coalesce(
              public.business_inventory.total_cost,
              public.business_inventory.quantity * coalesce(public.business_inventory.unit_cost, 0)
            )
            + excluded.unit_cost * excluded.quantity
          ) / (public.business_inventory.quantity + excluded.quantity),
          2
        )
      else public.business_inventory.unit_cost
    end,
    total_cost = case
      when excluded.unit_cost is not null then
        round(
          coalesce(
            public.business_inventory.total_cost,
            public.business_inventory.quantity * coalesce(public.business_inventory.unit_cost, 0)
          )
          + excluded.unit_cost * excluded.quantity,
          2
        )
      else public.business_inventory.total_cost
    end,
    updated_at = now();
end;
$$;

grant execute on function public.add_business_inventory_quantity(uuid, uuid, uuid, text, integer, integer, numeric) to service_role;
