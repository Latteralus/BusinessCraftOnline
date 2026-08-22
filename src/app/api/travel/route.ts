import {
  type CancelTravelResponse,
  type StartTravelResponse,
  type TravelState,
  calculateTravelQuote,
  cancelTravel,
  getActiveTravel,
  getCityById,
  startTravel,
  startTravelSchema,
} from "@/domains/cities-travel";
import { getCharacter } from "@/domains/auth-character";
import { badRequest, handleAuthedRequest, notFound } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

function hasArrived(isoDate: string) {
  return new Date(isoDate).getTime() <= Date.now();
}

export async function GET() {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const character = await getCharacter(supabase, user.id);
    if (!character) {
      return notFound("Character not found.");
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
    const response: TravelState = {
      currentCity,
      activeTravel,
      canPurchaseBusiness: !activeTravel,
    };

    return NextResponse.json(response);
  });
}

export async function POST(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const payload = await request.json().catch(() => null);
    const parsed = startTravelSchema.safeParse(payload);

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid input.");
    }

    const character = await getCharacter(supabase, user.id);
    if (!character) {
      return notFound("Character not found.");
    }

    if (!character.current_city_id) {
      return badRequest("Character does not currently have a city.");
    }

    const [fromCity, toCity] = await Promise.all([
      getCityById(supabase, character.current_city_id),
      getCityById(supabase, parsed.data.toCityId),
    ]);

    if (!fromCity || !toCity) {
      return notFound("Origin or destination city not found.");
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
      quote = await calculateTravelQuote(supabase, fromCity, toCity);
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
    const response: StartTravelResponse = { travel, quote };

    return NextResponse.json(response, { status: 201 });
  });
}

export async function DELETE() {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const activeTravel = await getActiveTravel(supabase, user.id);
    if (!activeTravel) {
      return notFound("No active travel found.");
    }

    const cancelledTravel = await cancelTravel(supabase, user.id, activeTravel.id);
    const response: CancelTravelResponse = { travel: cancelledTravel };
    return NextResponse.json(response);
  });
}
