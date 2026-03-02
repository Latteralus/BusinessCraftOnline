import { getCharacter, getPlayer } from "@/domains/auth-character";
import { getBankingSnapshot } from "@/domains/banking";
import { getBusinessSummary } from "@/domains/businesses";
import { getActiveTravel, getCityById } from "@/domains/cities-travel";
import { getEmployeeSummary } from "@/domains/employees";
import {
  getAdminEconomySummary,
  getMarketStorefrontSettings,
  getMarketTransactions,
  getStorefrontPerformanceSummary,
  getTickHealthSummary,
} from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import { redirect } from "next/navigation";

async function logout() {
  "use server";

  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [player, character] = await Promise.all([
    getPlayer(supabase, user.id),
    getCharacter(supabase, user.id),
  ]);

  if (!character) {
    redirect("/character-setup");
  }

  const [activeTravel, currentCity] = await Promise.all([
    getActiveTravel(supabase, user.id),
    character.current_city_id
      ? getCityById(supabase, character.current_city_id)
      : Promise.resolve(null),
  ]);

  const destinationCity = activeTravel
    ? await getCityById(supabase, activeTravel.to_city_id)
    : null;

  const bankingSnapshot = await getBankingSnapshot(supabase, user.id).catch(() => null);
  const businessSummary = await getBusinessSummary(supabase, user.id).catch(() => null);
  const employeeSummary = await getEmployeeSummary(supabase, user.id).catch(() => null);
  const marketTransactions = await getMarketTransactions(supabase, user.id, 8).catch(() => []);
  const storefrontSettings = await getMarketStorefrontSettings(supabase, user.id).catch(() => []);
  const tickHealth = await getTickHealthSummary(supabase, 24).catch(() => null);
  const storefrontPerformance = await getStorefrontPerformanceSummary(supabase, user.id, 24).catch(() => null);
  const adminEconomySummary =
    player?.role === "admin" ? await getAdminEconomySummary(supabase, 24).catch(() => null) : null;
  const [{ count: inTransitShippingCount }, { count: dueShippingCount }, { count: dueTravelArrivalsCount }] =
    await Promise.all([
      supabase
        .from("shipping_queue")
        .select("id", { count: "exact", head: true })
        .eq("owner_player_id", user.id)
        .eq("status", "in_transit"),
      supabase
        .from("shipping_queue")
        .select("id", { count: "exact", head: true })
        .eq("owner_player_id", user.id)
        .eq("status", "in_transit")
        .lte("arrives_at", new Date().toISOString()),
      supabase
        .from("travel_log")
        .select("id", { count: "exact", head: true })
        .eq("player_id", user.id)
        .eq("status", "traveling")
        .lte("arrives_at", new Date().toISOString()),
    ]);
  const checkingAccount =
    bankingSnapshot?.accounts.find((account) => account.account_type === "checking") ?? null;
  const pocketCashAccount =
    bankingSnapshot?.accounts.find((account) => account.account_type === "pocket_cash") ?? null;

  const travelRemainingMs = activeTravel
    ? new Date(activeTravel.arrives_at).getTime() - Date.now()
    : null;

  const travelRemainingMinutes =
    travelRemainingMs !== null ? Math.max(0, Math.ceil(travelRemainingMs / 60000)) : null;

  const adEnabledCount = storefrontSettings.filter((row) => row.is_ad_enabled).length;
  const totalAdBudgetPerTick = storefrontSettings.reduce((sum, row) => sum + row.ad_budget_per_tick, 0);
  const avgTrafficMultiplier =
    storefrontSettings.length > 0
      ? storefrontSettings.reduce((sum, row) => sum + row.traffic_multiplier, 0) / storefrontSettings.length
      : 1;

  return (
    <main>
      <h1>Dashboard</h1>
      <p style={{ color: "#94a3b8" }}>Phase 1 auth-character is active.</p>
      <section>
        <p>
          <strong>Player:</strong> {player?.username ?? "Unknown"}
        </p>
        <p>
          <strong>Email:</strong> {user.email}
        </p>
        <p>
          <strong>Character:</strong> {character.first_name} {character.last_name}
        </p>
        <p>
          <strong>Gender:</strong> {character.gender}
        </p>
        <p>
          <strong>Business Level:</strong> {character.business_level}
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Current City:</strong> {currentCity?.name ?? "Unknown"}
        </p>
        <p>
          <strong>Travel Status:</strong>{" "}
          {activeTravel
            ? `Traveling to ${destinationCity?.name ?? "destination"} (${travelRemainingMinutes} min remaining)`
            : "Not traveling"}
        </p>
        <p>
          <Link href="/travel">Open Travel Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Pocket Cash:</strong>{" "}
          {pocketCashAccount ? `$${pocketCashAccount.balance.toFixed(2)}` : "Unavailable"}
        </p>
        <p>
          <strong>Checking:</strong>{" "}
          {checkingAccount ? `$${checkingAccount.balance.toFixed(2)}` : "Unavailable"}
        </p>
        <p>
          <strong>Loan:</strong>{" "}
          {bankingSnapshot?.activeLoan
            ? `Active (${bankingSnapshot.activeLoan.balance_remaining.toFixed(2)} remaining)`
            : "No active loan"}
        </p>
        <p>
          <Link href="/banking">Open Banking Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Total Businesses:</strong> {businessSummary?.totalBusinesses ?? 0}
        </p>
        <p>
          <strong>Total Business Balances:</strong>{" "}
          ${businessSummary?.totalBusinessBalance.toFixed(2) ?? "0.00"}
        </p>
        <p>
          <strong>Top Business:</strong>{" "}
          {businessSummary?.topBusiness
            ? `${businessSummary.topBusiness.name} ($${businessSummary.topBusiness.balance.toFixed(2)})`
            : "N/A"}
        </p>
        <p>
          <Link href="/businesses">Open Businesses Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Total Employees:</strong> {employeeSummary?.totalEmployees ?? 0}
        </p>
        <p>
          <strong>Assigned / Resting / Available:</strong> {employeeSummary?.assignedCount ?? 0} /{" "}
          {employeeSummary?.restingCount ?? 0} / {employeeSummary?.availableCount ?? 0}
        </p>
        <p>
          <strong>Unpaid Workers:</strong> {employeeSummary?.unpaidCount ?? 0}
        </p>
        <p>
          <Link href="/employees">Open Employees Page</Link>
        </p>
        <p>
          <Link href="/production">Open Production Page</Link>
        </p>
        <p>
          <Link href="/contracts">Open Contracts Page</Link>
        </p>
        <p>
          <Link href="/market">Open Market Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Automation Status:</strong>
        </p>
        <p>
          <strong>Shipping In Transit:</strong> {inTransitShippingCount ?? 0}
        </p>
        <p>
          <strong>Shipping Ready for Delivery Tick:</strong> {dueShippingCount ?? 0}
        </p>
        <p>
          <strong>Travel Ready for Arrival Tick:</strong> {dueTravelArrivalsCount ?? 0}
        </p>
        <p>
          <strong>Storefront Ads Enabled:</strong> {adEnabledCount}
        </p>
        <p>
          <strong>Total Ad Budget Per Tick:</strong> ${totalAdBudgetPerTick.toFixed(2)}
        </p>
        <p>
          <strong>Avg Storefront Traffic Multiplier:</strong> {avgTrafficMultiplier.toFixed(2)}x
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Analytics (24h):</strong>
        </p>
        <p>
          <strong>Tick Success Rate:</strong>{" "}
          {tickHealth ? `${(tickHealth.success_rate * 100).toFixed(1)}%` : "Unavailable"}
        </p>
        <p>
          <strong>Tick Errors:</strong> {tickHealth?.error_runs ?? 0} / {tickHealth?.total_runs ?? 0}
        </p>
        <p>
          <strong>Storefront ROI:</strong>{" "}
          {storefrontPerformance?.roi !== null && storefrontPerformance?.roi !== undefined
            ? `${(storefrontPerformance.roi * 100).toFixed(1)}%`
            : "N/A"}
        </p>
        <p>
          <strong>Storefront Net Revenue:</strong> ${storefrontPerformance?.net_revenue.toFixed(2) ?? "0.00"}
        </p>
        <p>
          <strong>Storefront Ad Spend:</strong> ${storefrontPerformance?.ad_spend.toFixed(2) ?? "0.00"}
        </p>
        {adminEconomySummary ? (
          <>
            <p>
              <strong>Admin Economy Snapshots:</strong> {adminEconomySummary.storefront_performance.snapshots}
            </p>
            <p>
              <strong>Admin Market Net Revenue:</strong> ${adminEconomySummary.storefront_performance.net_revenue.toFixed(2)}
            </p>
          </>
        ) : null}
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Recent Market Activity:</strong>
        </p>
        {marketTransactions.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>No market transactions yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {marketTransactions.map((tx) => (
              <div key={tx.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                <div>
                  <strong>
                    {tx.item_key} (Q{tx.quality}) x{tx.quantity}
                  </strong>
                </div>
                <div>
                  ${tx.unit_price.toFixed(2)} each • Net ${tx.net_total.toFixed(2)} • Buyer{" "}
                  {tx.buyer_type === "npc" ? tx.shopper_name ?? "NPC" : "Player"}
                  {tx.buyer_type === "npc" && tx.sub_tick_index !== null
                    ? ` (sub-tick ${tx.sub_tick_index + 1})`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <form action={logout} style={{ marginTop: 20 }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
