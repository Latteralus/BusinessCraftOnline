import { type FinancePeriod } from "@/config/finance";
import {
  getBusinessById,
  getBusinessFinanceDashboard,
  getBusinessUpgradeProjects,
  getBusinessUpgrades,
  getBusinessesWithBalances,
} from "@/domains/businesses";
import { getCityById } from "@/domains/cities-travel";
import { getProductionStatus, getManufacturingStatus } from "@/domains/production";
import { getBusinessInventory } from "@/domains/inventory";
import { getStoreShelfItems } from "@/domains/stores";
import { getUpgradeDefinitionsForBusinessType, type BusinessType } from "@/domains/upgrades";
import { formatBusinessType } from "@/lib/businesses";
import { requireAuthedPageContext } from "../../server-data";
import { redirect } from "next/navigation";
import Link from "next/link";
import BusinessDetailsClient from "@/components/businesses/BusinessDetailsClient";

export default async function BusinessDetailsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; period?: string }> }) {
  const [params, searchParams, { supabase, user }] = await Promise.all([
    props.params,
    props.searchParams,
    requireAuthedPageContext(),
  ]);

  const business = await getBusinessById(supabase, user.id, params.id).catch(() => null);

  if (!business || business.player_id !== user.id) {
    redirect("/businesses"); // Redirect if it doesn't exist or isn't theirs
  }

  const requestedPeriod = (["1h", "24h", "7d", "30d"].includes(searchParams.period ?? "")
    ? searchParams.period
    : "1h") as FinancePeriod;

  // Handle differences between extraction and manufacturing businesses
  const isExtraction = [
    "mine",
    "farm",
    "water_company",
    "logging_camp",
    "oil_well",
  ].includes(business.type);

  const [city, production, manufacturing, inventory, shelfItems, upgrades, upgradeProjects, employeesRes, upgradeDefinitions, financeDashboard, ownedBusinesses] = await Promise.all([
    getCityById(supabase, business.city_id).catch(() => null),
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
    getBusinessFinanceDashboard(supabase, user.id, business.id, requestedPeriod).catch(() => null),
    getBusinessesWithBalances(supabase, user.id).catch(() => []),
  ]);

  const employees = employeesRes.data || [];

  return (
    <>
      <div className="page-header anim">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/businesses" className="back-button" style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            width: 32, 
            height: 32, 
            background: "var(--bg-elevated)", 
            borderRadius: "50%",
            color: "var(--text-secondary)",
            textDecoration: "none"
          }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </Link>
          <div>
            <h1>{business.name}</h1>
            <p>{formatBusinessType(business.type)} • {city?.name ?? "Unknown City"}</p>
          </div>
        </div>
      </div>

      <BusinessDetailsClient 
        business={business} 
        production={production}
        manufacturing={manufacturing}
        inventory={inventory}
        shelfItems={shelfItems}
        upgrades={upgrades}
        upgradeProjects={upgradeProjects}
        employees={employees as any}
        upgradeDefinitions={upgradeDefinitions}
        financeDashboard={financeDashboard}
        ownedBusinesses={ownedBusinesses}
        initialTab={searchParams.tab}
      />
    </>
  );
}
