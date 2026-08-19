// Fixed connection details for a local `supabase start` instance (see
// supabase/config.toml: API on 54321, DB on 54322). The anon/service-role
// keys below are Supabase CLI's well-known local-development demo JWTs --
// the same for every local project unless config.toml overrides them -- so
// hardcoding them here is standard practice, not a secret leak. Override via
// env vars if a given machine's local stack uses different ports/keys.
//
// Deliberately isolated from `.env.local`, which points at the *hosted*
// project (see Documents/AI_GUIDE.md) -- the finance test suite must never
// run against that.

export const LOCAL_SUPABASE_URL = process.env.FINANCE_TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";

export const LOCAL_SUPABASE_ANON_KEY =
  process.env.FINANCE_TEST_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  process.env.FINANCE_TEST_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export const LOCAL_SUPABASE_JWT_SECRET =
  process.env.FINANCE_TEST_SUPABASE_JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
