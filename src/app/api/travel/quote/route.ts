import {
  calculateTravelQuote,
  getCityById,
  startTravelSchema,
} from "@/domains/cities-travel";
import { getCharacter } from "@/domains/auth-character";
import {
  badRequest,
  fail,
  handleAuthedJsonRequest,
  notFound,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    startTravelSchema,
    "Invalid input.",
    async ({ supabase, user }, data) => {
      const character = await getCharacter(supabase, user.id);
      if (!character?.current_city_id) {
        return badRequest("Character does not currently have a city.");
      }

      const [fromCity, toCity] = await Promise.all([
        getCityById(supabase, character.current_city_id),
        getCityById(supabase, data.toCityId),
      ]);

      if (!fromCity || !toCity) {
        return notFound("Origin or destination city not found.");
      }

      try {
        const quote = calculateTravelQuote(fromCity, toCity);
        return NextResponse.json({ quote });
      } catch (error) {
        return fail(error, "Invalid travel route.");
      }
    }
  );
}
