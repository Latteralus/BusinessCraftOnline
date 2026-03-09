import {
  getBusinessInventory,
  getPersonalInventory,
  getShippingQueue,
} from "@/domains/inventory";
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
  const businessId = url.searchParams.get("businessId") ?? undefined;

  try {
    const [personalInventory, businessInventory, shippingQueue] = await Promise.all([
      getPersonalInventory(supabase, user.id),
      getBusinessInventory(supabase, user.id, businessId),
      getShippingQueue(supabase, user.id),
    ]);

    const businessNamesById: Record<string, string> = {};
    const cityNamesById: Record<string, string> = {};

    const businessIds = Array.from(new Set(businessInventory.map((row) => row.business_id)));
    const cityIds = Array.from(new Set(businessInventory.map((row) => row.city_id)));

    const [businessesRes, citiesRes] = await Promise.all([
      businessIds.length > 0
        ? supabase
            .from("businesses")
            .select("id, name")
            .eq("player_id", user.id)
            .in("id", businessIds)
        : Promise.resolve({ data: [], error: null }),
      cityIds.length > 0
        ? supabase.from("cities").select("id, name").in("id", cityIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (businessesRes.error) throw businessesRes.error;
    if (citiesRes.error) throw citiesRes.error;

    for (const row of (businessesRes.data as Array<{ id: string; name: string }> | null) ?? []) {
      businessNamesById[row.id] = row.name;
    }

    for (const row of (citiesRes.data as Array<{ id: string; name: string }> | null) ?? []) {
      cityNamesById[row.id] = row.name;
    }

    return NextResponse.json({
      personalInventory,
      businessInventory,
      shippingQueue,
      businessNamesById,
      cityNamesById,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch inventory." },
      { status: 500 }
    );
  }
}
