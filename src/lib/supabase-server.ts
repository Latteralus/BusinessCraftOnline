import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { verifyCustomJwt } from "./auth-jwt";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const customToken = cookieStore.get("custom_session")?.value;

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
    if (!customToken) {
      console.error("[supabase-server] No custom_session cookie found!");
      return { data: { user: null }, error: null } as any;
    }
    
    try {
      const payload = await verifyCustomJwt(customToken);
      if (!payload || !payload.sub) {
        console.error("[supabase-server] verifyCustomJwt returned no payload/sub", payload);
        return { data: { user: null }, error: null } as any;
      }
      return { data: { user: { id: payload.sub } }, error: null } as any;
    } catch (e) {
      console.error("[supabase-server] getUser error:", e);
      return { data: { user: null }, error: null } as any;
    }
  };

  return client;
}
