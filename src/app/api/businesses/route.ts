import {
  type BusinessesPayload,
  type CreateBusinessResponse,
  businessListFilterSchema,
  createBusiness,
  createBusinessSchema,
  getBusinessesWithBalances,
  summarizeBusinessesWithBalances,
} from "@/domains/businesses";
import { getCharacter } from "@/domains/auth-character";
import {
  badRequest,
  handleAuthedJsonRequest,
  handleAuthedRequest,
} from "@/app/api/_shared/route-helpers";
import { withTiming } from "@/lib/server-timing";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const rawFilters = {
      type: url.searchParams.get("type") ?? undefined,
      cityId: url.searchParams.get("cityId") ?? undefined,
    };

    const parsed = businessListFilterSchema.safeParse(rawFilters);
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid filters.");
    }

    return withTiming("api-route", "/api/businesses GET", async (timing) => {
      const businesses = await timing.measure("businesses-with-balances", () =>
        getBusinessesWithBalances(supabase, user.id, parsed.data)
      );
      const summary = summarizeBusinessesWithBalances(businesses);
      const response: BusinessesPayload = { businesses, summary };

      return NextResponse.json(response);
    });
  }, { errorMessage: "Failed to fetch businesses.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    createBusinessSchema,
    "Invalid business creation payload.",
    async ({ supabase, user }, data) => {
      const character = await getCharacter(supabase, user.id);
      if (!character?.current_city_id) {
        return badRequest("Character city is required before creating a business.");
      }

      const business = await createBusiness(
        supabase,
        user.id,
        character.current_city_id,
        data
      );
      const response: CreateBusinessResponse = { business };

      return NextResponse.json(response, { status: 201 });
    },
    { errorMessage: "Failed to create business." }
  );
}
