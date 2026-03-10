"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { STARTUP_COSTS } from "@/config/businesses";
import type { BusinessType } from "@/domains/businesses";
import { apiPost } from "@/lib/client/api";
import { fetchBusinessesPageData, queryKeys, type BusinessesPageData } from "@/lib/client/queries";
import { apiRoutes } from "@/lib/client/routes";
import { formatCurrency, formatDateTime, formatLabel } from "@/lib/formatters";
import { BUSINESS_TYPE_LABELS } from "@/lib/businesses";

type Props = {
  initialData: BusinessesPageData;
};

const TYPE_ICONS: Record<BusinessType, string> = {
  mine: "MN",
  farm: "FM",
  water_company: "WC",
  logging_camp: "LC",
  oil_well: "OW",
  sawmill: "SM",
  metalworking_factory: "MF",
  food_processing_plant: "FP",
  winery_distillery: "WD",
  carpentry_workshop: "CW",
  general_store: "GS",
  specialty_store: "SS",
};

function MetricCard(props: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "positive" | "accent" | "warn";
}) {
  const color =
    props.tone === "positive"
      ? "#86efac"
      : props.tone === "accent"
        ? "#7dd3fc"
        : props.tone === "warn"
          ? "#fcd34d"
          : "#f8fafc";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(10, 17, 31, 0.95), rgba(6, 10, 19, 0.94))",
        border: "1px solid rgba(148, 163, 184, 0.14)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800, color }}>{props.value}</div>
      <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div>
    </div>
  );
}

function Panel(props: { title: string; eyebrow?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        marginTop: 0,
        background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 18,
        padding: 18,
        ...props.style,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        {props.eyebrow ? (
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>
            {props.eyebrow}
          </div>
        ) : null}
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

function FieldLabel(props: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", marginBottom: 6 }}>
      {props.children}
    </div>
  );
}

function StatusBadge(props: { children: ReactNode; tone?: "good" | "bad" | "neutral" | "warn" }) {
  const styles =
    props.tone === "good"
      ? { border: "1px solid rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.12)", color: "#86efac" }
      : props.tone === "bad"
        ? { border: "1px solid rgba(248, 113, 113, 0.3)", background: "rgba(248, 113, 113, 0.12)", color: "#fca5a5" }
        : props.tone === "warn"
          ? { border: "1px solid rgba(251, 191, 36, 0.3)", background: "rgba(251, 191, 36, 0.12)", color: "#fcd34d" }
          : { border: "1px solid rgba(96, 165, 250, 0.28)", background: "rgba(96, 165, 250, 0.12)", color: "#bfdbfe" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...styles,
      }}
    >
      {props.children}
    </span>
  );
}

function EmptyState(props: { children: ReactNode }) {
  return <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{props.children}</div>;
}

