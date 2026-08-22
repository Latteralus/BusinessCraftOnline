import { fulfillMarketBuyOrder, fulfillMarketBuyOrderSchema } from "@/domains/market";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = fulfillMarketBuyOrderSchema.safeParse({
      buyOrderId: id,
      quantity: body.quantity,
      sourceType: body.sourceType,
      sourceBusinessId: body.sourceBusinessId,
      sourceBusinessInventoryId: body.sourceBusinessInventoryId,
      sourcePersonalInventoryId: body.sourcePersonalInventoryId,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid fulfillment payload.");
    }

    const result = await fulfillMarketBuyOrder(supabase, user.id, parsed.data);
    return NextResponse.json(result);
  }, { errorMessage: "Failed to fulfill buy order." });
}
