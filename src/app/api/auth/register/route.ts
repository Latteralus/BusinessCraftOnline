import { registerSchema } from "@/domains/auth-character";
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
    const parsed = registerSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { password, username } = parsed.data;

    // Call the Postgres RPC to securely register the player (hashes password)
    const { data: newPlayerId, error } = await supabase.rpc("register_player", {
      p_username: username,
      p_password: password,
      p_email: null, // Email isn't needed anymore
    });

    if (error || !newPlayerId) {
      // Postgres might throw an error if username already exists, etc.
      return NextResponse.json(
        { error: error?.message ?? "Registration failed. Username might be taken." },
        { status: 400 }
      );
    }

    // Sign our custom JWT
    const token = await signCustomJwt(newPlayerId);

    // Set as an HttpOnly cookie so the client sends it automatically
    cookies().set(CUSTOM_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
      maxAge: CUSTOM_SESSION_TTL_SECONDS,
    });

    return NextResponse.json({
      userId: newPlayerId,
      requiresEmailVerification: false,
      message: "Registration complete.",
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during registration." },
      { status: 500 }
    );
  }
}
