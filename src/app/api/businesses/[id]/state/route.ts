import { type FinancePeriod } from "@/config/finance";
import {
  getBusinessById,
  getBusinessFinanceDashboard,
  getBusinessUpgradeProjects,
  getBusinessUpgrades,
  getBusinessesWithBalances,
  supportsExtraction,
} from "@/domains/businesses";
import { getBusinessInventory } from "@/domains/inventory";
import { getManufacturingStatus, getProductionStatus } from "@/domains/production";
import { getStoreShelfItems } from "@/domains/stores";
import { getUpgradeDefinitionsForBusinessType, type BusinessType } from "@/domains/upgrades";
import {
  handleAuthedRequest,
  notFound,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

function resolveFinancePeriod(searchParams: URLSearchParams): FinancePeriod {
  const requested = searchParams.get("period");
  return requested === "24h" || requested === "7d" || requested === "30d" ? requested : "1h";
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const period = resolveFinancePeriod(new URL(request.url).searchParams);

  return handleAuthedRequest(async ({ supabase, user }) => {
    const business = await getBusinessById(supabase, user.id, id).catch(() => null);

    if (!business || business.player_id !== user.id) {
      return notFound("Business not found.");
    }

    const isExtraction = supportsExtraction(business.type);
    const [
      production,
      manufacturing,
      inventory,
      shelfItems,
      upgrades,
      upgradeProjects,
      employeesRes,
      upgradeDefinitions,
      financeDashboard,
      ownedBusinesses,
    ] = await Promise.all([
      isExtraction ? getProductionStatus(supabase, user.id, business.id).catch(() => null) : Promise.resolve(null),
      !isExtraction ? getManufacturingStatus(supabase, user.id, business.id).catch(() => null) : Promise.resolve(null),
      getBusinessInventory(supabase, user.id, business.id).catch(() => []),
      getStoreShelfItems(supabase, user.id, { businessId: business.id }).catch(() => []),
      getBusinessUpgrades(supabase, user.id, business.id).catch(() => []),
      getBusinessUpgradeProjects(supabase, user.id, business.id).catch(() => []),
      supabase
        .from("employees")
        .select("*, employee_assignments(*, business:businesses(*))")
        .eq("player_id", user.id)
        .eq("employer_business_id", business.id)
        .order("created_at", { ascending: false }),
      getUpgradeDefinitionsForBusinessType(supabase, business.type as BusinessType).catch(() => []),
      getBusinessFinanceDashboard(supabase, user.id, business.id, period).catch(() => null),
      getBusinessesWithBalances(supabase, user.id).catch(() => []),
    ]);

    return NextResponse.json({
      detail: {
        business,
        production,
        manufacturing,
        inventory,
        shelfItems,
        upgrades,
        upgradeProjects,
        employees: employeesRes.data ?? [],
        financeDashboard,
        ownedBusinesses,
        upgradeDefinitions,
      },
    });
  }, { errorMessage: "Failed to fetch business state.", errorStatus: 500 });
}
