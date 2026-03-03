-- Ensure pgcrypto is available
create extension if not exists pgcrypto;

-- Safe alter commands just in case they haven't made all the changes
alter table public.players drop constraint if exists players_id_fkey;
alter table public.players alter column id set default gen_random_uuid();

-- Add columns if they don't exist
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='password_hash') then
    alter table public.players add column password_hash text;
  end if;
  
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='email' and is_nullable='NO') then
    alter table public.players alter column email drop not null;
  end if;
end
$$;

-- Create the required RPC functions for authentication

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