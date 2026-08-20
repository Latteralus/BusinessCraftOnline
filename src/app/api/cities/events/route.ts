import {
  getActiveCityEvents,
  getActiveWorldEvents,
  type EconomicEventsResponse,
} from "@/domains/cities-travel";
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
  const [worldEvents, cityEvents] = await Promise.all([
    getActiveWorldEvents(supabase),
    getActiveCityEvents(supabase, cityId),
  ]);
  const response: EconomicEventsResponse = { worldEvents, cityEvents };
  return NextResponse.json(response);
}
