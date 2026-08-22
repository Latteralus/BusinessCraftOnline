import { getStorefrontPerformanceForBusiness } from "@/domains/market";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const businessId = url.searchParams.get("businessId");
    const windowHours = Number(url.searchParams.get("windowHours") ?? "24");

    if (!businessId) {
      return badRequest("businessId is required.");
    }

    const performance = await getStorefrontPerformanceForBusiness(
      supabase,
      user.id,
      businessId,
      Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24
    );
    return NextResponse.json({ performance });
  }, { errorMessage: "Failed to load storefront performance.", errorStatus: 500 });
}
