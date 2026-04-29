import {
  createMarketListing,
  createMarketListingSchema,
  getMarketListings,
  getMarketTransactions,
  marketListingFilterSchema,
} from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { withTiming } from "@/lib/server-timing";
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
  const includeTransactions = url.searchParams.get("includeTransactions") === "true";
  const transactionsLimit = Number(url.searchParams.get("transactionsLimit") ?? "50");
  const buyerType = url.searchParams.get("buyerType");
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid market query." },
      { status: 400 }
    );
  }

  try {
    return await withTiming("api-route", "/api/market GET", async (timing) => {
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
        })
      );
      return NextResponse.json({ listings, transactions, page });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load market listings." },
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

  const parsed = createMarketListingSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid listing payload." },
      { status: 400 }
    );
  }

  try {
    const listing = await createMarketListing(supabase, user.id, parsed.data);
    return NextResponse.json({ listing }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create market listing." },
      { status: 400 }
    );
  }
}
