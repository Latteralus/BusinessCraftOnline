import { getCityRoutes, type CityRoutesResponse } from "@/domains/cities-travel";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return handleAuthedRequest(async ({ supabase }) => {
    const fromCityId = request.nextUrl.searchParams.get("fromCityId") ?? undefined;
    const routes = await getCityRoutes(supabase, fromCityId);
    const response: CityRoutesResponse = { routes };
    return NextResponse.json(response);
  });
}
