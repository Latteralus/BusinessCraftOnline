-- Fix invoke_edge_function fallbacks:
-- 1) Never default to a hard-coded external project URL/key.
-- 2) Keep local-dev fallback to host.docker.internal.
-- 3) Allow verify_jwt=false functions to run without Authorization when auth setting is missing.

CREATE OR REPLACE FUNCTION invoke_edge_function(function_name text)
RETURNS void AS $$
DECLARE
  base_url text;
  auth_header text;
  headers jsonb;
BEGIN
  base_url := nullif(current_setting('app.settings.edge_function_base_url', true), '');
  auth_header := nullif(current_setting('app.settings.edge_function_auth', true), '');

  IF base_url IS NULL THEN
    base_url := 'http://host.docker.internal:54321/functions/v1/';
  END IF;

  headers := jsonb_build_object('Content-Type', 'application/json');
  IF auth_header IS NOT NULL THEN
    headers := headers || jsonb_build_object('Authorization', auth_header);
  END IF;

  PERFORM net.http_post(
    url := base_url || function_name,
    headers := headers
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
