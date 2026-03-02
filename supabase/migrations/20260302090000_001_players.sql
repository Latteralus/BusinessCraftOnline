-- Phase 1: auth-character domain
-- Creates the players table owned by auth-character.

create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (char_length(username) between 3 and 24),
  password_hash text not null,
  email text unique,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;

create policy "players_select_own"
  on public.players
  for select
  using (id = auth.uid());

create policy "players_insert_own"
  on public.players
  for insert
  with check (id = auth.uid());

create policy "players_update_own"
  on public.players
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function register_player(p_username text, p_password text, p_email text default null)
returns uuid
language plpgsql security definer
as $$
declare
  new_player_id uuid;
begin
  insert into public.players (username, password_hash, email)
  values (p_username, crypt(p_password, gen_salt('bf')), p_email)
  returning id into new_player_id;
  return new_player_id;
end;
$$;

create or replace function authenticate_player(p_username text, p_password text)
returns uuid
language plpgsql security definer
as $$
declare
  found_player_id uuid;
begin
  select id into found_player_id
  from public.players
  where username = p_username and password_hash = crypt(p_password, password_hash);
  
  if found_player_id is null then
    raise exception 'Invalid username or password';
  end if;
  
  return found_player_id;
end;
$$;

-- Migration complete: create players table with RLS
