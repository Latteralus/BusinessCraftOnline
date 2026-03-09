import { getCities, type CitiesPayload } from "@/domains/cities-travel";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cities = await getCities(supabase);
  const response: CitiesPayload = { cities };
  return NextResponse.json(response);
}
