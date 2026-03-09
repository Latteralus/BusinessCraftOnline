import {
  createCharacter,
  createCharacterSchema,
  getCharacter,
} from "@/domains/auth-character";
import {
  handleAuthedJsonRequest,
  handleAuthedRequest,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET() {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const character = await getCharacter(supabase, user.id);
    return NextResponse.json({ character });
  });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    createCharacterSchema,
    "Invalid input.",
    async ({ supabase, user }, data) => {
      const existing = await getCharacter(supabase, user.id);
      if (existing) {
        return NextResponse.json(
          { error: "Character already exists.", character: existing },
          { status: 409 }
        );
      }

      const character = await createCharacter(supabase, user.id, data);
      return NextResponse.json({ character }, { status: 201 });
    }
  );
}
