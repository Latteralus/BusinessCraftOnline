import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { verifyCustomJwt } from "./auth-jwt";
import { CUSTOM_SESSION_COOKIE_NAME } from "./session";

const getCachedServerUser = cache(async () => {
  const cookieStore = await cookies();
  const customToken = cookieStore.get(CUSTOM_SESSION_COOKIE_NAME)?.value;

  if (!customToken) {
    return { user: null, token: null };
  }

  try {
    const payload = await verifyCustomJwt(customToken);
    if (!payload?.sub) {
      return { user: null, token: customToken };
    }

    return { user: { id: payload.sub }, token: customToken };
  } catch {
    return { user: null, token: customToken };
  }
});

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const customToken = cookieStore.get(CUSTOM_SESSION_COOKIE_NAME)?.value;

  const headers: Record<string, string> = {};
  if (customToken) {
    headers.Authorization = `Bearer ${customToken}`;
  }

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      global: { headers },
      auth: {
        persistSession: false,
      },
    }
  );

  client.auth.getUser = async () => {
    const { user } = await getCachedServerUser();
    return { data: { user }, error: null } as any;
  };

  return client;
}

// Server-only client authenticated as the Postgres `service_role`. Bypasses
// RLS entirely, so only use it for RPCs that are locked down to
// service_role precisely because they must never be reachable with a
// player's own JWT (e.g. the internal ledger-append helpers).
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
