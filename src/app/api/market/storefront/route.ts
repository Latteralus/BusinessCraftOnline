import {
  getMarketStorefrontSettings,
  marketStorefrontFilterSchema,
  updateMarketStorefrontSettings,
  updateMarketStorefrontSettingsSchema,
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
  const parsed = marketStorefrontFilterSchema.safeParse({
    businessId: url.searchParams.get("businessId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid storefront query." },
      { status: 400 }
    );
  }

  try {
    const storefront = await getMarketStorefrontSettings(supabase, user.id, parsed.data);
    return NextResponse.json({ storefront });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load storefront settings." },
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
  const parsed = updateMarketStorefrontSettingsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid storefront payload." },
      { status: 400 }
    );
  }

  try {
    const storefront = await updateMarketStorefrontSettings(supabase, user.id, parsed.data);
    return NextResponse.json({ storefront });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update storefront settings." },
      { status: 400 }
    );
  }
}
