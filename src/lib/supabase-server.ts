import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { verifyCustomJwt } from "./auth-jwt";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";
import { CUSTOM_SESSION_COOKIE_NAME } from "./session";

export const getCachedServerUser = cache(async () => {
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

    const appRole = payload.app_role === "admin" ? "admin" : "player";
    return { user: { id: payload.sub, appRole }, token: customToken };
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

  const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers },
    auth: {
      persistSession: false,
    },
  });

  client.auth.getUser = async () => {
    const { user } = await getCachedServerUser();
    return { data: { user }, error: null } as any;
  };

  return client;
}
