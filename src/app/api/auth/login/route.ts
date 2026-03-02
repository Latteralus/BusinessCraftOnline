import {
  getCharacter,
  loginSchema,
  upsertPlayerFromAuthUser,
} from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
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

    const supabase = createSupabaseServerClient();
    const { email, password } = parsed.data;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? "Login failed." },
        { status: 401 }
      );
    }

    const requestedUsername =
      typeof data.user.user_metadata?.username === "string"
        ? data.user.user_metadata.username
        : undefined;

    await upsertPlayerFromAuthUser(supabase, data.user, requestedUsername);
    const character = await getCharacter(supabase, data.user.id);

    return NextResponse.json({
      userId: data.user.id,
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
