import { getCityResourceModifiers, type CityResourceModifiersResponse } from "@/domains/cities-travel";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return handleAuthedRequest(async ({ supabase }) => {
    const cityId = request.nextUrl.searchParams.get("cityId") ?? undefined;
    const resourceModifiers = await getCityResourceModifiers(supabase, cityId);
    const response: CityResourceModifiersResponse = { resourceModifiers };
    return NextResponse.json(response);
  });
}
