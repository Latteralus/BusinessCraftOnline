create or replace function public.get_player_profile_preview(p_player_id uuid)
returns table (
  player_id uuid,
  username text,
  character_name text,
  first_name text,
  last_name text,
  business_level integer,
  current_city_id uuid,
  current_city_name text,
  joined_at timestamptz,
  last_seen_at timestamptz,
  is_online boolean,
  net_worth numeric,
  total_businesses integer
)
language sql
security definer
set search_path = public
as $$
  with target_player as (
    select p.id, p.username, p.created_at
    from public.players p
    where p.id = p_player_id
  ),
  personal_balances as (
    select
      ba.player_id,
      round(coalesce(sum(
        case
          when t.direction = 'credit' then t.amount
          else -t.amount
        end
      ), 0)::numeric, 2) as total
    from public.bank_accounts ba
    left join public.transactions t on t.account_id = ba.id
    where ba.player_id = p_player_id
    group by ba.player_id
  ),
  business_balances as (
    select
      b.player_id,
      round(coalesce(sum(
        case
          when ba.entry_type = 'credit' then ba.amount
          else -ba.amount
        end
      ), 0)::numeric, 2) as total
    from public.businesses b
    left join public.business_accounts ba on ba.business_id = b.id
    where b.player_id = p_player_id
    group by b.player_id
  ),
  business_values as (
    select
      b.player_id,
      round(coalesce(sum(b.value), 0)::numeric, 2) as total,
      count(*)::integer as business_count
    from public.businesses b
    where b.player_id = p_player_id
    group by b.player_id
  ),
  active_loans as (
    select
      l.player_id,
      round(coalesce(sum(l.balance_remaining), 0)::numeric, 2) as total
    from public.loans l
    where l.player_id = p_player_id
      and l.status = 'active'
    group by l.player_id
  )
  select
    tp.id as player_id,
    tp.username,
    trim(c.first_name || ' ' || c.last_name) as character_name,
    c.first_name,
    c.last_name,
    c.business_level,
    c.current_city_id,
    city.name as current_city_name,
    tp.created_at as joined_at,
    pp.last_seen_at,
    coalesce(pp.last_seen_at >= now() - interval '5 minutes', false) as is_online,
    round((
      coalesce(pb.total, 0) +
      coalesce(bb.total, 0) +
      coalesce(bv.total, 0) -
      coalesce(al.total, 0)
    )::numeric, 2) as net_worth,
    coalesce(bv.business_count, 0) as total_businesses
  from target_player tp
  join public.characters c on c.player_id = tp.id
  left join public.cities city on city.id = c.current_city_id
  left join public.player_presence pp on pp.player_id = tp.id
  left join personal_balances pb on pb.player_id = tp.id
  left join business_balances bb on bb.player_id = tp.id
  left join business_values bv on bv.player_id = tp.id
  left join active_loans al on al.player_id = tp.id;
$$;

create or replace function public.get_player_public_businesses(p_player_id uuid)
returns table (
  business_id uuid,
  player_id uuid,
  name text,
  type text,
  city_id uuid,
  city_name text,
  entity_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    b.id as business_id,
    b.player_id,
    b.name,
    b.type::text,
    b.city_id,
    city.name as city_name,
    b.entity_type::text,
    b.created_at
  from public.businesses b
  left join public.cities city on city.id = b.city_id
  where b.player_id = p_player_id
  order by b.created_at desc, b.name asc;
$$;

grant execute on function public.get_player_profile_preview(uuid) to authenticated;
grant execute on function public.get_player_public_businesses(uuid) to authenticated;
