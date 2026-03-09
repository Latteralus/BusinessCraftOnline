create table if not exists public.player_presence (
  player_id uuid primary key references public.players(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_player_presence_last_seen
  on public.player_presence(last_seen_at desc);

alter table public.player_presence enable row level security;

create policy "player_presence_select_own"
  on public.player_presence
  for select
  using (player_id = auth.uid());

create policy "player_presence_insert_own"
  on public.player_presence
  for insert
  with check (player_id = auth.uid());

create policy "player_presence_update_own"
  on public.player_presence
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create or replace function public.touch_player_presence(p_player_id uuid)
returns public.player_presence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.player_presence;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if auth.uid() <> p_player_id then
    raise exception 'Cannot update another player presence row.';
  end if;

  insert into public.player_presence (
    player_id,
    last_seen_at,
    updated_at
  )
  values (
    p_player_id,
    now(),
    now()
  )
  on conflict (player_id)
  do update
    set last_seen_at = now(),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_online_player_previews(p_window_seconds integer default 300)
returns table (
  player_id uuid,
  character_name text,
  business_level integer,
  wealth numeric,
  last_seen_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with bounded_window as (
    select greatest(30, least(coalesce(p_window_seconds, 300), 3600)) as window_seconds
  ),
  online as (
    select pp.player_id, pp.last_seen_at
    from public.player_presence pp
    cross join bounded_window bw
    where pp.last_seen_at >= now() - make_interval(secs => bw.window_seconds)
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
    group by b.player_id
  ),
  business_values as (
    select
      b.player_id,
      round(coalesce(sum(b.value), 0)::numeric, 2) as total
    from public.businesses b
    group by b.player_id
  ),
  active_loans as (
    select
      l.player_id,
      round(coalesce(sum(l.balance_remaining), 0)::numeric, 2) as total
    from public.loans l
    where l.status = 'active'
    group by l.player_id
  )
  select
    o.player_id,
    trim(c.first_name || ' ' || c.last_name) as character_name,
    c.business_level,
    round((
      coalesce(pb.total, 0) +
      coalesce(bb.total, 0) +
      coalesce(bv.total, 0) -
      coalesce(al.total, 0)
    )::numeric, 2) as wealth,
    o.last_seen_at
  from online o
  join public.characters c on c.player_id = o.player_id
  left join personal_balances pb on pb.player_id = o.player_id
  left join business_balances bb on bb.player_id = o.player_id
  left join business_values bv on bv.player_id = o.player_id
  left join active_loans al on al.player_id = o.player_id
  order by wealth desc, character_name asc;
$$;

grant execute on function public.touch_player_presence(uuid) to authenticated;
grant execute on function public.get_online_player_previews(integer) to authenticated;
