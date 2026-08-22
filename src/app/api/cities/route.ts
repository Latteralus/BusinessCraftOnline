import { getCities, type CitiesPayload } from "@/domains/cities-travel";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET() {
  return handleAuthedRequest(async ({ supabase }) => {
    const cities = await getCities(supabase);
    const response: CitiesPayload = { cities };
    return NextResponse.json(response);
  });
}
