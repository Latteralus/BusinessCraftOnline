import { getStorefrontPerformanceForBusiness } from "@/domains/market";
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
  const businessId = url.searchParams.get("businessId");
  const windowHours = Number(url.searchParams.get("windowHours") ?? "24");

  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  try {
    const performance = await getStorefrontPerformanceForBusiness(
      supabase,
      user.id,
      businessId,
      Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24
    );
    return NextResponse.json({ performance });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load storefront performance." },
      { status: 500 }
    );
  }
}
