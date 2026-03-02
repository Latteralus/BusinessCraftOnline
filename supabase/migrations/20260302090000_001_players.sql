-- Phase 1: auth-character domain
-- Creates the players table owned by auth-character.

create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  email text not null unique,
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

-- Migration complete: create players table with RLS
