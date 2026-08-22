import {
  getMarketStorefrontSettings,
  marketStorefrontFilterSchema,
  updateMarketStorefrontSettings,
  updateMarketStorefrontSettingsSchema,
} from "@/domains/market";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const parsed = marketStorefrontFilterSchema.safeParse({
      businessId: url.searchParams.get("businessId") ?? undefined,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid storefront query.");
    }

    const storefront = await getMarketStorefrontSettings(supabase, user.id, parsed.data);
    return NextResponse.json({ storefront });
  }, { errorMessage: "Failed to load storefront settings.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    updateMarketStorefrontSettingsSchema,
    "Invalid storefront payload.",
    async ({ supabase, user }, data) => {
      const storefront = await updateMarketStorefrontSettings(supabase, user.id, data);
      return NextResponse.json({ storefront });
    },
    { errorMessage: "Failed to update storefront settings." }
  );
}
