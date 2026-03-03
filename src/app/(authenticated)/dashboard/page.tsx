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
import { EXTRACTION_OUTPUT_ITEM_BY_BUSINESS, EXTRACTION_UPGRADE_KEY_BY_BUSINESS, getManufacturingRecipeByKey } from "@/config/production";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardClock } from "@/components/dashboard/DashboardClock";

async function logout() {
  "use server";

  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

function formatTimeAgo(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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
    getPlayer(supabase, user.id).catch(() => null),
    getCharacter(supabase, user.id).catch(() => null),
  ]);

  if (!character) {
    redirect("/character-setup");
  }

  const [activeTravel, currentCity] = await Promise.all([
    getActiveTravel(supabase, user.id).catch(() => null),
    character.current_city_id
      ? getCityById(supabase, character.current_city_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const destinationCity = activeTravel
    ? await getCityById(supabase, activeTravel.to_city_id).catch(() => null)
    : null;

  const bankingSnapshot = await getBankingSnapshot(supabase, user.id).catch(() => null);
  const businessSummary = await getBusinessSummary(supabase, user.id).catch(() => null);
  const employeeSummary = await getEmployeeSummary(supabase, user.id).catch(() => null);
  const marketTransactions = await getMarketTransactions(supabase, user.id, 12).catch(() => []);
  const { data: postedListings } = await supabase
    .from("market_listings")
    .select("id, source_business_id, item_key, quantity, unit_price, created_at")
    .eq("owner_player_id", user.id)
    .order("created_at", { ascending: false })
    .limit(12);
  const storefrontSettings = await getMarketStorefrontSettings(supabase, user.id).catch(() => []);
  const tickHealth = await getTickHealthSummary(supabase, 24).catch(() => null);
  const storefrontPerformance = await getStorefrontPerformanceSummary(supabase, user.id, 24).catch(() => null);
  const adminEconomySummary =
    player?.role === "admin" ? await getAdminEconomySummary(supabase, 24).catch(() => null) : null;

  const [res1, res2, res3, mfgRes, extRes] = await Promise.all([
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
    supabase
      .from("manufacturing_jobs")
      .select("*, business:businesses!inner(name, type, player_id)")
      .eq("businesses.player_id", user.id)
      .eq("status", "active")
      .limit(1),
    supabase
      .from("extraction_slots")
      .select("*, business:businesses!inner(name, type, player_id)")
      .eq("businesses.player_id", user.id)
      .eq("status", "active")
      .limit(1),
  ]);

  const activeMfgJob = mfgRes.data?.[0];
  const activeExtSlot = extRes.data?.[0];
  let activeOperation = null;

  try {
    if (activeMfgJob || activeExtSlot) {
      const activeBizId = activeMfgJob ? activeMfgJob.business_id : activeExtSlot.business_id;
      const { data: upgrades } = await supabase
        .from("business_upgrades")
        .select("*")
        .eq("business_id", activeBizId);

      if (activeMfgJob) {
        const recipe = getManufacturingRecipeByKey(activeMfgJob.active_recipe_key);
        const effUpgrade = upgrades?.find((u) => u.upgrade_key === "production_efficiency")?.level || 0;
        const outputQty = Math.floor((recipe?.baseOutputQuantity || 1) * Math.pow(1.1, effUpgrade));
        activeOperation = {
          type: "manufacturing",
          name: activeMfgJob.business?.name || "Unknown Business",
          businessId: activeBizId,
          detail: recipe ? `${recipe.displayName} x${outputQty}/tick` : "Producing",
        };
      } else if (activeExtSlot) {
        const type = activeExtSlot.business?.type as keyof typeof EXTRACTION_UPGRADE_KEY_BY_BUSINESS;
        const upgradeKey = EXTRACTION_UPGRADE_KEY_BY_BUSINESS[type] || "extraction_efficiency";
        const effUpgrade = upgrades?.find((u) => u.upgrade_key === upgradeKey)?.level || 0;
        const outputQty = Math.max(1, Math.round(1 * Math.pow(1.1, effUpgrade)));
        const itemKey = type ? EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[type] || "Unknown" : "Unknown";
        
        activeOperation = {
          type: "extraction",
          name: activeExtSlot.business?.name || "Unknown Business",
          businessId: activeBizId,
          detail: `${itemKey.replace(/_/g, " ")} x${outputQty}/tick (Slot #${activeExtSlot.slot_number})`,
        };
      }
    }
  } catch (err) {
    console.error("Error computing active operation:", err);
  }

  const inTransitShippingCount = res1?.count ?? 0;
  const dueShippingCount = res2?.count ?? 0;
  const dueTravelArrivalsCount = res3?.count ?? 0;

  const checkingAccount =
    bankingSnapshot?.accounts?.find((account) => account.account_type === "checking") ?? null;
  const pocketCashAccount =
    bankingSnapshot?.accounts?.find((account) => account.account_type === "pocket_cash") ?? null;

  const travelRemainingMs = activeTravel
    ? new Date(activeTravel.arrives_at).getTime() - Date.now()
    : null;

  const travelRemainingMinutes =
    travelRemainingMs !== null ? Math.max(0, Math.ceil(travelRemainingMs / 60000)) : null;

  const adEnabledCount = storefrontSettings?.filter((row) => row.is_ad_enabled)?.length ?? 0;
  const totalAdBudgetPerTick = storefrontSettings?.reduce((sum, row) => sum + row.ad_budget_per_tick, 0) ?? 0;
  const avgTrafficMultiplier =
    storefrontSettings && storefrontSettings.length > 0
      ? storefrontSettings.reduce((sum, row) => sum + row.traffic_multiplier, 0) / storefrontSettings.length
      : 1;

  const feedBusinessIds = Array.from(
    new Set([
      ...(postedListings ?? []).map((row) => String(row.source_business_id)),
      ...marketTransactions.map((tx) => tx.seller_business_id),
      ...marketTransactions.map((tx) => tx.buyer_business_id).filter((id): id is string => Boolean(id)),
    ])
  ).filter(Boolean);

  const { data: feedBusinesses } =
    feedBusinessIds.length > 0
      ? await supabase.from("businesses").select("id, name").in("id", feedBusinessIds)
      : { data: [] as Array<{ id: string; name: string }> };

  const businessNameById = new Map(((feedBusinesses as Array<{ id: string; name: string }>) ?? []).map((b) => [b.id, b.name]));

  const marketFeed = [
    ...((postedListings ?? []).map((row) => {
      const businessName =
        businessNameById.get(String(row.source_business_id)) ?? `Business ${String(row.source_business_id).slice(0, 8)}`;
      const itemName = String(row.item_key).replace(/_/g, " ");
      return {
        id: `listing-${row.id}`,
        createdAt: String(row.created_at),
        line: `[${formatTimeAgo(String(row.created_at))}] ${businessName} posted ${row.quantity} ${itemName} at $${Number(
          row.unit_price
        ).toFixed(2)}`,
      };
    }) ?? []),
    ...marketTransactions.map((tx) => {
      const itemName = tx.item_key.replace(/_/g, " ");
      const sellerName = businessNameById.get(tx.seller_business_id) ?? `Business ${tx.seller_business_id.slice(0, 8)}`;
      const buyerName =
        tx.buyer_type === "npc"
          ? tx.shopper_name ?? "NPC shopper"
          : tx.buyer_business_id
          ? businessNameById.get(tx.buyer_business_id) ?? `Business ${tx.buyer_business_id.slice(0, 8)}`
          : "A player";
      return {
        id: `tx-${tx.id}`,
        createdAt: tx.created_at,
        line: `[${formatTimeAgo(tx.created_at)}] ${buyerName} bought ${tx.quantity} ${itemName} from ${sellerName}`,
      };
    }),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  // Helpers for UI
  const initials = character.first_name[0] + character.last_name[0];
  const pocketBalance = pocketCashAccount ? pocketCashAccount.balance : 0;
  const checkBalance = checkingAccount ? checkingAccount.balance : 0;
  const bizBalance = businessSummary?.totalBusinessBalance ?? 0;
  const loanBalance = bankingSnapshot?.activeLoan ? bankingSnapshot.activeLoan.balance_remaining : 0;

  return (
    <>
      <div className="welcome-strip anim">
          <div className="welcome-left">
            <h1>Good afternoon, {character.first_name}</h1>
            <p>All systems running · <span>{businessSummary?.totalBusinesses ?? 0} businesses active</span></p>
          </div>
          <DashboardClock />
        </div>

        <div className="finance-row anim anim-d1">
          <div className="finance-card" style={{ "--card-accent": "var(--accent-green)" } as any}>
            <div className="finance-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h8M9 14h6"/></svg>
              Pocket Cash
            </div>
            <div className="finance-value">${pocketBalance.toFixed(2)}</div>
            <div className="finance-sub"><span className="up">Available</span></div>
          </div>

          <div className="finance-card" style={{ "--card-accent": "var(--accent-blue)" } as any}>
            <div className="finance-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
              Checking Account
            </div>
            <div className="finance-value">${checkBalance.toFixed(2)}</div>
            <div className="finance-sub"><span className="up">Available</span></div>
          </div>

          <div className="finance-card" style={{ "--card-accent": "var(--gold)" } as any}>
            <div className="finance-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M7 14l3-3 2 2 5-5"/></svg>
              Business Accounts
            </div>
            <div className="finance-value">${bizBalance.toFixed(2)}</div>
            <div className="finance-sub">Across {businessSummary?.totalBusinesses ?? 0} businesses</div>
          </div>

          <div className="finance-card" style={{ "--card-accent": "var(--accent-purple)" } as any}>
            <div className="finance-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              Investment Account
            </div>
            <div className="finance-value">$0.00</div>
            <div className="finance-sub">Locked</div>
          </div>

          <div className="finance-card" style={{ "--card-accent": "var(--accent-red)" } as any}>
            <div className="finance-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0110 10 10 10 0 01-10 10A10 10 0 012 12 10 10 0 0112 2z"/><path d="M12 8v4l3 3"/></svg>
              Loan Balance
            </div>
            <div className="finance-value" style={{ color: "var(--accent-red)" }}>-${loanBalance.toFixed(2)}</div>
            <div className="finance-sub">{loanBalance > 0 ? "Active Loan" : "No active loan"}</div>
          </div>
        </div>

        <div className="quick-actions anim anim-d2">
          <Link className="qa-btn" href="/businesses">
            <div className="qa-icon" style={{ background: "var(--accent-green-dim)" }}>🏭</div>
            <div><div className="qa-text">New Business</div><div className="qa-sub">Start a venture</div></div>
          </Link>
          <Link className="qa-btn" href="/inventory">
            <div className="qa-icon" style={{ background: "var(--accent-blue-dim)" }}>📦</div>
            <div><div className="qa-text">Inventory</div><div className="qa-sub">Manage stock</div></div>
          </Link>
          <Link className="qa-btn" href="/market">
            <div className="qa-icon" style={{ background: "var(--accent-amber-dim)" }}>📊</div>
            <div><div className="qa-text">Player Market</div><div className="qa-sub">Buy & sell goods</div></div>
          </Link>
          <Link className="qa-btn" href="/banking">
            <div className="qa-icon" style={{ background: "var(--accent-purple-dim)" }}>🏦</div>
            <div><div className="qa-text">Banking</div><div className="qa-sub">Transfers & loans</div></div>
          </Link>
          <Link className="qa-btn" href="/contracts">
            <div className="qa-icon" style={{ background: "var(--accent-cyan-dim)" }}>📝</div>
            <div><div className="qa-text">Contracts</div><div className="qa-sub">Pending bids</div></div>
          </Link>
          <Link className="qa-btn" href="/employees">
            <div className="qa-icon" style={{ background: "var(--accent-red-dim)" }}>👥</div>
            <div><div className="qa-text">Employees</div><div className="qa-sub">{employeeSummary?.totalEmployees ?? 0} Total</div></div>
          </Link>
        </div>

        <div className="dash-grid">
          <div className="card anim anim-d3">
            <div className="card-header">
              <div className="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                My Businesses
              </div>
              <Link href="/businesses" className="card-action">View All →</Link>
            </div>
            <div className="card-body">
              {businessSummary?.topBusiness ? (
                <Link href={`/businesses/${businessSummary.topBusiness.id}`} className="biz-item" style={{ textDecoration: 'none' }}>
                  <div className="biz-icon" style={{ background: "var(--accent-amber-dim)", color: "var(--accent-amber)" }}>⛏️</div>
                  <div className="biz-info">
                    <div className="biz-name">{businessSummary.topBusiness.name}</div>
                    <div className="biz-meta">Top Earning Business</div>
                  </div>
                  <div className="biz-status">
                    <span className="status-badge status-producing">Producing</span>
                    <span className="biz-profit">${businessSummary.topBusiness.balance.toFixed(2)}</span>
                  </div>
                </Link>
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No active businesses yet.</p>
              )}
            </div>
          </div>

          <div className="card anim anim-d4">
            <div className="card-header">
              <div className="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h20M5 20V8l5 4V4l5 8h5v8"/></svg>
                Active Operations
              </div>
              <Link href="/businesses" className="card-action">Manage →</Link>
            </div>
            <div className="card-body">
              {activeOperation ? (
                <Link href={`/businesses/${activeOperation.businessId}?tab=operations`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                  <div className="mfg-item" style={{ cursor: "pointer", transition: "transform 0.2s" }}>
                    <div className="mfg-top">
                      <div className="mfg-name">{activeOperation.name}</div>
                      <div className="mfg-recipe" style={{ textTransform: "capitalize" }}>{activeOperation.detail}</div>
                    </div>
                    <div className="mfg-bar-track">
                      <div className="mfg-bar-fill anim-pulse" style={{ width: "100%", background: "var(--accent-green)" }}></div>
                    </div>
                    <div className="mfg-bottom">
                      <div className="mfg-inputs">
                        <span className="input-chip input-filled">Status: Active</span>
                      </div>
                      <div className="mfg-countdown" style={{ color: "var(--accent-green)" }}>Running</div>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="mfg-item" style={{ opacity: 0.5 }}>
                  <div className="mfg-top">
                    <div className="mfg-name">No active production</div>
                    <div className="mfg-recipe">Assign workers to start</div>
                  </div>
                  <div className="mfg-bar-track">
                    <div className="mfg-bar-fill" style={{ width: "0%", background: "var(--accent-red)" }}></div>
                  </div>
                  <div className="mfg-bottom">
                    <div className="mfg-inputs">
                      <span className="input-chip input-empty">Worker: Resting/None</span>
                    </div>
                    <div className="mfg-countdown" style={{ color: "var(--accent-red)" }}>Halted</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="sidebar-col">
            <div className="travel-widget anim anim-d5">
              <div className="travel-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>
                <span>Current Location</span>
              </div>
              <div className="travel-location">
                <div className="travel-city">📍 {currentCity?.name ?? "Unknown"}</div>
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Travel Status:</div>
              <div className="travel-cities-row">
                <div className="city-chip current">
                  {activeTravel ? `Traveling to ${destinationCity?.name ?? "destination"} (${travelRemainingMinutes}m left)` : "Stationary"}
                </div>
              </div>
            </div>

            <div className="card anim anim-d6" style={{ flex: 1 }}>
              <div className="card-header">
                <div className="card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Market Watch
                </div>
                <Link href="/market" className="card-action">Full Market →</Link>
              </div>
              <div className="card-body">
                {marketFeed.map((entry) => (
                  <div className="market-item" key={entry.id}>
                    <div className="market-name" style={{ fontSize: "0.78rem" }}>{entry.line}</div>
                  </div>
                ))}
                {marketFeed.length === 0 && (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No recent market activity.</p>
                )}
              </div>
            </div>
          </div>

          <div className="card anim anim-d6">
            <div className="card-header">
              <div className="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                Employees
              </div>
              <Link href="/employees" className="card-action">Hire / Manage →</Link>
            </div>
            <div className="card-body">
              <div className="emp-item">
                <div className="emp-avatar" style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>{employeeSummary?.totalEmployees ?? 0}</div>
                <div className="emp-info">
                  <div className="emp-name">Total Employees</div>
                  <div className="emp-role">Assigned: {employeeSummary?.assignedCount ?? 0} · Resting: {employeeSummary?.restingCount ?? 0}</div>
                </div>
                <div className="emp-right">
                  <div className="emp-shift-bar"><div className="emp-shift-fill" style={{ width: "100%" }}></div></div>
                </div>
              </div>
            </div>
          </div>

          <div className="card anim anim-d7">
            <div className="card-header">
              <div className="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M8 3v18"/></svg>
                System Status
              </div>
              <button className="card-action">Details →</button>
            </div>
            <div className="card-body">
              <div className="tx-item">
                <div className="tx-icon" style={{ background: "var(--accent-blue-dim)", color: "var(--accent-blue)" }}>⚙️</div>
                <div className="tx-info">
                  <div className="tx-desc">Tick Success Rate</div>
                  <div className="tx-time">Last 24 hours</div>
                </div>
                <div className="tx-amount">{tickHealth ? `${(tickHealth.success_rate * 100).toFixed(1)}%` : "N/A"}</div>
              </div>
              <div className="tx-item">
                <div className="tx-icon" style={{ background: "var(--accent-green-dim)", color: "var(--accent-green)" }}>↓</div>
                <div className="tx-info">
                  <div className="tx-desc">In-Transit Shipping</div>
                  <div className="tx-time">Currently moving</div>
                </div>
                <div className="tx-amount">{inTransitShippingCount} items</div>
              </div>
            </div>
          </div>

          <div className="card anim anim-d8" style={{ gridColumn: 3, gridRow: 2 }}>
            <div className="card-header">
              <div className="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
                Business Overview
              </div>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Business Level</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.78rem", fontWeight: 600, color: "var(--gold)" }}>Lv. {character.business_level}</span>
                </div>
                <div className="mfg-bar-track" style={{ height: 8 }}>
                  <div className="mfg-bar-fill" style={{ width: "100%", background: "linear-gradient(90deg,var(--gold),#e8b94a)" }}></div>
                </div>
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 4 }}>Level Maxed (Example)</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <div style={{ background: "var(--bg-primary)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Storefront Net</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "1rem", fontWeight: 600, color: "var(--accent-green)", marginTop: 4 }}>
                    ${storefrontPerformance?.net_revenue.toFixed(2) ?? "0.00"}
                  </div>
                </div>
                <div style={{ background: "var(--bg-primary)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Ad Spend</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "1rem", fontWeight: 600, color: "var(--accent-red)", marginTop: 4 }}>
                    ${storefrontPerformance?.ad_spend.toFixed(2) ?? "0.00"}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>Session</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <form action={logout}>
                    <button type="submit" style={{ fontSize: "0.7rem", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--accent-red)" }}>Sign Out</button>
                  </form>
                </div>
              </div>
            </div>
          </div>

        </div>
    </>
  );
}
