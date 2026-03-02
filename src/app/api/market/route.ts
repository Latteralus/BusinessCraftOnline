import {
  createMarketListing,
  createMarketListingSchema,
  getMarketListings,
   getMarketStorefrontSettings,
  getMarketTransactions,
   marketStorefrontFilterSchema,
  marketListingFilterSchema,
   updateMarketStorefrontSettings,
   updateMarketStorefrontSettingsSchema,
} from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const includeTransactions = url.searchParams.get("includeTransactions") === "true";
  const includeStorefront = url.searchParams.get("includeStorefront") === "true";
  const transactionsLimit = Number(url.searchParams.get("transactionsLimit") ?? "50");

  const parsed = marketListingFilterSchema.safeParse({
    cityId: url.searchParams.get("cityId") ?? undefined,
    itemKey: url.searchParams.get("itemKey") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    ownOnly:
      url.searchParams.get("ownOnly") === null
        ? undefined
        : url.searchParams.get("ownOnly") === "true",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid market query." },
      { status: 400 }
    );
  }

  try {
    const listings = await getMarketListings(supabase, user.id, parsed.data);

    const storefrontParsed = marketStorefrontFilterSchema.safeParse({
      businessId: url.searchParams.get("businessId") ?? undefined,
    });

    if (!storefrontParsed.success) {
      return NextResponse.json(
        { error: storefrontParsed.error.issues[0]?.message ?? "Invalid storefront query." },
        { status: 400 }
      );
    }

    const storefront = includeStorefront
      ? await getMarketStorefrontSettings(supabase, user.id, storefrontParsed.data)
      : undefined;

    if (!includeTransactions) {
      return NextResponse.json({ listings, storefront });
    }

    const transactions = await getMarketTransactions(supabase, user.id, transactionsLimit);
    return NextResponse.json({ listings, transactions, storefront });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load market listings." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);

  if (payload?.action === "updateStorefront") {
    const parsedStorefront = updateMarketStorefrontSettingsSchema.safeParse(payload);

    if (!parsedStorefront.success) {
      return NextResponse.json(
        { error: parsedStorefront.error.issues[0]?.message ?? "Invalid storefront payload." },
        { status: 400 }
      );
    }

    try {
      const storefront = await updateMarketStorefrontSettings(supabase, user.id, parsedStorefront.data);
      return NextResponse.json({ storefront });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to update storefront settings." },
        { status: 400 }
      );
    }
  }

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
