import { getCharacter } from "@/domains/auth-character";
import { getBusinessById, getBusinessUpgrades } from "@/domains/businesses";
import { getCityById } from "@/domains/cities-travel";
import { getProductionStatus, getManufacturingStatus } from "@/domains/production";
import { getBusinessInventory } from "@/domains/inventory";
import { getUpgradeDefinitionsForBusinessType, type BusinessType } from "@/domains/upgrades";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import BusinessDetailsClient from "@/components/businesses/BusinessDetailsClient";

export default async function BusinessDetailsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const character = await getCharacter(supabase, user.id).catch(() => null);
  if (!character) {
    redirect("/character-setup");
  }

  const business = await getBusinessById(supabase, user.id, params.id).catch(() => null);

  if (!business || business.player_id !== user.id) {
    redirect("/businesses"); // Redirect if it doesn't exist or isn't theirs
  }

  // Handle differences between extraction and manufacturing businesses
  const isExtraction = [
    "mine",
    "farm",
    "water_company",
    "logging_camp",
    "oil_well",
  ].includes(business.type);

  const [city, production, manufacturing, inventory, upgrades, employeesRes, upgradeDefinitions] = await Promise.all([
    getCityById(supabase, business.city_id).catch(() => null),
    isExtraction ? getProductionStatus(supabase, user.id, business.id).catch(() => null) : Promise.resolve(null),
    !isExtraction ? getManufacturingStatus(supabase, user.id, business.id).catch(() => null) : Promise.resolve(null),
    getBusinessInventory(supabase, user.id, business.id).catch(() => []),
    getBusinessUpgrades(supabase, user.id, business.id).catch(() => []),
    supabase.from("employee_assignments").select("*, employee:employees(*)").eq("business_id", business.id),
    getUpgradeDefinitionsForBusinessType(supabase, business.type as BusinessType).catch(() => [])
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
            <p>{business.type.replace(/_/g, " ")} • {city?.name ?? "Unknown City"}</p>
          </div>
        </div>
      </div>

      <BusinessDetailsClient 
        business={business} 
        production={production}
        manufacturing={manufacturing}
        inventory={inventory}
        upgrades={upgrades}
        employees={employees as any}
        upgradeDefinitions={upgradeDefinitions}
        initialTab={searchParams.tab}
      />
    </>
  );
}
