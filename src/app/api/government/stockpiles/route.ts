import { getProjectedCityStockpiles, type CityStockpilesResponse } from "@/domains/government";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cityId = request.nextUrl.searchParams.get("cityId") ?? undefined;
  const stockpiles = await getProjectedCityStockpiles(supabase, cityId);
  const response: CityStockpilesResponse = { stockpiles };
  return NextResponse.json(response);
}
