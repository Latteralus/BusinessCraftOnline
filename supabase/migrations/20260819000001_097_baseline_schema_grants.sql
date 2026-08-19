-- Not part of AccountingFixPlan itself, but discovered while building its
-- Phase A test infrastructure and required to unblock it: a clean local
-- `supabase start` + migration replay leaves `anon`/`authenticated`/
-- `service_role` with NO base table privileges (not even SELECT) on tables
-- created by our migrations, because every migration runs as role
-- `postgres`, and this database's `pg_default_acl` only grants full table
-- privileges to those three roles for objects created by `supabase_admin`
-- (confirmed via `select * from pg_default_acl where defaclnamespace =
-- 'public'::regnamespace` -- postgres's own default-ACL row for anon/
-- authenticated/service_role is `Dxtm` only: truncate/references/trigger/
-- maintain, missing select/insert/update/delete entirely).
--
-- This is invisible on the hosted project because Supabase's control plane
-- grants these automatically outside of migration history, and it's
-- invisible if you never do a from-scratch local `supabase db reset` --
-- but it means a genuinely clean local replay (e.g. CI, or this test suite)
-- cannot read even RLS-less reference tables like `cities` at all
-- ("permission denied for table cities"), let alone anything gated by RLS
-- (RLS policies only restrict rows on top of an existing base grant; they
-- don't substitute for one).
--
-- service_role already has BYPASSRLS, so granting it ALL here is exactly
-- its intended trust level. anon/authenticated still go through RLS on
-- every table that has it enabled; this only restores the base
-- select/insert/update/delete privilege RLS itself depends on -- it does
-- not weaken any existing policy.
--
-- Also fixes it going forward: ALTER DEFAULT PRIVILEGES here is scoped to
-- objects postgres creates from now on, so a future migration's new table
-- doesn't reintroduce this gap.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Migration complete: restore baseline anon/authenticated/service_role table grants for objects owned by `postgres`.
