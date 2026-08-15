import {
  getBusinessById,
  getBusinessesWithBalances,
} from "@/domains/businesses";
import { getCityById } from "@/domains/cities-travel";
import { formatBusinessType } from "@/lib/businesses";
import { createBusinessDetailsShell } from "@/lib/business-details-data";
import { withTiming } from "@/lib/server-timing";
import { GameHydrationProvider } from "@/providers/game-hydration-provider";
import { requireAuthedPageContext } from "../../server-data";
import { redirect } from "next/navigation";
import Link from "next/link";
import BusinessDetailsClient from "@/components/businesses/BusinessDetailsClient";
import { toBusinessDetailsClientEmployees } from "@/components/businesses/business-details-state";

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

  const [city, ownedBusinesses] = await withTiming("page-loader", `/businesses/${business.id}`, async (timing) =>
    Promise.all([
      timing.measure("city", () => getCityById(supabase, business.city_id).catch(() => null)),
      timing.measure("owned-businesses", () => getBusinessesWithBalances(supabase, user.id).catch(() => [])),
    ])
  );
  const detail = createBusinessDetailsShell({
    business,
    ownedBusinesses,
  });

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

      <GameHydrationProvider
        initialData={{
          businesses: ownedBusinesses,
          businessDetails: {
            [business.id]: detail,
          },
        }}
      >
        <BusinessDetailsClient
          business={detail.business}
          production={detail.production}
          manufacturing={detail.manufacturing}
          inventory={detail.inventory}
          shelfItems={detail.shelfItems}
          upgrades={detail.upgrades}
          upgradeProjects={detail.upgradeProjects}
          employees={toBusinessDetailsClientEmployees(detail.employees)}
          upgradeDefinitions={detail.upgradeDefinitions}
          financeDashboard={detail.financeDashboard}
          ownedBusinesses={detail.ownedBusinesses}
          initialTab={searchParams.tab}
        />
      </GameHydrationProvider>
    </>
  );
}
