create table if not exists public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('player', 'system')),
  subject text not null check (char_length(trim(subject)) between 1 and 120),
  system_key text null check (system_key is null or char_length(trim(system_key)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mail_thread_participants (
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null check (role in ('sender', 'recipient', 'system_recipient')),
  last_read_message_created_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (thread_id, player_id)
);

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  sender_player_id uuid null references public.players(id) on delete set null,
  sender_type text not null check (sender_type in ('player', 'system')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  check (
    (sender_type = 'player' and sender_player_id is not null)
    or (sender_type = 'system' and sender_player_id is null)
  )
);

create index if not exists idx_mail_threads_updated_at
  on public.mail_threads(updated_at desc);

create index if not exists idx_mail_thread_participants_player_active
  on public.mail_thread_participants(player_id, deleted_at, updated_at desc);

create index if not exists idx_mail_messages_thread_created_at
  on public.mail_messages(thread_id, created_at desc);

alter table public.mail_threads enable row level security;
alter table public.mail_thread_participants enable row level security;
alter table public.mail_messages enable row level security;

create or replace function public.can_access_mail_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mail_thread_participants mtp
    where mtp.thread_id = p_thread_id
      and mtp.player_id = auth.uid()
      and mtp.deleted_at is null
  );
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mail_threads'
      and policyname = 'mail_threads_select_visible'
  ) then
    create policy "mail_threads_select_visible"
      on public.mail_threads
      for select
      using (public.can_access_mail_thread(id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mail_thread_participants'
      and policyname = 'mail_thread_participants_select_visible_thread'
  ) then
    create policy "mail_thread_participants_select_visible_thread"
      on public.mail_thread_participants
      for select
      using (public.can_access_mail_thread(thread_id));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mail_thread_participants'
      and policyname = 'mail_thread_participants_update_self'
  ) then
    create policy "mail_thread_participants_update_self"
      on public.mail_thread_participants
      for update
      using (player_id = auth.uid())
      with check (player_id = auth.uid());
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mail_messages'
      and policyname = 'mail_messages_select_visible'
  ) then
    create policy "mail_messages_select_visible"
      on public.mail_messages
      for select
      using (public.can_access_mail_thread(thread_id));
  end if;
end;
$$;

