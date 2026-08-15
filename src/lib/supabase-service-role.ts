import { createClient } from "@supabase/supabase-js";

// Server-only client authenticated as the Postgres `service_role`. Bypasses
// RLS entirely, so only use it for RPCs that are locked down to
// service_role precisely because they must never be reachable with a
// player's own JWT (e.g. the internal ledger-append helpers).
//
// Deliberately kept in its own module with no "next/headers" import: the
// domain service files that call this (businesses/service.ts,
// banking/service.ts) are also imported by client components for read-only
// queries, and pulling "next/headers" transitively into that module graph
// breaks the client build.
export function createSupabaseServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      auth: {
        persistSession: false,
      },
    }
  );
}
