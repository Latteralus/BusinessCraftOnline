import { cancelMarketListing, cancelMarketListingSchema } from "@/domains/market";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const parsed = cancelMarketListingSchema.safeParse({ listingId: id });
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid listing id.");
    }

    const listing = await cancelMarketListing(supabase, user.id, parsed.data);
    return NextResponse.json({ listing });
  }, { errorMessage: "Failed to cancel listing." });
}
