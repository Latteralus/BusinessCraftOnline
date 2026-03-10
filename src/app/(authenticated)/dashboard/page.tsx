import { Suspense, cache } from "react";
import { getBankingSnapshot } from "@/domains/banking";
import { getBusinessesWithBalances, summarizeBusinessesWithBalances } from "@/domains/businesses";
import { getActiveTravel, getCityById } from "@/domains/cities-travel";
import { getEmployeeStatusFromShift, getEmployeeSummary } from "@/domains/employees";
import {
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
import { ActiveOperationsCard } from "@/components/dashboard/ActiveOperationsCard";
import { TooltipLabel } from "@/components/ui/tooltip";
import { formatBusinessType } from "@/lib/businesses";
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

type DashboardOperation = {
  id: string;
  businessId: string;
  name: string;
  detail: string;
  running: boolean;
  statusLabel: string;
  intervalSeconds: number;
  lastProgressAt: string | null;
  createdAt: string;
};

const DASHBOARD_TIMING_ENABLED = process.env.DASHBOARD_TIMING === "1";

async function measureDashboardQuery<T>(
  timings: Array<{ label: string; durationMs: number }>,
  label: string,
  task: () => PromiseLike<T>
): Promise<T> {
  const startedAt = performance.now();
  const result = await task();
  timings.push({ label, durationMs: performance.now() - startedAt });
  return result;
}

const loadDeferredDashboardData = cache(async (userId: string) => {
  const supabase = await createSupabaseServerClient();

  const [marketTransactions, tickHealth, storefrontPerformance, shippingRes, mfgRes, extRes] = await Promise.all([
    getMarketTransactions(supabase, userId, 20, { buyerType: "player" }).catch(() => []),
    getTickHealthSummary(supabase, 24).catch(() => null),
    getStorefrontPerformanceSummary(supabase, userId, 24).catch(() => null),
    supabase
      .from("shipping_queue")
      .select("id", { count: "exact", head: true })
      .eq("owner_player_id", userId)
      .eq("status", "in_transit"),
    supabase
      .from("manufacturing_jobs")
      .select("id, business_id, status, active_recipe_key, worker_assigned, last_tick_at, updated_at, business:businesses!inner(name, type, player_id)")
      .eq("businesses.player_id", userId)
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("extraction_slots")
      .select("id, business_id, slot_number, employee_id, status, tool_item_key, last_extracted_at, updated_at, business:businesses!inner(name, type, player_id)")
      .eq("businesses.player_id", userId)
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

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

  const activeOperations: DashboardOperation[] = [
    ...((mfgRes.data ?? []) as Array<any>)
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
          intervalSeconds: 60,
          lastProgressAt: job.last_tick_at ? String(job.last_tick_at) : null,
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
          intervalSeconds: 60,
          lastProgressAt: slot.last_extracted_at ? String(slot.last_extracted_at) : null,
          createdAt: String(slot.updated_at ?? slot.last_extracted_at ?? new Date(0).toISOString()),
        };
      }),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const marketFeed = marketTransactions
    .map((tx) => ({
      id: `tx-${tx.id}`,
      createdAt: tx.created_at,
      line: formatMarketTransactionLine({
        transaction: tx,
        formatTimestamp: formatTimeAgo,
      }),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return {
    marketFeed,
    tickHealth,
    storefrontPerformance,
    inTransitShippingCount: shippingRes.count ?? 0,
    activeOperations,
  };
});

function DashboardCardFallback({
  title,
  action,
  className,
  style,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={className ?? "card"} style={style}>
      <div className="card-header">
        <div className="card-title">{title}</div>
        {action ?? null}
      </div>
      <div className="card-body">
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>Loading...</p>
      </div>
    </div>
  );
}

async function DashboardActiveOperationsSection({ userId }: { userId: string }) {
  const { activeOperations } = await loadDeferredDashboardData(userId);
  return <ActiveOperationsCard operations={activeOperations} />;
}

async function DashboardMarketWatchCard({ userId }: { userId: string }) {
  const { marketFeed } = await loadDeferredDashboardData(userId);

  return (
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
        {marketFeed.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No recent market activity.</p>
        ) : null}
      </div>
    </div>
  );
}

async function DashboardSystemStatusCard({ userId }: { userId: string }) {
  const { tickHealth, inTransitShippingCount } = await loadDeferredDashboardData(userId);

  return (
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
            <div className="tx-desc"><TooltipLabel label="Tick Success Rate" content="Percentage of economy ticks that completed successfully in the last 24 hours." /></div>
            <div className="tx-time">Last 24 hours</div>
          </div>
          <div className="tx-amount">{tickHealth ? `${(tickHealth.success_rate * 100).toFixed(1)}%` : "N/A"}</div>
        </div>
        <div className="tx-item">
          <div className="tx-icon" style={{ background: "var(--accent-green-dim)", color: "var(--accent-green)" }}>↓</div>
          <div className="tx-info">
            <div className="tx-desc"><TooltipLabel label="In-Transit Shipping" content="Shipments that are currently on the road and not yet delivered." /></div>
            <div className="tx-time">Currently moving</div>
          </div>
          <div className="tx-amount">{inTransitShippingCount} items</div>
        </div>
      </div>
    </div>
  );
}

async function DashboardBusinessOverviewCard({ userId }: { userId: string }) {
  const { storefrontPerformance } = await loadDeferredDashboardData(userId);

  return (
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
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}><TooltipLabel label="Storefront Net" content="Storefront revenue remaining after storefront-specific costs are deducted." /></div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "1rem", fontWeight: 600, color: "var(--accent-green)", marginTop: 4 }}>
              ${storefrontPerformance?.net_revenue.toFixed(2) ?? "0.00"}
            </div>
          </div>
          <div style={{ background: "var(--bg-primary)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}><TooltipLabel label="Ad Spend" content="Advertising budget consumed by your storefront settings in the reporting window." /></div>
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
  );
}

export default async function DashboardPage() {
  const timings: Array<{ label: string; durationMs: number }> = [];
  const dashboardStartedAt = performance.now();
  const { supabase, user, character } = await requireAuthedPageContext();
  const currentCityId = character.current_city_id;

  const [activeTravel, currentCity, bankingSnapshot, businessesWithBalances, employeeSummary] = await Promise.all([
    measureDashboardQuery(timings, "getActiveTravel", () => getActiveTravel(supabase, user.id).catch(() => null)),
    currentCityId
      ? measureDashboardQuery(timings, "getCurrentCity", () => getCityById(supabase, currentCityId).catch(() => null))
      : Promise.resolve(null),
    measureDashboardQuery(timings, "getBankingSnapshot", () => getBankingSnapshot(supabase, user.id).catch(() => null)),
    measureDashboardQuery(timings, "getBusinessesWithBalances", () => getBusinessesWithBalances(supabase, user.id).catch(() => [])),
    measureDashboardQuery(timings, "getEmployeeSummary", () => getEmployeeSummary(supabase, user.id).catch(() => null)),
  ]);

  const destinationCity = activeTravel?.to_city_id
    ? await measureDashboardQuery(timings, "getDestinationCity", () => getCityById(supabase, activeTravel.to_city_id).catch(() => null))
    : null;

  const businessSummary = summarizeBusinessesWithBalances(businessesWithBalances);
  const businessList = [...businessesWithBalances].sort((a, b) => b.balance - a.balance);

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

  const pocketBalance = pocketCashAccount ? pocketCashAccount.balance : 0;
  const checkBalance = checkingAccount ? checkingAccount.balance : 0;
  const investmentBalance = investmentAccount ? investmentAccount.balance : null;
  const bizBalance = businessSummary?.totalBusinessBalance ?? 0;
  const loanBalance = bankingSnapshot?.activeLoan ? bankingSnapshot.activeLoan.balance_remaining : 0;

  if (DASHBOARD_TIMING_ENABLED) {
    console.info(
      "[dashboard] critical timings",
      JSON.stringify({
        totalMs: Number((performance.now() - dashboardStartedAt).toFixed(2)),
        phases: timings
          .map((entry) => ({
            label: entry.label,
            durationMs: Number(entry.durationMs.toFixed(2)),
          }))
          .sort((a, b) => b.durationMs - a.durationMs),
      })
    );
  }

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
            <TooltipLabel label="Pocket Cash" content="Cash carried by your character for immediate personal use." />
          </div>
          <div className="finance-value">${pocketBalance.toFixed(2)}</div>
          <div className="finance-sub"><span className="up">Available</span></div>
        </div>

        <div className="finance-card" style={{ "--card-accent": "var(--accent-blue)" } as any}>
          <div className="finance-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            <TooltipLabel label="Checking Account" content="Your main bank account for liquid funds, transfers, and loan payments." />
          </div>
          <div className="finance-value">${checkBalance.toFixed(2)}</div>
          <div className="finance-sub"><span className="up">Available</span></div>
        </div>

        <div className="finance-card" style={{ "--card-accent": "var(--gold)" } as any}>
          <div className="finance-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h18v18H3z"/><path d="M7 14l3-3 2 2 5-5"/></svg>
            <TooltipLabel label="Business Accounts" content="Combined treasury balances across all of your owned businesses." />
          </div>
          <div className="finance-value">${bizBalance.toFixed(2)}</div>
          <div className="finance-sub">Across {businessSummary?.totalBusinesses ?? 0} businesses</div>
        </div>

        <div className="finance-card" style={{ "--card-accent": "var(--accent-purple)" } as any}>
          <div className="finance-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <TooltipLabel label="Investment Account" content="Optional personal capital account for parked funds outside checking and pocket cash." />
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
            <TooltipLabel label="Loan Balance" content="Outstanding principal still owed on your active loan." />
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
                    <div className="biz-meta">{formatBusinessType(business.type)}</div>
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

        <Suspense fallback={<DashboardCardFallback title="Active Operations" className="card anim anim-d4" action={<Link href="/businesses" prefetch={false} className="card-action">Manage →</Link>} />}>
          <DashboardActiveOperationsSection userId={user.id} />
        </Suspense>

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

          <Suspense fallback={<DashboardCardFallback title="Market Watch" className="card anim anim-d6" style={{ flex: 1 }} action={<Link href="/market" prefetch={false} className="card-action">Full Market →</Link>} />}>
            <DashboardMarketWatchCard userId={user.id} />
          </Suspense>
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

        <Suspense fallback={<DashboardCardFallback title="System Status" className="card anim anim-d7" action={<button className="card-action">Details →</button>} />}>
          <DashboardSystemStatusCard userId={user.id} />
        </Suspense>

        <Suspense fallback={<DashboardCardFallback title="Business Overview" className="card anim anim-d8" style={{ gridColumn: 3, gridRow: 2 }} />}>
          <DashboardBusinessOverviewCard userId={user.id} />
        </Suspense>
      </div>
    </>
  );
}
