import { cancelMarketBuyOrder, cancelMarketBuyOrderSchema } from "@/domains/market";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const parsed = cancelMarketBuyOrderSchema.safeParse({ buyOrderId: id });
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid buy order id.");
    }

    const buyOrder = await cancelMarketBuyOrder(supabase, user.id, parsed.data);
    return NextResponse.json({ buyOrder });
  }, { errorMessage: "Failed to cancel buy order." });
}
