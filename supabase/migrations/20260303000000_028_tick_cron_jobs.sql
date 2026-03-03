-- Enable the pg_net extension to make HTTP requests from Postgres
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper function to invoke an Edge Function using database settings.
-- This allows different configurations for local development vs production.
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
    base_url := 'http://host.docker.internal:54321/functions/v1/';
  END IF;

  IF auth_header IS NULL OR auth_header = '' THEN
    auth_header := 'Bearer REPLACE_WITH_ANON_KEY';
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

-- Clear any existing jobs to prevent duplicates
DO $$
BEGIN
  PERFORM cron.unschedule('tick-extraction');
EXCEPTION WHEN OTHERS THEN END;
$$;
DO $$
BEGIN
  PERFORM cron.unschedule('tick-manufacturing');
EXCEPTION WHEN OTHERS THEN END;
$$;
DO $$
BEGIN
  PERFORM cron.unschedule('tick-npc-purchases');
EXCEPTION WHEN OTHERS THEN END;
$$;
DO $$
BEGIN
  PERFORM cron.unschedule('tick-wages');
EXCEPTION WHEN OTHERS THEN END;
$$;
DO $$
BEGIN
  PERFORM cron.unschedule('tick-shipping');
EXCEPTION WHEN OTHERS THEN END;
$$;
DO $$
BEGIN
  PERFORM cron.unschedule('tick-travel');
EXCEPTION WHEN OTHERS THEN END;
$$;

-- Schedule the ticks according to the Technical Architecture Document

-- 1. tick-extraction (Every 1 minute)
SELECT cron.schedule('tick-extraction', '* * * * *', $$ SELECT invoke_edge_function('tick-extraction') $$);

-- 2. tick-manufacturing (Every 10 minutes)
SELECT cron.schedule('tick-manufacturing', '*/10 * * * *', $$ SELECT invoke_edge_function('tick-manufacturing') $$);

-- 3. tick-npc-purchases (Every 10 minutes)
SELECT cron.schedule('tick-npc-purchases', '*/10 * * * *', $$ SELECT invoke_edge_function('tick-npc-purchases') $$);

-- 4. tick-wages (Every 1 hour)
SELECT cron.schedule('tick-wages', '0 * * * *', $$ SELECT invoke_edge_function('tick-wages') $$);

-- 5. tick-shipping (Every 5 minutes)
SELECT cron.schedule('tick-shipping', '*/5 * * * *', $$ SELECT invoke_edge_function('tick-shipping') $$);

-- 6. tick-travel (Every 1 minute)
SELECT cron.schedule('tick-travel', '* * * * *', $$ SELECT invoke_edge_function('tick-travel') $$);

-- Migration complete: Add pg_cron extensions and configure tick schedule
