-- Migration 040's hosted fallback URL was hardcoded to a Supabase project
-- ref (jckniouvmenfhellqddn) that is no longer this project's ref. Since
-- ALTER DATABASE SET on app.settings.edge_function_base_url is not
-- permitted on hosted Supabase (see migration 039/040), the fallback must
-- be corrected in the function itself rather than overridden at the
-- database level.

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
    base_url := 'https://aroffxhnsjjdtqieeogx.supabase.co/functions/v1/';
  end if;

  if tick_secret is null then
    begin
      execute $vault$
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'edge_function_tick_secret'
        order by created_at desc
        limit 1
      $vault$
      into tick_secret;
    exception
      when others then
        tick_secret := null;
    end;
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
