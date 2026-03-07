import {
  businessListFilterSchema,
  createBusiness,
  createBusinessSchema,
  getBusinessesWithBalances,
  summarizeBusinessesWithBalances,
} from "@/domains/businesses";
import { getCharacter } from "@/domains/auth-character";
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
  const rawFilters = {
    type: url.searchParams.get("type") ?? undefined,
    cityId: url.searchParams.get("cityId") ?? undefined,
  };

  const parsed = businessListFilterSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid filters." },
      { status: 400 }
    );
  }

  try {
    const businesses = await getBusinessesWithBalances(supabase, user.id, parsed.data);
    const summary = summarizeBusinessesWithBalances(businesses);

    return NextResponse.json({ businesses, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch businesses." },
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
  const parsed = createBusinessSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid business creation payload." },
      { status: 400 }
    );
  }

  const character = await getCharacter(supabase, user.id);
  if (!character?.current_city_id) {
    return NextResponse.json(
      { error: "Character city is required before creating a business." },
      { status: 400 }
    );
  }

  try {
    const business = await createBusiness(
      supabase,
      user.id,
      character.current_city_id,
      parsed.data
    );

    return NextResponse.json({ business }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create business." },
      { status: 400 }
    );
  }
}
