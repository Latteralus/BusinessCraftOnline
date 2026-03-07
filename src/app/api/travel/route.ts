import {
  calculateTravelQuote,
  cancelTravel,
  getActiveTravel,
  getCityById,
  startTravel,
  startTravelSchema,
} from "@/domains/cities-travel";
import { getCharacter } from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

function hasArrived(isoDate: string) {
  return new Date(isoDate).getTime() <= Date.now();
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const character = await getCharacter(supabase, user.id);
  if (!character) {
    return NextResponse.json({ error: "Character not found." }, { status: 404 });
  }

  let activeTravel = await getActiveTravel(supabase, user.id);

  if (activeTravel && hasArrived(activeTravel.arrives_at)) {
    const { data: completion, error: completionError } = await supabase.rpc(
      "execute_complete_active_travel_if_due"
    );
    if (completionError) {
      return NextResponse.json(
        { error: completionError.message || "Failed to complete travel arrival." },
        { status: 500 }
      );
    }

    const completedTravel =
      completion && typeof completion === "object" && "travel" in completion
        ? ((completion as { travel?: unknown }).travel as Record<string, unknown> | null)
        : null;

    if (completedTravel) {
      activeTravel = null;
    } else {
      activeTravel = await getActiveTravel(supabase, user.id);
    }
  }

  const freshCharacter = await getCharacter(supabase, user.id);
  const currentCity = freshCharacter?.current_city_id
    ? await getCityById(supabase, freshCharacter.current_city_id)
    : null;

  return NextResponse.json({
    currentCity,
    activeTravel,
    canPurchaseBusiness: !activeTravel,
  });
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
  const parsed = startTravelSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const character = await getCharacter(supabase, user.id);
  if (!character) {
    return NextResponse.json({ error: "Character not found." }, { status: 404 });
  }

  if (!character.current_city_id) {
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

  const existingTravel = await getActiveTravel(supabase, user.id);
  if (existingTravel) {
    return NextResponse.json(
      { error: "You are already traveling.", travel: existingTravel },
      { status: 409 }
    );
  }

  let quote;
  try {
    quote = calculateTravelQuote(fromCity, toCity);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid travel route." },
      { status: 400 }
    );
  }

  const arrivesAt = new Date(Date.now() + quote.minutes * 60_000).toISOString();

  const travel = await startTravel(supabase, {
    playerId: user.id,
    fromCityId: fromCity.id,
    toCityId: toCity.id,
    cost: quote.cost,
    arrivesAt,
  });

  return NextResponse.json({ travel, quote }, { status: 201 });
}

export async function DELETE() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const activeTravel = await getActiveTravel(supabase, user.id);
  if (!activeTravel) {
    return NextResponse.json({ error: "No active travel found." }, { status: 404 });
  }

  const cancelledTravel = await cancelTravel(supabase, user.id, activeTravel.id);
  return NextResponse.json({ travel: cancelledTravel });
}
