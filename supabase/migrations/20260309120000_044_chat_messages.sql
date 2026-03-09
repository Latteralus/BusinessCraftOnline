create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  character_first_name text not null check (char_length(character_first_name) between 1 and 32),
  message text not null check (char_length(trim(message)) between 1 and 280),
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_created_at
  on public.chat_messages(created_at desc);

alter table public.chat_messages enable row level security;

create policy "chat_messages_select_authenticated"
  on public.chat_messages
  for select
  using (auth.uid() is not null);

create or replace function public.send_chat_message(p_message text)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_character_first_name text;
  v_row public.chat_messages;
  v_message text;
begin
  v_player_id := auth.uid();

  if v_player_id is null then
    raise exception 'Unauthorized';
  end if;

  v_message := trim(coalesce(p_message, ''));
  if char_length(v_message) < 1 or char_length(v_message) > 280 then
    raise exception 'Chat messages must be between 1 and 280 characters.';
  end if;

  select c.first_name
    into v_character_first_name
  from public.characters c
  where c.player_id = v_player_id;

  if v_character_first_name is null then
    raise exception 'Character setup required before sending chat.';
  end if;

  insert into public.chat_messages (
    player_id,
    character_first_name,
    message
  )
  values (
    v_player_id,
    v_character_first_name,
    v_message
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.send_chat_message(text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
exception
  when undefined_object then
    null;
end;
$$;
