create table if not exists public.player_chat_state (
  player_id uuid primary key references public.players(id) on delete cascade,
  last_read_message_created_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.player_chat_state enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'player_chat_state'
      and policyname = 'player_chat_state_select_own'
  ) then
    create policy "player_chat_state_select_own"
      on public.player_chat_state
      for select
      using (auth.uid() = player_id);
  end if;
end;
$$;

create or replace function public.mark_chat_read(p_last_read_message_created_at timestamptz)
returns public.player_chat_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_row public.player_chat_state;
begin
  v_player_id := auth.uid();

  if v_player_id is null then
    raise exception 'Unauthorized';
  end if;

  insert into public.player_chat_state (
    player_id,
    last_read_message_created_at,
    updated_at
  )
  values (
    v_player_id,
    p_last_read_message_created_at,
    now()
  )
  on conflict (player_id) do update
    set last_read_message_created_at = greatest(
      coalesce(public.player_chat_state.last_read_message_created_at, '-infinity'::timestamptz),
      coalesce(excluded.last_read_message_created_at, '-infinity'::timestamptz)
    ),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.mark_chat_read(timestamptz) to authenticated;
