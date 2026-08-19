import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

// Server-only client authenticated as the Postgres `service_role`. Bypasses
// RLS entirely, so only use it for RPCs that are locked down to
// service_role precisely because they must never be reachable with a
// player's own JWT (e.g. the internal ledger-append helpers).
//
// Deliberately kept in its own module with no "next/headers" import: the
// domain service files that call this (businesses/service.ts,
// banking/service.ts) are also imported by client components for read-only
// queries, and pulling "next/headers" transitively into that module graph
// breaks the client build. ./env has the same constraint (see its own
// comment) so it's safe to import here.
export function createSupabaseServiceRoleClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
    },
  });
}
