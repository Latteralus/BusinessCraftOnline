import { CUSTOM_SESSION_COOKIE_NAME } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  cookies().delete(CUSTOM_SESSION_COOKIE_NAME);

  return NextResponse.json({ ok: true });
}
