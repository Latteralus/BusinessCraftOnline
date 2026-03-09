create or replace function public.get_public_simulation_stats()
returns table (
  player_count bigint,
  business_count bigint,
  online_player_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*)::bigint from public.players) as player_count,
    (select count(*)::bigint from public.businesses) as business_count,
    (
      select count(*)::bigint
      from public.player_presence
      where last_seen_at >= now() - interval '300 seconds'
    ) as online_player_count;
$$;

grant execute on function public.get_public_simulation_stats() to anon;
grant execute on function public.get_public_simulation_stats() to authenticated;
