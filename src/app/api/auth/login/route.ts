import { getCharacter, loginSchema } from "@/domains/auth-character";
import { signCustomJwt } from "@/lib/auth-jwt";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import {
  CUSTOM_SESSION_COOKIE_NAME,
  CUSTOM_SESSION_TTL_SECONDS,
} from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase-service-role";
import { createClient } from "@supabase/supabase-js";
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

    // Fetch the player's app-level role once at login so it can be embedded
    // in the session JWT (see signCustomJwt / M6 in changelog 2026-08-17) --
    // this is the only place that role needs a DB round trip anymore. Uses
    // the service-role client because no session JWT exists yet at this
    // point in the flow -- players_select_own RLS would otherwise return
    // nothing (auth.uid() is null) and silently default every login to
    // "player", including real admins.
    const serviceClient = createSupabaseServiceRoleClient();
    const { data: playerRow } = await serviceClient.from("players").select("role").eq("id", playerId).maybeSingle();
    const appRole = playerRow?.role === "admin" ? "admin" : "player";

    // Since we are no longer using Supabase Auth, we don't upsert the player here,
    // they are already in the DB. We just sign a token.
    const token = await signCustomJwt(playerId, appRole);

    const cookieStore = await cookies();
    cookieStore.set(CUSTOM_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
      maxAge: CUSTOM_SESSION_TTL_SECONDS,
    });

    // Check if character exists using the newly minted JWT.
    // `createSupabaseServerClient` reads from cookies(), but we need the token
    // active immediately, so we use a direct client with the JWT as a header.
    const authClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

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
