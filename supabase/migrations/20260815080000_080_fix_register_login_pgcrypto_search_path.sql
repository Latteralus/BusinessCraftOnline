-- register_player / authenticate_player call crypt()/gen_salt() unqualified,
-- but both are `set search_path = public`. On this hosted project, pgcrypto
-- was installed into the `extensions` schema (Supabase's current default for
-- `create extension`), not `public`, so those calls fail with
-- "function gen_salt(unknown) does not exist" — new player registration and
-- login were both completely broken. Add `extensions` to the search_path so
-- the unqualified calls resolve regardless of which schema pgcrypto actually
-- landed in.

create or replace function public.register_player(p_username text, p_password text, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
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

create or replace function public.authenticate_player(p_username text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  found_player_id uuid;
begin
  select id
  into found_player_id
  from public.players
  where username = p_username
    and password_hash = crypt(p_password, password_hash);

  if found_player_id is null then
    raise exception 'Invalid username or password';
  end if;

  return found_player_id;
end;
$$;
