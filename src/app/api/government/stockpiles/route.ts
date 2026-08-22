import { getProjectedCityStockpiles, type CityStockpilesResponse } from "@/domains/government";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return handleAuthedRequest(async ({ supabase }) => {
    const cityId = request.nextUrl.searchParams.get("cityId") ?? undefined;
    const stockpiles = await getProjectedCityStockpiles(supabase, cityId);
    const response: CityStockpilesResponse = { stockpiles };
    return NextResponse.json(response);
  });
}
