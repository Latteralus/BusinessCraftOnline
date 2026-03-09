import { getCharacter, loginSchema } from "@/domains/auth-character";
import { signCustomJwt } from "@/lib/auth-jwt";
import {
  CUSTOM_SESSION_COOKIE_NAME,
  CUSTOM_SESSION_TTL_SECONDS,
} from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const { username, password } = parsed.data;

    // Use RPC to verify password securely
    const { data: playerId, error } = await supabase.rpc("authenticate_player", {
      p_username: username,
      p_password: password,
    });

    if (error || !playerId) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }

    // Since we are no longer using Supabase Auth, we don't upsert the player here,
    // they are already in the DB. We just sign a token.
    const token = await signCustomJwt(playerId);

    const cookieStore = await cookies();
    cookieStore.set(CUSTOM_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
      maxAge: CUSTOM_SESSION_TTL_SECONDS,
    });

    // Check if character exists using the newly minted JWT by injecting it
    // Wait, the currently initialized supabase client doesn't have the token yet!
    // We can just initialize a new one with the token, or pass the token manually.
    // Actually, `createSupabaseServerClient` reads from `cookies()`. In Next.js App Router,
    // setting a cookie makes it immediately readable from `cookies().get()` in the same route.
    const { createClient } = require("@supabase/supabase-js");
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const character = await getCharacter(authClient, playerId);

    return NextResponse.json({
      userId: playerId,
      needsCharacterSetup: !character,
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during login." },
      { status: 500 }
    );
  }
}
