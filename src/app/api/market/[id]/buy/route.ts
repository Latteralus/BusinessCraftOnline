import { buyMarketListing, buyMarketListingSchema } from "@/domains/market";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = buyMarketListingSchema.safeParse({
      listingId: id,
      quantity: body.quantity,
      buyerBusinessId: body.buyerBusinessId,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid buy payload.");
    }

    const result = await buyMarketListing(supabase, user.id, parsed.data);
    return NextResponse.json(result);
  }, { errorMessage: "Failed to buy listing." });
}
