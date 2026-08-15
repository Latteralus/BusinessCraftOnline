import { cancelMarketBuyOrder, cancelMarketBuyOrderSchema } from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = cancelMarketBuyOrderSchema.safeParse({ buyOrderId: id });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid buy order id." },
      { status: 400 }
    );
  }

  try {
    const buyOrder = await cancelMarketBuyOrder(supabase, user.id, parsed.data);
    return NextResponse.json({ buyOrder });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel buy order." },
      { status: 400 }
    );
  }
}
