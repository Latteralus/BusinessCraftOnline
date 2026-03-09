# LifeCraftOnline

This repository has been initialized using the architecture and economy documents in `Documents/`.

## Local Development & Cron Jobs
The game relies on Supabase Edge Functions invoked by `pg_cron` for game ticks (manufacturing, wages, etc).
During local development, the local Postgres container uses `pg_net` to `POST` to `host.docker.internal:54321`.

### Setup steps for local cron ticks:
1. Make sure your local `.env.local` contains `SUPABASE_SERVICE_ROLE_KEY` (use `supabase status` to find it).
2. Generate/set a shared tick secret locally:
   `powershell -ExecutionPolicy Bypass -File scripts/set-tick-secret.ps1`
   This updates `.env.local` and `supabase/functions/.env.local`.
3. Configure the database so `invoke_edge_function(...)` can forward the same secret in `x-tick-secret`:
   Hosted (recommended): store it in Vault:
   `select vault.create_secret('YOUR_TICK_FUNCTION_SECRET', 'edge_function_tick_secret', 'Tick secret');`
   Local fallback: `ALTER DATABASE postgres SET app.settings.edge_function_tick_secret = 'YOUR_TICK_FUNCTION_SECRET';`
4. For testing ticks without waiting 10 minutes, you can manually trigger edge functions:
   `supabase functions serve`
   And then cURL them or let the local cron job trigger them.

Note on Production: You must set the database parameters to point to your hosted functions:
```sql
ALTER DATABASE postgres SET app.settings.edge_function_base_url = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/';
ALTER DATABASE postgres SET app.settings.edge_function_auth = 'Bearer YOUR_ANON_KEY';
ALTER DATABASE postgres SET app.settings.edge_function_tick_secret = 'YOUR_TICK_FUNCTION_SECRET';

-- Hosted alternative (no ALTER DATABASE permission required):
select vault.create_secret('YOUR_TICK_FUNCTION_SECRET', 'edge_function_tick_secret', 'Tick secret');
```

## Current Status
- Phase 0 scaffold complete.
- No domain implementations are locked yet.

## Next Steps
1. Install dependencies: `npm install`
2. Initialize Supabase local stack (if needed): `supabase init` then `supabase start`
3. Begin Phase 1 (`auth-character`) with migrations and generated types.
