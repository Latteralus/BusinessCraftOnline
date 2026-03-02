import {
  createMarketListing,
  createMarketListingSchema,
  getMarketListings,
  marketListingFilterSchema,
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
    return NextResponse.json({ listings });
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

