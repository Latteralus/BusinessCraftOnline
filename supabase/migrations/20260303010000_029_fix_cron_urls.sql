CREATE OR REPLACE FUNCTION invoke_edge_function(function_name text) 
RETURNS void AS $$
DECLARE
  base_url text;
  auth_header text;
BEGIN
  -- In production, set these using:
  -- ALTER DATABASE postgres SET app.settings.edge_function_base_url = 'https://YOUR_REF.supabase.co/functions/v1/';
  -- ALTER DATABASE postgres SET app.settings.edge_function_auth = 'Bearer YOUR_ANON_KEY';
  
  base_url := current_setting('app.settings.edge_function_base_url', true);
  auth_header := current_setting('app.settings.edge_function_auth', true);
  
  IF base_url IS NULL OR base_url = '' THEN
    base_url := 'https://jckniouvmenfhellqddn.supabase.co/functions/v1/';
  END IF;

  IF auth_header IS NULL OR auth_header = '' THEN
    auth_header := 'Bearer sb_publishable_bVVYngkgqFokZ3xx1xXPhg_O1EcvWyN';
  END IF;

  PERFORM net.http_post(
    url := base_url || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', auth_header
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