export default function BusinessesClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const businessesPageQuery = useQuery({
    queryKey: queryKeys.businessesPage,
    queryFn: fetchBusinessesPageData,
    initialData,
  });

  const businesses = businessesPageQuery.data.businesses;
  const summary = businessesPageQuery.data.summary;
  const cities = businessesPageQuery.data.cities;
  const travelState = businessesPageQuery.data.travelState;

  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<BusinessType>("farm");
  const [createCityId, setCreateCityId] = useState(initialData.travelState.currentCity?.id ?? "");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (travelState.currentCity?.id) {
      setCreateCityId((current) => current || travelState.currentCity!.id);
    }
  }, [travelState.currentCity?.id]);

  const cityById = useMemo(
    () =>
      Object.fromEntries(cities.map((city) => [city.id, `${city.name}, ${city.state}`])),
    [cities]
  );

  const portfolioMetrics = useMemo(() => {
    const totalValue = businesses.reduce((sum, business) => sum + business.value, 0);
    const profitableCount = businesses.filter((business) => business.balance >= STARTUP_COSTS[business.type]).length;
    const underfundedCount = businesses.filter((business) => business.balance < STARTUP_COSTS[business.type] * 0.5).length;
    const cityCount = new Set(businesses.map((business) => business.city_id)).size;
    const averageBalance = businesses.length > 0 ? (summary?.totalBusinessBalance ?? 0) / businesses.length : 0;

    return {
      totalValue,
      profitableCount,
      underfundedCount,
      cityCount,
      averageBalance,
    };
  }, [businesses, summary?.totalBusinessBalance]);

  const businessCards = useMemo(
    () =>
      [...businesses]
        .sort((a, b) => b.balance - a.balance)
        .map((business) => {
          const startupCost = STARTUP_COSTS[business.type];
          const cityLabel = cityById[business.city_id] ?? "Unknown city";
          const capitalCoverage = startupCost > 0 ? business.balance / startupCost : 0;
          const portfolioShare = (summary?.totalBusinessBalance ?? 0) > 0 ? business.balance / (summary?.totalBusinessBalance ?? 0) : 0;
          const valuationDelta = business.value - startupCost;
          const healthTone: "good" | "warn" | "bad" = capitalCoverage >= 1 ? "good" : capitalCoverage >= 0.5 ? "warn" : "bad";
          const healthLabel =
            capitalCoverage >= 1 ? "Well Funded" : capitalCoverage >= 0.5 ? "Watching Cash" : "Needs Capital";

          return {
            business,
            startupCost,
            cityLabel,
            capitalCoverage,
            portfolioShare,
            valuationDelta,
            healthTone,
            healthLabel,
          };
        }),
    [businesses, cityById, summary?.totalBusinessBalance]
  );

  async function submitCreateBusiness() {
    if (creating) return;
    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      await apiPost(
        apiRoutes.businesses.root,
        {
          name: createName,
          type: createType,
          cityId: createCityId,
        },
        { fallbackError: "Failed to create business." }
      );

      setCreateName("");
      setSuccess("Business created successfully.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.businessesPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bankingPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.marketPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.employeesPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contractsPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.productionPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.appShell }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create business.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="anim" style={{ display: "grid", gap: 18 }}>
      <header className="lc-page-header">
        <div>
          <h1>Businesses</h1>
          <p>Your businesses.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      <section
        style={{
          marginTop: 0,
          background:
            "radial-gradient(circle at top left, rgba(14, 165, 233, 0.12), transparent 30%), radial-gradient(circle at top right, rgba(34, 197, 94, 0.12), transparent 30%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Portfolio Command</div>
            <div style={{ marginTop: 8, fontSize: "1.95rem", fontWeight: 800, color: "#f8fafc" }}>
              Businesses
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              Check your holdings, watch your cash, and step into any shop, field, or factory you own.
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
            <StatusBadge tone={businessesPageQuery.isFetching ? "warn" : "good"}>
              {businessesPageQuery.isFetching ? "Refreshing Portfolio" : "Portfolio Live"}
            </StatusBadge>
            <StatusBadge tone={travelState.activeTravel ? "warn" : travelState.canPurchaseBusiness ? "good" : "neutral"}>
              {travelState.activeTravel
                ? "Travel In Progress"
                : travelState.canPurchaseBusiness
                  ? "Expansion Eligible"
                  : "Expansion Restricted"}
            </StatusBadge>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Current city: {travelState.currentCity?.name ?? "Unknown"}
              {travelState.activeTravel ? " while traveling" : ""}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
          <MetricCard
            label="Owned Businesses"
            value={`${summary?.totalBusinesses ?? 0}`}
            sub={`${portfolioMetrics.cityCount} active city${portfolioMetrics.cityCount === 1 ? "" : "ies"} in portfolio`}
            tone="accent"
          />
          <MetricCard
            label="Business Cash"
            value={formatCurrency(summary?.totalBusinessBalance ?? 0)}
            sub={`${formatCurrency(portfolioMetrics.averageBalance)} average balance per business`}
            tone="positive"
          />
          <MetricCard
            label="Portfolio Value"
            value={formatCurrency(portfolioMetrics.totalValue)}
            sub={`${summary?.producingTypesOwned ?? 0} producing type${summary?.producingTypesOwned === 1 ? "" : "s"} represented`}
            tone="neutral"
          />
          <MetricCard
            label="Top Business"
            value={summary?.topBusiness ? summary.topBusiness.name : "None"}
            sub={
              summary?.topBusiness
                ? `${formatCurrency(summary.topBusiness.balance)} operating cash`
                : "Create a business to begin"
            }
            tone="warn"
          />
        </div>
      </section>

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(248, 113, 113, 0.28)",
            background: "rgba(127, 29, 29, 0.22)",
            color: "#fecaca",
          }}
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(34, 197, 94, 0.24)",
            background: "rgba(20, 83, 45, 0.18)",
            color: "#bbf7d0",
          }}
        >
          {success}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(320px, 1fr)", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Business Portfolio" eyebrow="Operating Entities">
            {businessCards.length === 0 ? (
              <EmptyState>No businesses yet. Use the launch panel to open your first operation.</EmptyState>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {businessCards.map(({ business, startupCost, cityLabel, capitalCoverage, portfolioShare, valuationDelta, healthTone, healthLabel }) => (
                  <Link
                    key={business.id}
                    href={`/businesses/${business.id}`}
                    prefetch={false}
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                      border: "1px solid rgba(148, 163, 184, 0.14)",
                      borderRadius: 18,
                      padding: 18,
                      background:
                        "radial-gradient(circle at top right, rgba(96, 165, 250, 0.08), transparent 24%), linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
                      display: "grid",
                      gap: 14,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 14,
                            display: "grid",
                            placeItems: "center",
                            fontSize: 22,
                            background: "rgba(15, 23, 42, 0.9)",
                            border: "1px solid rgba(148, 163, 184, 0.12)",
                          }}
                        >
                          {TYPE_ICONS[business.type]}
                        </div>
                        <div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#f8fafc" }}>{business.name}</h3>
                            <StatusBadge tone={healthTone}>{healthLabel}</StatusBadge>
                          </div>
                          <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>
                            {BUSINESS_TYPE_LABELS[business.type]} | {formatLabel(business.entity_type)} | {cityLabel}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f8fafc" }}>{formatCurrency(business.balance)}</div>
                        <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: 12 }}>Operating balance</div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                      <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Business Value</div>
                        <div style={{ marginTop: 6, fontWeight: 700 }}>{formatCurrency(business.value)}</div>
                      </div>
                      <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Startup Benchmark</div>
                        <div style={{ marginTop: 6, fontWeight: 700 }}>{formatCurrency(startupCost)}</div>
                      </div>
                      <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Capital Coverage</div>
                        <div style={{ marginTop: 6, fontWeight: 700 }}>{capitalCoverage.toFixed(2)}x</div>
                      </div>
                      <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Portfolio Share</div>
                        <div style={{ marginTop: 6, fontWeight: 700 }}>{(portfolioShare * 100).toFixed(1)}%</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                        {valuationDelta >= 0 ? "Value above startup benchmark" : "Value below startup benchmark"} by{" "}
                        <span style={{ color: valuationDelta >= 0 ? "#86efac" : "#fca5a5", fontWeight: 700 }}>
                          {formatCurrency(Math.abs(valuationDelta))}
                        </span>
                        {" "} | Opened {formatDateTime(business.created_at)}
                      </div>
                      <div style={{ color: "#bfdbfe", fontWeight: 700, fontSize: 13 }}>Open Business</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Portfolio Signals" eyebrow="Snapshot">
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  background: "rgba(8, 13, 24, 0.7)",
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                  Capital Health
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Well-funded businesses</span>
                    <strong>{portfolioMetrics.profitableCount}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Low-cash businesses</span>
                    <strong>{portfolioMetrics.underfundedCount}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Current city</span>
                    <strong>{travelState.currentCity?.name ?? "Unknown"}</strong>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  background: "rgba(8, 13, 24, 0.7)",
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                  Expansion Context
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
                  {travelState.activeTravel
                    ? "You are currently in transit. Expansion options remain visible, but launch timing should account for travel state."
                    : travelState.canPurchaseBusiness
                      ? "You can open another business from this page. Choose a city and type, then fund the next operating entity."
                      : "Expansion is currently restricted. Review location and travel requirements before opening another operation."}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Launch New Business" eyebrow="Expansion Desk">
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <FieldLabel>Business Name</FieldLabel>
                <input
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Heartland Wheat Farm"
                />
              </label>

              <label>
                <FieldLabel>Business Type</FieldLabel>
                <select
                  value={createType}
                  onChange={(event) => setCreateType(event.target.value as BusinessType)}
                  title="Business type"
                >
                  {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <FieldLabel>City</FieldLabel>
                <select value={createCityId} onChange={(event) => setCreateCityId(event.target.value)} title="City">
                  <option value="">Select city</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}, {city.state}
                    </option>
                  ))}
                </select>
              </label>

              <div
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  borderRadius: 14,
                  padding: 14,
                  background: "rgba(8, 13, 24, 0.72)",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Launch Preview</div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--text-secondary)" }}>Selected type</span>
                  <strong>{BUSINESS_TYPE_LABELS[createType]}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--text-secondary)" }}>Startup benchmark</span>
                  <strong>{formatCurrency(STARTUP_COSTS[createType])}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--text-secondary)" }}>Launch city</span>
                  <strong>{createCityId ? cityById[createCityId] ?? "Unknown city" : "Select city"}</strong>
                </div>
              </div>

              <button
                onClick={() => void submitCreateBusiness()}
                disabled={!createName.trim() || !createCityId || !travelState.canPurchaseBusiness || creating}
              >
                {creating ? "Creating..." : "Create Business"}
              </button>

              <div style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
                Expansion requires a valid city selection and current purchase eligibility. This creates the business, then refreshes banking,
                inventory, employees, production, and portfolio views.
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
