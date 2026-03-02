import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const customToken = cookieStore.get("custom_session")?.value;

  const headers: Record<string, string> = {};
  if (customToken) {
    headers.Authorization = `Bearer ${customToken}`;
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      global: { headers },
      auth: {
        persistSession: false,
      },
    }
  );
}
