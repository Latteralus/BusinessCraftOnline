import {
  createMarketBuyOrder,
  createMarketBuyOrderSchema,
  getMarketBuyOrders,
  marketBuyOrderFilterSchema,
} from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "50") || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);

  const parsed = marketBuyOrderFilterSchema.safeParse({
    cityId: url.searchParams.get("cityId") ?? undefined,
    itemKey: url.searchParams.get("itemKey") ?? undefined,
    status: url.searchParams.get("status") ?? "active",
    ownOnly:
      url.searchParams.get("ownOnly") === null
        ? undefined
        : url.searchParams.get("ownOnly") === "true",
    limit,
    offset,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid buy order query." },
      { status: 400 }
    );
  }

  try {
    const buyOrders = await getMarketBuyOrders(supabase, user.id, parsed.data);
    return NextResponse.json({ buyOrders });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load buy orders." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = createMarketBuyOrderSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid buy order payload." },
      { status: 400 }
    );
  }

  try {
    const result = await createMarketBuyOrder(supabase, user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to place buy order." },
      { status: 400 }
    );
  }
}
