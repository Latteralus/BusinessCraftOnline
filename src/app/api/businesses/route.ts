import {
  businessListFilterSchema,
  createBusiness,
  createBusinessSchema,
  getBusinessesWithBalances,
  summarizeBusinessesWithBalances,
} from "@/domains/businesses";
import { getCharacter } from "@/domains/auth-character";
import {
  badRequest,
  fail,
  parseJsonBody,
  requireAuthedUser,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const url = new URL(request.url);
  const rawFilters = {
    type: url.searchParams.get("type") ?? undefined,
    cityId: url.searchParams.get("cityId") ?? undefined,
  };

  const parsed = businessListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid filters.");
  }

  try {
    const businesses = await getBusinessesWithBalances(supabase, user.id, parsed.data);
    const summary = summarizeBusinessesWithBalances(businesses);

    return NextResponse.json({ businesses, summary });
  } catch (error) {
    return fail(error, "Failed to fetch businesses.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = await parseJsonBody(
    request,
    createBusinessSchema,
    "Invalid business creation payload."
  );
  if (!parsed.ok) return parsed.response;

  const character = await getCharacter(supabase, user.id);
  if (!character?.current_city_id) {
    return badRequest("Character city is required before creating a business.");
  }

  try {
    const business = await createBusiness(
      supabase,
      user.id,
      character.current_city_id,
      parsed.data
    );

    return NextResponse.json({ business }, { status: 201 });
  } catch (error) {
    return fail(error, "Failed to create business.");
  }
}
