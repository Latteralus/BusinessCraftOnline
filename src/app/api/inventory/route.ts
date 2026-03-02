import {
  getBusinessInventory,
  getPersonalInventory,
  getShippingQueue,
} from "@/domains/inventory";
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
  const businessId = url.searchParams.get("businessId") ?? undefined;

  try {
    const [personalInventory, businessInventory, shippingQueue] = await Promise.all([
      getPersonalInventory(supabase, user.id),
      getBusinessInventory(supabase, user.id, businessId),
      getShippingQueue(supabase, user.id),
    ]);

    return NextResponse.json({
      personalInventory,
      businessInventory,
      shippingQueue,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch inventory." },
      { status: 500 }
    );
  }
}
