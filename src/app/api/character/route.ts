import {
  createCharacter,
  createCharacterSchema,
  getCharacter,
  upsertPlayerFromAuthUser,
} from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const character = await getCharacter(supabase, user.id);
  return NextResponse.json({ character });
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = createCharacterSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const existing = await getCharacter(supabase, user.id);
  if (existing) {
    return NextResponse.json(
      { error: "Character already exists.", character: existing },
      { status: 409 }
    );
  }

  const username =
    typeof user.user_metadata?.username === "string"
      ? user.user_metadata.username
      : undefined;
  await upsertPlayerFromAuthUser(supabase, user, username);
  const character = await createCharacter(supabase, user.id, parsed.data);

  return NextResponse.json({ character }, { status: 201 });
}
