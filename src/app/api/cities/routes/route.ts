import { getCityRoutes, type CityRoutesResponse } from "@/domains/cities-travel";
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

  const fromCityId = request.nextUrl.searchParams.get("fromCityId") ?? undefined;
  const routes = await getCityRoutes(supabase, fromCityId);
  const response: CityRoutesResponse = { routes };
  return NextResponse.json(response);
}
