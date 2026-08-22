import {
  createMarketListing,
  createMarketListingSchema,
  getMarketListings,
  getMarketTransactions,
  marketListingFilterSchema,
} from "@/domains/market";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { withTiming } from "@/lib/server-timing";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const includeTransactions = url.searchParams.get("includeTransactions") === "true";
    const transactionsLimit = Number(url.searchParams.get("transactionsLimit") ?? "50");
    const buyerType = url.searchParams.get("buyerType");
    const requireListing = url.searchParams.get("requireListing") === "true";
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "50") || 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);

    const parsed = marketListingFilterSchema.safeParse({
      cityId: url.searchParams.get("cityId") ?? undefined,
      itemKey: url.searchParams.get("itemKey") ?? undefined,
      status: url.searchParams.get("status") ?? "active",
      ownOnly:
        url.searchParams.get("ownOnly") === null
          ? undefined
          : url.searchParams.get("ownOnly") === "true",
      limit: limit + 1,
      offset,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid market query.");
    }

    return withTiming("api-route", "/api/market GET", async (timing) => {
      const listingsWithLookahead = await timing.measure("market-listings", () =>
        getMarketListings(supabase, user.id, parsed.data)
      );
      const listings = listingsWithLookahead.slice(0, limit);
      const page = {
        limit,
        offset,
        hasMore: listingsWithLookahead.length > limit,
      };

      if (!includeTransactions) {
        return NextResponse.json({ listings, page });
      }

      const transactions = await timing.measure("market-transactions", () =>
        getMarketTransactions(supabase, user.id, transactionsLimit, {
          buyerType: buyerType === "player" || buyerType === "npc" ? buyerType : undefined,
          requireListing,
        })
      );
      return NextResponse.json({ listings, transactions, page });
    });
  }, { errorMessage: "Failed to load market listings.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    createMarketListingSchema,
    "Invalid listing payload.",
    async ({ supabase, user }, data) => {
      const listing = await createMarketListing(supabase, user.id, data);
      return NextResponse.json({ listing }, { status: 201 });
    },
    { errorMessage: "Failed to create market listing." }
  );
}
