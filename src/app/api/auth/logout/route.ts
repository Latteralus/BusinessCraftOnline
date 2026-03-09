import { CUSTOM_SESSION_COOKIE_NAME } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOM_SESSION_COOKIE_NAME);

  return NextResponse.json({ ok: true });
}
