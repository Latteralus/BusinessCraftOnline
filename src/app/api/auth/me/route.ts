import { getCharacter, getPlayer } from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ user: null, player: null, character: null });
  }

  const [player, character] = await Promise.all([
    getPlayer(supabase, user.id),
    getCharacter(supabase, user.id),
  ]);

  return NextResponse.json({
    user: { id: user.id, email: user.email ?? null },
    player,
    character,
  });
}
