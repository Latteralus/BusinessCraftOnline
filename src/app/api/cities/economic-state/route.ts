import {
  getCityEconomicState,
  getWorldEconomicState,
  type EconomicStateResponse,
} from "@/domains/cities-travel";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return handleAuthedRequest(async ({ supabase }) => {
    const cityId = request.nextUrl.searchParams.get("cityId") ?? undefined;
    const [world, cities] = await Promise.all([
      getWorldEconomicState(supabase),
      getCityEconomicState(supabase, cityId),
    ]);
    const response: EconomicStateResponse = { world, cities };
    return NextResponse.json(response);
  });
}
