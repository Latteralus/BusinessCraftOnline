import { getBusinessById, getBusinessUpgrades } from "@/domains/businesses";
import {
  getUpgradePreviewForBusiness,
  upgradePreviewRequestSchema,
} from "@/domains/upgrades";
import { handleAuthedJsonRequest, notFound } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    upgradePreviewRequestSchema,
    "Invalid upgrade preview payload.",
    async ({ supabase, user }, data) => {
      const business = await getBusinessById(supabase, user.id, data.businessId);
      if (!business) {
        return notFound("Business not found.");
      }

      const upgrades = await getBusinessUpgrades(supabase, user.id, business.id);
      const currentLevel =
        upgrades.find((entry) => entry.upgrade_key === data.upgradeKey)?.level ?? 0;

      const preview = await getUpgradePreviewForBusiness(supabase, business.type, {
        upgradeKey: data.upgradeKey,
        currentLevel,
      });

      return NextResponse.json({ preview });
    },
    { errorMessage: "Failed to compute upgrade preview." }
  );
}
