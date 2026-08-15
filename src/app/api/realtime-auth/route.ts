import { verifyCustomJwt } from "@/lib/auth-jwt";
import { CUSTOM_SESSION_COOKIE_NAME } from "@/lib/session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOM_SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // This hands the raw session JWT back to client JS so it can be passed to
  // supabase.realtime.setAuth() — Realtime needs the caller's JWT directly,
  // there's no server-side proxy for it. At minimum, don't hand back a token
  // that isn't actually a valid, unexpired session for this cookie.
  const payload = await verifyCustomJwt(token);
  if (!payload?.sub) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({ token });
}