create or replace function public.create_player_mail(
  p_recipient_player_id uuid,
  p_subject text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_player_id uuid;
  v_thread_id uuid;
  v_message_created_at timestamptz;
  v_subject text;
  v_body text;
begin
  v_sender_player_id := auth.uid();

  if v_sender_player_id is null then
    raise exception 'Unauthorized';
  end if;

  if p_recipient_player_id is null then
    raise exception 'Recipient is required.';
  end if;

  if p_recipient_player_id = v_sender_player_id then
    raise exception 'You cannot send mail to yourself.';
  end if;

  if not exists (
    select 1
    from public.characters c
    where c.player_id = p_recipient_player_id
  ) then
    raise exception 'Recipient not found.';
  end if;

  v_subject := trim(coalesce(p_subject, ''));
  v_body := trim(coalesce(p_body, ''));

  if char_length(v_subject) < 1 or char_length(v_subject) > 120 then
    raise exception 'Mail subject must be between 1 and 120 characters.';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'Mail body must be between 1 and 4000 characters.';
  end if;

  insert into public.mail_threads (kind, subject)
  values ('player', v_subject)
  returning id into v_thread_id;

  insert into public.mail_messages (
    thread_id,
    sender_player_id,
    sender_type,
    body
  )
  values (
    v_thread_id,
    v_sender_player_id,
    'player',
    v_body
  )
  returning created_at into v_message_created_at;

  insert into public.mail_thread_participants (
    thread_id,
    player_id,
    role,
    last_read_message_created_at
  )
  values
    (v_thread_id, v_sender_player_id, 'sender', v_message_created_at),
    (v_thread_id, p_recipient_player_id, 'recipient', null);

  update public.mail_threads
    set updated_at = v_message_created_at
  where id = v_thread_id;

  return v_thread_id;
end;
$$;

create or replace function public.reply_to_mail_thread(
  p_thread_id uuid,
  p_body text
)
returns public.mail_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_thread public.mail_threads;
  v_message public.mail_messages;
  v_body text;
begin
  v_player_id := auth.uid();

  if v_player_id is null then
    raise exception 'Unauthorized';
  end if;

  select *
    into v_thread
  from public.mail_threads mt
  where mt.id = p_thread_id;

  if v_thread.id is null then
    raise exception 'Mail thread not found.';
  end if;

  if v_thread.kind <> 'player' then
    raise exception 'System mail cannot be replied to.';
  end if;

  if not exists (
    select 1
    from public.mail_thread_participants mtp
    where mtp.thread_id = p_thread_id
      and mtp.player_id = v_player_id
      and mtp.deleted_at is null
  ) then
    raise exception 'Mail thread not found.';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'Mail body must be between 1 and 4000 characters.';
  end if;

  insert into public.mail_messages (
    thread_id,
    sender_player_id,
    sender_type,
    body
  )
  values (
    p_thread_id,
    v_player_id,
    'player',
    v_body
  )
  returning * into v_message;

  update public.mail_threads
    set updated_at = v_message.created_at
  where id = p_thread_id;

  update public.mail_thread_participants
    set last_read_message_created_at = v_message.created_at,
        updated_at = now()
  where thread_id = p_thread_id
    and player_id = v_player_id;

  return v_message;
end;
$$;

create or replace function public.mark_mail_thread_read(
  p_thread_id uuid,
  p_last_read_message_created_at timestamptz default null
)
returns public.mail_thread_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_latest_message_created_at timestamptz;
  v_target_created_at timestamptz;
  v_row public.mail_thread_participants;
begin
  v_player_id := auth.uid();

  if v_player_id is null then
    raise exception 'Unauthorized';
  end if;

  if not exists (
    select 1
    from public.mail_thread_participants mtp
    where mtp.thread_id = p_thread_id
      and mtp.player_id = v_player_id
      and mtp.deleted_at is null
  ) then
    raise exception 'Mail thread not found.';
  end if;

  select max(mm.created_at)
    into v_latest_message_created_at
  from public.mail_messages mm
  where mm.thread_id = p_thread_id;

  v_target_created_at := coalesce(p_last_read_message_created_at, v_latest_message_created_at);

  update public.mail_thread_participants mtp
    set last_read_message_created_at = greatest(
          coalesce(mtp.last_read_message_created_at, '-infinity'::timestamptz),
          coalesce(v_target_created_at, '-infinity'::timestamptz)
        ),
        updated_at = now()
  where mtp.thread_id = p_thread_id
    and mtp.player_id = v_player_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_mail_thread_for_player(
  p_thread_id uuid
)
returns public.mail_thread_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_row public.mail_thread_participants;
begin
  v_player_id := auth.uid();

  if v_player_id is null then
    raise exception 'Unauthorized';
  end if;

  update public.mail_thread_participants mtp
    set deleted_at = coalesce(mtp.deleted_at, now()),
        updated_at = now()
  where mtp.thread_id = p_thread_id
    and mtp.player_id = v_player_id
    and mtp.deleted_at is null
  returning * into v_row;

  if v_row.thread_id is null then
    raise exception 'Mail thread not found.';
  end if;

  return v_row;
end;
$$;

create or replace function public.send_system_mail(
  p_recipient_player_id uuid,
  p_subject text,
  p_body text,
  p_system_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
  v_message_created_at timestamptz;
  v_subject text;
  v_body text;
  v_system_key text;
begin
  if p_recipient_player_id is null then
    raise exception 'Recipient is required.';
  end if;

  if not exists (
    select 1
    from public.characters c
    where c.player_id = p_recipient_player_id
  ) then
    raise exception 'Recipient not found.';
  end if;

  v_subject := trim(coalesce(p_subject, ''));
  v_body := trim(coalesce(p_body, ''));
  v_system_key := nullif(trim(coalesce(p_system_key, '')), '');

  if char_length(v_subject) < 1 or char_length(v_subject) > 120 then
    raise exception 'Mail subject must be between 1 and 120 characters.';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    raise exception 'Mail body must be between 1 and 4000 characters.';
  end if;

  insert into public.mail_threads (kind, subject, system_key)
  values ('system', v_subject, v_system_key)
  returning id into v_thread_id;

  insert into public.mail_messages (
    thread_id,
    sender_player_id,
    sender_type,
    body
  )
  values (
    v_thread_id,
    null,
    'system',
    v_body
  )
  returning created_at into v_message_created_at;

  insert into public.mail_thread_participants (
    thread_id,
    player_id,
    role,
    last_read_message_created_at
  )
  values (
    v_thread_id,
    p_recipient_player_id,
    'system_recipient',
    null
  );

  update public.mail_threads
    set updated_at = v_message_created_at
  where id = v_thread_id;

  return v_thread_id;
end;
$$;

grant execute on function public.create_player_mail(uuid, text, text) to authenticated;
grant execute on function public.reply_to_mail_thread(uuid, text) to authenticated;
grant execute on function public.mark_mail_thread_read(uuid, timestamptz) to authenticated;
grant execute on function public.delete_mail_thread_for_player(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mail_threads'
  ) then
    alter publication supabase_realtime add table public.mail_threads;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mail_thread_participants'
  ) then
    alter publication supabase_realtime add table public.mail_thread_participants;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mail_messages'
  ) then
    alter publication supabase_realtime add table public.mail_messages;
  end if;
exception
  when undefined_object then
    null;
end;
$$;
