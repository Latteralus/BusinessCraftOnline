import {
  createMarketBuyOrder,
  createMarketBuyOrderSchema,
  getMarketBuyOrders,
  marketBuyOrderFilterSchema,
} from "@/domains/market";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
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
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid buy order query.");
    }

    const buyOrders = await getMarketBuyOrders(supabase, user.id, parsed.data);
    return NextResponse.json({ buyOrders });
  }, { errorMessage: "Failed to load buy orders.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    createMarketBuyOrderSchema,
    "Invalid buy order payload.",
    async ({ supabase, user }, data) => {
      const result = await createMarketBuyOrder(supabase, user.id, data);
      return NextResponse.json(result, { status: 201 });
    },
    { errorMessage: "Failed to place buy order." }
  );
}
