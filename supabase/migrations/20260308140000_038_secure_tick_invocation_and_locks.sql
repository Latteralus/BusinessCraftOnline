-- Phase 21: secure tick edge invocation + per-tick re-entry locks.

create table if not exists public.tick_function_locks (
  tick_name text primary key,
  lock_token uuid,
  locked_until timestamptz not null default to_timestamp(0),
  updated_at timestamptz not null default now()
);

alter table public.tick_function_locks enable row level security;

create or replace function public.acquire_tick_lock(
  p_tick_name text,
  p_lock_seconds integer default 300
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_seconds integer := greatest(5, least(coalesce(p_lock_seconds, 300), 3600));
  v_next_token uuid := gen_random_uuid();
  v_acquired_token uuid;
begin
  if p_tick_name is null or char_length(trim(p_tick_name)) = 0 then
    raise exception 'tick name is required';
  end if;

  insert into public.tick_function_locks as t (
    tick_name,
    lock_token,
    locked_until,
    updated_at
  )
  values (
    p_tick_name,
    v_next_token,
    now() + make_interval(secs => v_lock_seconds),
    now()
  )
  on conflict (tick_name)
  do update
    set lock_token = excluded.lock_token,
        locked_until = excluded.locked_until,
        updated_at = now()
  where t.locked_until <= now()
  returning lock_token into v_acquired_token;

  return v_acquired_token;
end;
$$;

create or replace function public.release_tick_lock(
  p_tick_name text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer := 0;
begin
  if p_tick_name is null or char_length(trim(p_tick_name)) = 0 then
    return false;
  end if;

  if p_lock_token is null then
    return false;
  end if;

  update public.tick_function_locks
  set
    lock_token = null,
    locked_until = now(),
    updated_at = now()
  where tick_name = p_tick_name
    and lock_token = p_lock_token;

  get diagnostics v_updated_count = row_count;
  return v_updated_count > 0;
end;
$$;

revoke all on function public.acquire_tick_lock(text, integer) from public;
revoke all on function public.release_tick_lock(text, uuid) from public;

grant execute on function public.acquire_tick_lock(text, integer) to service_role;
grant execute on function public.release_tick_lock(text, uuid) to service_role;

create or replace function invoke_edge_function(function_name text)
returns void as $$
declare
  base_url text;
  auth_header text;
  tick_secret text;
  headers jsonb;
begin
  base_url := nullif(current_setting('app.settings.edge_function_base_url', true), '');
  auth_header := nullif(current_setting('app.settings.edge_function_auth', true), '');
  tick_secret := nullif(current_setting('app.settings.edge_function_tick_secret', true), '');

  if base_url is null then
    base_url := 'http://host.docker.internal:54321/functions/v1/';
  end if;

  headers := jsonb_build_object('Content-Type', 'application/json');
  if auth_header is not null then
    headers := headers || jsonb_build_object('Authorization', auth_header);
  end if;
  if tick_secret is not null then
    headers := headers || jsonb_build_object('x-tick-secret', tick_secret);
  end if;

  perform net.http_post(
    url := base_url || function_name,
    headers := headers
  );
end;
$$ language plpgsql security definer;
