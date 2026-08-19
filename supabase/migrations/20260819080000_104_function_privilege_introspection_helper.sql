-- Test/CI-only introspection helper for the RPC-permission regression suite
-- (test/db/rpc-permissions.test.ts). Returns, for every function in the
-- public schema, whether it is SECURITY DEFINER and whether anon/
-- authenticated/public currently have EXECUTE on it -- lets the test suite
-- assert against the documented allowlist in test/db/rpc-allowlist.ts
-- without needing a raw superuser Postgres connection from the test runner.
--
-- service_role only: this exposes privilege metadata, not application data,
-- but there's no reason for it to be player-reachable.

create or replace function public._introspect_function_privileges()
returns table (
  function_name text,
  arg_types text,
  is_security_definer boolean,
  public_can_execute boolean,
  anon_can_execute boolean,
  authenticated_can_execute boolean,
  service_role_can_execute boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.proname::text as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as arg_types,
    p.prosecdef as is_security_definer,
    has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname <> '_introspect_function_privileges';
$$;

revoke execute on function public._introspect_function_privileges() from public, anon, authenticated, service_role;
grant execute on function public._introspect_function_privileges() to service_role;
