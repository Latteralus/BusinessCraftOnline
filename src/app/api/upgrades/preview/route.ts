import { getBusinessById, getBusinessUpgrades } from "@/domains/businesses";
import {
  getUpgradePreviewForBusiness,
  upgradePreviewRequestSchema,
} from "@/domains/upgrades";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = upgradePreviewRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid upgrade preview payload." },
      { status: 400 }
    );
  }

  try {
    const business = await getBusinessById(supabase, user.id, parsed.data.businessId);
    if (!business) {
      return NextResponse.json({ error: "Business not found." }, { status: 404 });
    }

    const upgrades = await getBusinessUpgrades(supabase, user.id, business.id);
    const currentLevel =
      upgrades.find((entry) => entry.upgrade_key === parsed.data.upgradeKey)?.level ?? 0;

    const preview = await getUpgradePreviewForBusiness(supabase, business.type, {
      upgradeKey: parsed.data.upgradeKey,
      currentLevel,
    });

    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compute upgrade preview." },
      { status: 400 }
    );
  }
}

