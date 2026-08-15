import { fulfillMarketBuyOrder, fulfillMarketBuyOrderSchema } from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid fulfillment payload." },
      { status: 400 }
    );
  }

  try {
    const result = await fulfillMarketBuyOrder(supabase, user.id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
          ? error.message
          : "Failed to fulfill buy order.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
