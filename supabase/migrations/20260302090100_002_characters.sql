-- Phase 1: auth-character domain
-- Creates the characters table owned by auth-character.

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references public.players(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 32),
  last_name text not null check (char_length(last_name) between 1 and 32),
  gender text not null check (gender in ('male', 'female', 'other')),
  current_city_id uuid null,
  business_level integer not null default 1 check (business_level >= 1),
  created_at timestamptz not null default now()
);

create index if not exists idx_characters_player_id on public.characters(player_id);

alter table public.characters enable row level security;

create policy "characters_select_own"
  on public.characters
  for select
  using (player_id = auth.uid());

create policy "characters_insert_own"
  on public.characters
  for insert
  with check (player_id = auth.uid());

create policy "characters_update_own"
  on public.characters
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

-- Migration complete: create characters table with RLS
