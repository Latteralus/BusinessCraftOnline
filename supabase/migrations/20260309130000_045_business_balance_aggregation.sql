create index if not exists idx_businesses_player_type_created
  on public.businesses(player_id, type, created_at desc);

create index if not exists idx_businesses_player_city_created
  on public.businesses(player_id, city_id, created_at desc);

create or replace function public.get_player_businesses_with_balances(
  p_player_id uuid,
  p_type text default null,
  p_city_id uuid default null
)
returns table (
  id uuid,
  player_id uuid,
  name text,
  type text,
  city_id uuid,
  entity_type text,
  value numeric,
  created_at timestamptz,
  updated_at timestamptz,
  balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.player_id,
    b.name,
    b.type,
    b.city_id,
    b.entity_type,
    b.value,
    b.created_at,
    b.updated_at,
    round(
      coalesce(sum(
        case
          when ba.entry_type = 'credit' then ba.amount
          else -ba.amount
        end
      ), 0)::numeric,
      2
    ) as balance
  from public.businesses b
  left join public.business_accounts ba on ba.business_id = b.id
  where auth.uid() is not null
    and b.player_id = auth.uid()
    and b.player_id = p_player_id
    and (p_type is null or b.type = p_type)
    and (p_city_id is null or b.city_id = p_city_id)
  group by b.id
  order by b.created_at desc;
$$;

grant execute on function public.get_player_businesses_with_balances(uuid, text, uuid) to authenticated;
