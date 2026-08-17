-- Resolves audit finding H6 (Documents/SBAudit.md): inventory valuation
-- pulled every active listing (across every player and city) for the
-- requested item keys into the app process just to average unit_price in
-- JS. Move the aggregation into SQL so only the aggregated rows (one per
-- item key) cross the wire, and Postgres can do the grouping itself instead
-- of the app process materializing every matching row.

-- Existing idx_market_listings_city_item_price is keyed city-first, which
-- doesn't support this global (all-cities) per-item aggregate well.
create index if not exists idx_market_listings_item_price_active
  on public.market_listings(item_key, unit_price)
  where status = 'active';

create or replace function public.get_market_average_unit_prices(p_item_keys text[])
returns table (item_key text, avg_unit_price numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    ml.item_key,
    round(avg(ml.unit_price)::numeric, 2) as avg_unit_price
  from public.market_listings ml
  where ml.status = 'active'
    and ml.item_key = any(p_item_keys)
  group by ml.item_key;
$$;

grant execute on function public.get_market_average_unit_prices(text[]) to authenticated;
