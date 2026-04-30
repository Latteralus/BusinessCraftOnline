-- Aggregate NPC storefront transaction metrics server-side so dashboards do not
-- rely on capped raw row fetches.

create or replace function public.get_storefront_transaction_aggregate(
  p_seller_player_id uuid default null,
  p_seller_business_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default now()
)
returns table (
  transaction_count bigint,
  units_sold bigint,
  gross_revenue numeric,
  fee_total numeric,
  net_revenue numeric,
  distinct_shopper_count bigint,
  first_transaction_at timestamptz,
  last_transaction_at timestamptz
)
language sql
stable
as $$
  select
    count(*)::bigint as transaction_count,
    coalesce(sum(mt.quantity), 0)::bigint as units_sold,
    coalesce(round(sum(mt.gross_total)::numeric, 2), 0)::numeric as gross_revenue,
    coalesce(round(sum(mt.market_fee)::numeric, 2), 0)::numeric as fee_total,
    coalesce(round(sum(mt.net_total)::numeric, 2), 0)::numeric as net_revenue,
    count(distinct coalesce(
      mt.tick_window_started_at::text || ':' || coalesce(mt.sub_tick_index::text, 'na') || ':' || nullif(mt.shopper_name, ''),
      mt.id::text
    ))::bigint as distinct_shopper_count,
    min(mt.created_at) as first_transaction_at,
    max(mt.created_at) as last_transaction_at
  from public.market_transactions mt
  where mt.buyer_type = 'npc'
    and (p_seller_player_id is null or mt.seller_player_id = p_seller_player_id)
    and (p_seller_business_id is null or mt.seller_business_id = p_seller_business_id)
    and (p_from is null or mt.created_at >= p_from)
    and (p_to is null or mt.created_at <= p_to);
$$;

revoke all on function public.get_storefront_transaction_aggregate(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_storefront_transaction_aggregate(uuid, uuid, timestamptz, timestamptz) to authenticated;
