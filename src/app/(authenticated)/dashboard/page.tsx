import { getPlayer } from "@/domains/auth-character";
import { getBankingSnapshot } from "@/domains/banking";
import { getBusinessesWithBalances, summarizeBusinessesWithBalances } from "@/domains/businesses";
import { getActiveTravel, getCityById } from "@/domains/cities-travel";
import { getEmployeeStatusFromShift, getEmployeeSummary } from "@/domains/employees";
import {
  getAdminEconomySummary,
  getMarketStorefrontSettings,
  getMarketTransactions,
  getStorefrontPerformanceSummary,
  getTickHealthSummary,
} from "@/domains/market";
import { formatMarketTransactionLine } from "@/domains/market/feed";
import { EXTRACTION_OUTPUT_ITEM_BY_BUSINESS, getManufacturingRecipeByKey } from "@/config/production";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { CUSTOM_SESSION_COOKIE_NAME } from "@/lib/session";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { DashboardClock } from "@/components/dashboard/DashboardClock";
import { DashboardGreeting } from "@/components/dashboard/DashboardGreeting";
import { formatItemKey } from "@/lib/items";
import { requireAuthedPageContext } from "../server-data";

async function logout() {
  "use server";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOM_SESSION_COOKIE_NAME);
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

function toTitleLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function getProgressPercent(lastTickAt: string | null | undefined, intervalSeconds: number, running: boolean): number {
  if (!running || !lastTickAt || intervalSeconds <= 0) return 0;
  const elapsedMs = Date.now() - new Date(lastTickAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.max(0, Math.min(100, (elapsedMs / (intervalSeconds * 1000)) * 100));
}

function getBusinessIcon(type: string): string {
  if (type.includes("mine")) return "⛏️";
  if (type.includes("farm")) return "🌾";
  if (type.includes("water")) return "💧";
  if (type.includes("store")) return "🏪";
  if (type.includes("factory")) return "🏭";
  if (type.includes("workshop")) return "🛠️";
  if (type.includes("well")) return "🛢️";
  return "🏢";
}

export default async function DashboardPage() {
  const { supabase, user, character } = await requireAuthedPageContext();
  const player = await getPlayer(supabase, user.id).catch(() => null);

  const [activeTravel, currentCity] = await Promise.all([
    getActiveTravel(supabase, user.id).catch(() => null),
    character.current_city_id
      ? getCityById(supabase, character.current_city_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const destinationCity = activeTravel
    ? await getCityById(supabase, activeTravel.to_city_id).catch(() => null)
    : null;

  const [
    bankingSnapshot,
    businessesWithBalances,
    employeeSummary,
    marketTransactions,
    storefrontSettings,
    tickHealth,
    storefrontPerformance,
    adminEconomySummary,
    res1,
    mfgRes,
    extRes,
  ] = await Promise.all([
    getBankingSnapshot(supabase, user.id).catch(() => null),
    getBusinessesWithBalances(supabase, user.id).catch(() => []),
    getEmployeeSummary(supabase, user.id).catch(() => null),
    getMarketTransactions(supabase, user.id, 20).catch(() => []),
    getMarketStorefrontSettings(supabase, user.id).catch(() => []),
    getTickHealthSummary(supabase, 24).catch(() => null),
    getStorefrontPerformanceSummary(supabase, user.id, 24).catch(() => null),
    player?.role === "admin" ? getAdminEconomySummary(supabase, 24).catch(() => null) : Promise.resolve(null),
    supabase
      .from("shipping_queue")
      .select("id", { count: "exact", head: true })
      .eq("owner_player_id", user.id)
      .eq("status", "in_transit"),
    supabase
      .from("manufacturing_jobs")
      .select("id, business_id, status, active_recipe_key, worker_assigned, last_tick_at, updated_at, business:businesses!inner(name, type, player_id)")
      .eq("businesses.player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("extraction_slots")
      .select("id, business_id, slot_number, employee_id, status, tool_item_key, last_extracted_at, updated_at, business:businesses!inner(name, type, player_id)")
      .eq("businesses.player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);
  const businessSummary = summarizeBusinessesWithBalances(businessesWithBalances);

  const mfgJobs = (mfgRes.data ?? []) as Array<any>;
  const extSlots = (extRes.data ?? []) as Array<any>;
  const extractionEmployeeIds = Array.from(
    new Set(extSlots.map((slot) => slot.employee_id).filter((id): id is string => Boolean(id)))
  );
  const extractionBusinessIds = Array.from(
    new Set(extSlots.map((slot) => slot.business_id).filter((id): id is string => Boolean(id)))
  );
  const [employeeRowsRes, assignmentRowsRes] = extractionEmployeeIds.length
    ? await Promise.all([
        supabase
          .from("employees")
          .select("id, status, shift_ends_at")
          .in("id", extractionEmployeeIds),
        supabase
          .from("employee_assignments")
          .select("employee_id, business_id, role, slot_number")
          .in("employee_id", extractionEmployeeIds)
          .in("business_id", extractionBusinessIds),
      ])
    : [{ data: [] as Array<any> }, { data: [] as Array<any> }];
  const employeeById = new Map(((employeeRowsRes.data ?? []) as Array<any>).map((row) => [String(row.id), row]));
  const assignmentByEmployeeAndBusiness = new Map(
    ((assignmentRowsRes.data ?? []) as Array<any>).map((row) => [`${String(row.employee_id)}:${String(row.business_id)}`, row])
  );
  const activeOperations = [
    ...mfgJobs
      .filter((job) => Boolean(job.active_recipe_key) || job.status === "active")
      .map((job) => {
        const recipe = job.active_recipe_key ? getManufacturingRecipeByKey(job.active_recipe_key) : null;
        const running = job.status === "active" && Boolean(job.active_recipe_key) && Boolean(job.worker_assigned);
        return {
          id: `mfg-${job.id}`,
          businessId: String(job.business_id),
          name: job.business?.name || "Unknown Business",
          detail: recipe ? recipe.displayName : "Manufacturing",
          running,
          statusLabel: toTitleLabel(String(job.status)),
          progressPercent: getProgressPercent(job.last_tick_at, 10 * 60, running),
          createdAt: String(job.updated_at ?? job.last_tick_at ?? new Date(0).toISOString()),
        };
      }),
    ...extSlots
      .filter((slot) => slot.status !== "idle" || Boolean(slot.employee_id))
      .map((slot) => {
        const type = slot.business?.type as keyof typeof EXTRACTION_OUTPUT_ITEM_BY_BUSINESS;
        const itemKey = type ? EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[type] || "Unknown" : "Unknown";
        const employee = slot.employee_id ? employeeById.get(String(slot.employee_id)) : null;
        const assignment = slot.employee_id
          ? assignmentByEmployeeAndBusiness.get(`${String(slot.employee_id)}:${String(slot.business_id)}`)
          : null;
        const employeeEffectiveStatus = employee
          ? getEmployeeStatusFromShift(employee.status, employee.shift_ends_at)
          : null;
        const assignmentMatchesSlot =
          assignment &&
          assignment.role === "production" &&
          (assignment.slot_number === null || Number(assignment.slot_number) === Number(slot.slot_number));
        const running =
          slot.status === "active" &&
          Boolean(slot.employee_id) &&
          Boolean(assignmentMatchesSlot) &&
          employeeEffectiveStatus === "assigned";
        return {
          id: `ext-${slot.id}`,
          businessId: String(slot.business_id),
          name: slot.business?.name || "Unknown Business",
          detail: `${formatItemKey(String(itemKey))} (Slot #${slot.slot_number})`,
          running,
          statusLabel: toTitleLabel(String(slot.status)),
          progressPercent: getProgressPercent(slot.last_extracted_at, 60, running),
          createdAt: String(slot.updated_at ?? slot.last_extracted_at ?? new Date(0).toISOString()),
        };
      }),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const inTransitShippingCount = res1?.count ?? 0;

  const checkingAccount =
    bankingSnapshot?.accounts?.find((account) => account.account_type === "checking") ?? null;
  const pocketCashAccount =
    bankingSnapshot?.accounts?.find((account) => account.account_type === "pocket_cash") ?? null;
  const investmentAccount =
    bankingSnapshot?.accounts?.find((account) => account.account_type === "investment") ?? null;

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
      ...marketTransactions.map((tx) => tx.seller_business_id),
      ...marketTransactions.map((tx) => tx.buyer_business_id).filter((id): id is string => Boolean(id)),
    ])
  ).filter(Boolean);

  const { data: feedBusinesses } =
    feedBusinessIds.length > 0
      ? await supabase.from("businesses").select("id, name").in("id", feedBusinessIds)
      : { data: [] as Array<{ id: string; name: string }> };

  const businessNameById = new Map(((feedBusinesses as Array<{ id: string; name: string }>) ?? []).map((b) => [b.id, b.name]));

  const marketFeed = marketTransactions
    .map((tx) => {
      return {
        id: `tx-${tx.id}`,
        createdAt: tx.created_at,
        line: formatMarketTransactionLine({
          transaction: tx,
          businessNameById,
          formatTimestamp: formatTimeAgo,
        }),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const businessList = [...businessesWithBalances].sort((a, b) => b.balance - a.balance);

  // Helpers for UI
  const pocketBalance = pocketCashAccount ? pocketCashAccount.balance : 0;
  const checkBalance = checkingAccount ? checkingAccount.balance : 0;
  const investmentBalance = investmentAccount ? investmentAccount.balance : null;
  const bizBalance = businessSummary?.totalBusinessBalance ?? 0;
  const loanBalance = bankingSnapshot?.activeLoan ? bankingSnapshot.activeLoan.balance_remaining : 0;

  return (
    <>
      <div className="welcome-strip anim">
          <div className="welcome-left">
            <DashboardGreeting firstName={character.first_name} />
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
            <div className="finance-value">
              {investmentBalance === null ? "N/A" : `$${investmentBalance.toFixed(2)}`}
            </div>
            <div className="finance-sub">
              {investmentBalance === null ? "No account found" : "Available"}
            </div>
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
          <Link className="qa-btn" href="/businesses" prefetch={false}>
            <div className="qa-icon" style={{ background: "var(--accent-green-dim)" }}>🏭</div>
            <div><div className="qa-text">New Business</div><div className="qa-sub">Start a venture</div></div>
          </Link>
          <Link className="qa-btn" href="/inventory" prefetch={false}>
            <div className="qa-icon" style={{ background: "var(--accent-blue-dim)" }}>📦</div>
            <div><div className="qa-text">Inventory</div><div className="qa-sub">Manage stock</div></div>
          </Link>
          <Link className="qa-btn" href="/market" prefetch={false}>
            <div className="qa-icon" style={{ background: "var(--accent-amber-dim)" }}>📊</div>
            <div><div className="qa-text">Player Market</div><div className="qa-sub">Buy & sell goods</div></div>
          </Link>
          <Link className="qa-btn" href="/banking" prefetch={false}>
            <div className="qa-icon" style={{ background: "var(--accent-purple-dim)" }}>🏦</div>
            <div><div className="qa-text">Banking</div><div className="qa-sub">Transfers & loans</div></div>
          </Link>
          <Link className="qa-btn" href="/contracts" prefetch={false}>
            <div className="qa-icon" style={{ background: "var(--accent-cyan-dim)" }}>📝</div>
            <div><div className="qa-text">Contracts</div><div className="qa-sub">Pending bids</div></div>
          </Link>
          <Link className="qa-btn" href="/employees" prefetch={false}>
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
              <Link href="/businesses" prefetch={false} className="card-action">View All →</Link>
            </div>
            <div className="card-body card-body-scroll">
              {businessList.length > 0 ? (
                businessList.map((business) => (
                  <Link href={`/businesses/${business.id}`} prefetch={false} key={business.id} className="biz-item" style={{ textDecoration: "none" }}>
                    <div className="biz-icon" style={{ background: "var(--accent-amber-dim)", color: "var(--accent-amber)" }}>
                      {getBusinessIcon(business.type)}
                    </div>
                    <div className="biz-info">
                      <div className="biz-name">{business.name}</div>
                      <div className="biz-meta">{business.type.replace(/_/g, " ")}</div>
                    </div>
                    <div className="biz-status">
                      <span className="status-badge status-producing">Active</span>
                      <span className="biz-profit">${business.balance.toFixed(2)}</span>
                    </div>
                  </Link>
                ))
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
              <Link href="/businesses" prefetch={false} className="card-action">Manage →</Link>
            </div>
            <div className="card-body card-body-scroll">
              {activeOperations.length > 0 ? (
                activeOperations.map((op) => (
                  <Link
                    href={`/businesses/${op.businessId}?tab=operations`}
                    prefetch={false}
                    key={op.id}
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <div className="mfg-item" style={{ cursor: "pointer", transition: "transform 0.2s" }}>
                      <div className="mfg-top">
                        <div className="mfg-name">{op.name}</div>
                        <div className="mfg-recipe" style={{ textTransform: "capitalize" }}>{op.detail}</div>
                      </div>
                      <div className="mfg-bar-track">
                        <div
                          className={`mfg-bar-fill ${op.running ? "anim-pulse" : ""}`}
                          style={{
                            width: `${op.progressPercent.toFixed(0)}%`,
                            background: op.running ? "var(--accent-green)" : "var(--accent-red)",
                          }}
                        ></div>
                      </div>
                      <div className="mfg-bottom">
                        <div className="mfg-inputs">
                          <span className={`input-chip ${op.running ? "input-filled" : "input-empty"}`}>
                            Status: {op.statusLabel}
                          </span>
                        </div>
                        <div
                          className="mfg-countdown"
                          style={{ color: op.running ? "var(--accent-green)" : "var(--accent-red)" }}
                        >
                          {op.running ? "Running" : "Not Producing"}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))
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
                <Link href="/market" prefetch={false} className="card-action">Full Market →</Link>
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
              <Link href="/employees" prefetch={false} className="card-action">Hire / Manage →</Link>
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
