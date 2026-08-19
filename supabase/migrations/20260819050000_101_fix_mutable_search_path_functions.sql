-- Supabase Advisor security hardening, part 2: pin search_path on the three
-- functions flagged `function_search_path_mutable`:
--   - public.invoke_edge_function
--   - public.get_storefront_transaction_aggregate
--   - public.get_storefront_transaction_aggregates_by_business
--
-- `CREATE OR REPLACE FUNCTION` with an unchanged signature preserves the
-- function's existing ACLs, so this migration needs no accompanying
-- GRANT/REVOKE statements -- invoke_edge_function's privileges were already
-- set in 100_function_execute_privilege_hardening.sql, and the two
-- aggregate RPCs keep their existing `authenticated`-only grant from their
-- own migrations (067, 094).
--
-- All three already fully schema-qualify every table/schema reference they
-- make (public.*, net.*, vault.*), so pinning `search_path = public` (the
-- same convention every other SECURITY DEFINER function in this codebase
-- already uses -- see 072/078/097) closes the mutable-search_path gap
-- without any behavior change; a full `search_path = ''` rewrite is not
-- needed here since there are no unqualified identifiers to protect.

create or replace function public.invoke_edge_function(function_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  auth_header text;
  tick_secret text;
  headers jsonb;
begin
  base_url := nullif(current_setting('app.settings.edge_function_base_url', true), '');
  auth_header := nullif(current_setting('app.settings.edge_function_auth', true), '');
  tick_secret := nullif(current_setting('app.settings.edge_function_tick_secret', true), '');

  if base_url is null then
    base_url := 'https://aroffxhnsjjdtqieeogx.supabase.co/functions/v1/';
  end if;

  if tick_secret is null then
    begin
      execute $vault$
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'edge_function_tick_secret'
        order by created_at desc
        limit 1
      $vault$
      into tick_secret;
    exception
      when others then
        tick_secret := null;
    end;
  end if;

  headers := jsonb_build_object('Content-Type', 'application/json');
  if auth_header is not null then
    headers := headers || jsonb_build_object('Authorization', auth_header);
  end if;
  if tick_secret is not null then
    headers := headers || jsonb_build_object('x-tick-secret', tick_secret);
  end if;

  perform net.http_post(
    url := base_url || function_name,
    headers := headers
  );
end;
$$;

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
set search_path = public
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

create or replace function public.get_storefront_transaction_aggregates_by_business(
  p_seller_player_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default now()
)
returns table (
  seller_business_id uuid,
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
set search_path = public
as $$
  select
    mt.seller_business_id,
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
    and mt.seller_player_id = p_seller_player_id
    and (p_from is null or mt.created_at >= p_from)
    and (p_to is null or mt.created_at <= p_to)
  group by mt.seller_business_id;
$$;
