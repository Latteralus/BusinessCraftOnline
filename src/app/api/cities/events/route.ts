import {
  getActiveCityEvents,
  getActiveWorldEvents,
  type EconomicEventsResponse,
} from "@/domains/cities-travel";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return handleAuthedRequest(async ({ supabase }) => {
    const cityId = request.nextUrl.searchParams.get("cityId") ?? undefined;
    const [worldEvents, cityEvents] = await Promise.all([
      getActiveWorldEvents(supabase),
      getActiveCityEvents(supabase, cityId),
    ]);
    const response: EconomicEventsResponse = { worldEvents, cityEvents };
    return NextResponse.json(response);
  });
}
