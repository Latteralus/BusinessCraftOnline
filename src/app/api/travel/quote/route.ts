import {
  calculateTravelQuote,
  getCityById,
  startTravelSchema,
} from "@/domains/cities-travel";
import { getCharacter } from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = startTravelSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const character = await getCharacter(supabase, user.id);
  if (!character?.current_city_id) {
    return NextResponse.json(
      { error: "Character does not currently have a city." },
      { status: 400 }
    );
  }

  const [fromCity, toCity] = await Promise.all([
    getCityById(supabase, character.current_city_id),
    getCityById(supabase, parsed.data.toCityId),
  ]);

  if (!fromCity || !toCity) {
    return NextResponse.json(
      { error: "Origin or destination city not found." },
      { status: 404 }
    );
  }

  try {
    const quote = calculateTravelQuote(fromCity, toCity);
    return NextResponse.json({ quote });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid travel route." },
      { status: 400 }
    );
  }
}

