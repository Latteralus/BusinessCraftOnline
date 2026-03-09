"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NPC_PRICE_CEILINGS } from "@/config/items";
import type { MarketStorefrontSetting } from "@/domains/market";
import { formatMarketTransactionLine } from "@/domains/market/feed";
import { formatCurrency } from "@/lib/formatters";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { fetchMarketPageData, queryKeys, type MarketPageData } from "@/lib/client/queries";
import { formatItemKey } from "@/lib/items";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  initialData: MarketPageData;
};

function MarketMetric(props: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "positive" | "negative" | "accent";
}) {
  const color =
    props.tone === "positive"
      ? "#86efac"
      : props.tone === "negative"
        ? "#fca5a5"
        : props.tone === "accent"
          ? "#7dd3fc"
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

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function MarketClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const marketPageQuery = useQuery({
    queryKey: queryKeys.marketPage,
    queryFn: fetchMarketPageData,
    initialData,
  });

  const businesses = marketPageQuery.data.businesses;
  const listings = marketPageQuery.data.listings;
  const transactions = marketPageQuery.data.transactions;
  const storefrontByBusinessId = Object.fromEntries(
    marketPageQuery.data.storefront.map((row) => [row.business_id, row])
  ) as Record<string, MarketStorefrontSetting>;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sourceBusinessId, setSourceBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [buyerBusinessId, setBuyerBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [itemKey, setItemKey] = useState(Object.keys(NPC_PRICE_CEILINGS)[0] ?? "");
  const [quality, setQuality] = useState(50);
  const [quantity, setQuantity] = useState(5);
  const [unitPrice, setUnitPrice] = useState(5);
  const [buyQuantityByListingId, setBuyQuantityByListingId] = useState<Record<string, number>>({});
  const [storefrontAdBudget, setStorefrontAdBudget] = useState(0);
  const [storefrontTrafficMultiplier, setStorefrontTrafficMultiplier] = useState(1);
  const [storefrontAdEnabled, setStorefrontAdEnabled] = useState(true);

  const activeListings = useMemo(() => listings.filter((listing) => listing.status === "active"), [listings]);
  const activeStorefronts = useMemo(
    () => marketPageQuery.data.storefront.filter((row) => row.is_ad_enabled),
    [marketPageQuery.data.storefront]
  );

  const sourceBusiness = useMemo(
    () => businesses.find((business) => business.id === sourceBusinessId) ?? null,
    [businesses, sourceBusinessId]
  );

  const buyerBusiness = useMemo(
    () => businesses.find((business) => business.id === buyerBusinessId) ?? null,
    [businesses, buyerBusinessId]
  );

  const listingSummary = useMemo(() => {
    const grossOpenValue = activeListings.reduce((sum, listing) => sum + listing.quantity * listing.unit_price, 0);
    const distinctItems = new Set(activeListings.map((listing) => listing.item_key)).size;
    const cities = new Set(activeListings.map((listing) => listing.city_id)).size;
    const avgAsk =
      activeListings.length > 0
        ? activeListings.reduce((sum, listing) => sum + listing.unit_price, 0) / activeListings.length
        : 0;

    return { grossOpenValue, distinctItems, cities, avgAsk };
  }, [activeListings]);

  const transactionSummary = useMemo(() => {
    const revenue = transactions.reduce((sum, tx) => sum + tx.gross_total, 0);
    const net = transactions.reduce((sum, tx) => sum + tx.net_total, 0);
    const fees = transactions.reduce((sum, tx) => sum + tx.market_fee, 0);
    const units = transactions.reduce((sum, tx) => sum + tx.quantity, 0);
    const npcCount = transactions.filter((tx) => tx.buyer_type === "npc").length;
    const playerCount = transactions.length - npcCount;

    return { revenue, net, fees, units, npcCount, playerCount };
  }, [transactions]);

  const marketFeed = useMemo(() => {
    const businessNameById = new Map<string, string>();
    for (const business of businesses) {
      businessNameById.set(business.id, business.name);
    }
    for (const listing of listings) {
      if (listing.business?.name) {
        businessNameById.set(listing.source_business_id, listing.business.name);
      }
    }

    const listingEvents = listings.map((listing) => ({
      id: `listing-${listing.id}`,
      createdAt: listing.created_at,
      title: `${listing.business?.name ?? "A business"} posted ${formatItemKey(listing.item_key)}`,
      line: `[${formatClock(listing.created_at)}] ${listing.business?.name ?? "A business"} posted ${listing.quantity} ${formatItemKey(
        listing.item_key
      )} at $${listing.unit_price.toFixed(2)} each for $${(listing.quantity * listing.unit_price).toFixed(2)}`,
      kind: "listing" as const,
    }));

    const transactionEvents = transactions.map((tx) => ({
      id: `tx-${tx.id}`,
      createdAt: tx.created_at,
      title: `${formatItemKey(tx.item_key)} trade cleared`,
      line: formatMarketTransactionLine({
        transaction: tx,
        businessNameById,
        formatTimestamp: formatClock,
      }),
      kind: "trade" as const,
    }));

    return [...listingEvents, ...transactionEvents]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 40);
  }, [businesses, listings, transactions]);

  const topItems = useMemo(() => {
    const counts = new Map<string, { quantity: number; listings: number; lowestPrice: number }>();
    for (const listing of activeListings) {
      const current = counts.get(listing.item_key) ?? {
        quantity: 0,
        listings: 0,
        lowestPrice: listing.unit_price,
      };
      current.quantity += listing.quantity;
      current.listings += 1;
      current.lowestPrice = Math.min(current.lowestPrice, listing.unit_price);
      counts.set(listing.item_key, current);
    }

    return [...counts.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [activeListings]);

  useEffect(() => {
    const selected = sourceBusinessId ? storefrontByBusinessId[sourceBusinessId] : null;
    if (!selected) {
      setStorefrontAdBudget(0);
      setStorefrontTrafficMultiplier(1);
      setStorefrontAdEnabled(true);
      return;
    }

    setStorefrontAdBudget(selected.ad_budget_per_tick);
    setStorefrontTrafficMultiplier(selected.traffic_multiplier);
    setStorefrontAdEnabled(selected.is_ad_enabled);
  }, [sourceBusinessId, storefrontByBusinessId]);

  async function refreshMarketData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.marketPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.businessesPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bankingPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventoryPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.appShell }),
    ]);
  }

  async function createListing() {
    if (!sourceBusinessId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(
        apiRoutes.market.root,
        { sourceBusinessId, itemKey, quality, quantity, unitPrice },
        { fallbackError: "Failed to create listing." }
      );
      await refreshMarketData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create listing.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelListing(listingId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(apiRoutes.market.cancel(listingId), undefined, { fallbackError: "Failed to cancel listing." });
      await refreshMarketData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel listing.");
    } finally {
      setBusy(false);
    }
  }

  async function buyListing(listingId: string) {
    if (busy || !buyerBusinessId) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost(
        apiRoutes.market.buy(listingId),
        {
          quantity: Math.max(1, buyQuantityByListingId[listingId] ?? 1),
          buyerBusinessId,
        },
        { fallbackError: "Failed to buy listing." }
      );
      await refreshMarketData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to buy listing.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStorefrontSettings() {
    if (!sourceBusinessId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await apiPost<{ storefront?: MarketStorefrontSetting; error?: string }>(
        apiRoutes.market.storefront,
        {
          businessId: sourceBusinessId,
          adBudgetPerTick: storefrontAdBudget,
          trafficMultiplier: storefrontTrafficMultiplier,
          isAdEnabled: storefrontAdEnabled,
        },
        { fallbackError: "Failed to update storefront settings." }
      );
      if (payload.storefront) {
        await refreshMarketData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update storefront settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim" style={{ display: "grid", gap: 18 }}>
      <header className="lc-page-header">
        <div>
          <h1>Market</h1>
          <p>Operate your wholesale floor, move B2B inventory, and tune storefront demand for NPC and player-driven trade.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      <section
        style={{
          marginTop: 0,
          background:
            "radial-gradient(circle at top left, rgba(251, 191, 36, 0.12), transparent 30%), radial-gradient(circle at top right, rgba(34, 211, 238, 0.12), transparent 28%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Trade Floor</div>
            <div style={{ marginTop: 8, fontSize: "1.95rem", fontWeight: 800, color: "#f8fafc" }}>
              Inventory exchange built for business supply and live storefront demand
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              Publish outbound stock, source inputs for other businesses, and keep your consumer-facing storefronts visible without leaving the business operating stack.
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
            <StatusBadge tone={marketPageQuery.isFetching ? "warn" : "good"}>
              {marketPageQuery.isFetching ? "Refreshing Floor" : "Market Live"}
            </StatusBadge>
            <StatusBadge tone={busy ? "warn" : "neutral"}>{busy ? "Order Processing" : "Ready For Trade"}</StatusBadge>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {activeListings.length} active listings across {listingSummary.distinctItems} item classes
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
          <MarketMetric label="Open Order Book" value={formatCurrency(listingSummary.grossOpenValue)} sub={`${activeListings.length} live asks on the floor`} tone="accent" />
          <MarketMetric label="Recent Gross Sales" value={formatCurrency(transactionSummary.revenue)} sub={`${transactionSummary.units} units cleared in the recent tape`} tone="positive" />
          <MarketMetric label="Net Seller Proceeds" value={formatCurrency(transactionSummary.net)} sub={`${formatCurrency(transactionSummary.fees)} in market fees`} tone="positive" />
          <MarketMetric label="Demand Broadcasts" value={`${activeStorefronts.length}`} sub={`${marketPageQuery.data.storefront.length} storefront configs tracked`} />
          <MarketMetric label="Buyer Mix" value={`${transactionSummary.playerCount}/${transactionSummary.npcCount}`} sub="Player-linked vs NPC-driven trades" />
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

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.9fr)", gap: 18 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Exchange Command" eyebrow="Trade Desk">
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)", gap: 18 }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel>Source Business</FieldLabel>
                    <select value={sourceBusinessId} onChange={(event) => setSourceBusinessId(event.target.value)} title="Source business">
                      <option value="">Select business</option>
                      {businesses.map((business) => (
                        <option key={business.id} value={business.id}>
                          {business.name} ({business.type})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel>Buyer Business</FieldLabel>
                    <select value={buyerBusinessId} onChange={(event) => setBuyerBusinessId(event.target.value)} title="Buyer business">
                      <option value="">Select business</option>
                      {businesses.map((business) => (
                        <option key={business.id} value={business.id}>
                          {business.name} ({business.type})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel>Item</FieldLabel>
                    <select value={itemKey} onChange={(event) => setItemKey(event.target.value)} title="Item key">
                      {Object.keys(NPC_PRICE_CEILINGS).map((key) => (
                        <option key={key} value={key}>
                          {formatItemKey(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel>Quality</FieldLabel>
                    <input type="number" min={1} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value) || 1)} />
                  </label>
                  <label>
                    <FieldLabel>Quantity</FieldLabel>
                    <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 1)} />
                  </label>
                  <label>
                    <FieldLabel>Unit Price</FieldLabel>
                    <input type="number" min={0.01} step={0.01} value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value) || 0.01)} />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => void createListing()} disabled={busy || !sourceBusinessId}>
                    {busy ? "Publishing..." : "Publish Listing"}
                  </button>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    Listing ticket: {quantity} {formatItemKey(itemKey)} at {formatCurrency(unitPrice)} each for {formatCurrency(quantity * unitPrice)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  borderRadius: 16,
                  padding: 16,
                  background: "rgba(8, 13, 24, 0.72)",
                  display: "grid",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 6 }}>
                    Desk Readout
                  </div>
                  <div style={{ color: "#f8fafc", fontSize: "1.1rem", fontWeight: 700 }}>
                    {sourceBusiness?.name ?? "Select a source business"}
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>
                    {sourceBusiness ? `Cash on hand ${formatCurrency(sourceBusiness.balance)}` : "Choose where inventory will enter the market."}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Current ask</span>
                    <strong>{formatCurrency(unitPrice)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Weighted floor avg</span>
                    <strong>{formatCurrency(listingSummary.avgAsk)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Destination routing</span>
                    <strong>{buyerBusiness?.name ?? "No buyer selected"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Market coverage</span>
                    <strong>{listingSummary.cities} cities</strong>
                  </div>
                </div>

                <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  Use the buyer selector as your active B2B routing target while browsing the floor. Storefront demand settings below control NPC traffic pressure for retail-style sell-through.
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Active Order Book" eyebrow="Listings">
            {activeListings.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>No active listings found. Publish inventory to open the floor.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {activeListings.map((listing) => {
                  const requestedQty = Math.max(1, Math.min(listing.quantity, buyQuantityByListingId[listing.id] ?? 1));
                  const total = requestedQty * listing.unit_price;
                  const isOwnSource = listing.source_business_id === sourceBusinessId;

                  return (
                    <article
                      key={listing.id}
                      style={{
                        border: "1px solid rgba(148, 163, 184, 0.14)",
                        borderRadius: 16,
                        padding: 16,
                        background:
                          "radial-gradient(circle at top right, rgba(96, 165, 250, 0.07), transparent 24%), linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                            <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{formatItemKey(listing.item_key)}</h3>
                            <StatusBadge tone={isOwnSource ? "good" : "neutral"}>{isOwnSource ? "Selected Seller" : "Open Ask"}</StatusBadge>
                            <StatusBadge tone="warn">Q{listing.quality}</StatusBadge>
                          </div>
                          <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                            {listing.business?.name ?? `Business ${listing.source_business_id.slice(0, 8)}`} posted this lot on {formatTimestamp(listing.created_at)}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Asking Price</div>
                          <div style={{ marginTop: 4, fontWeight: 800, fontSize: "1.2rem", color: "#f8fafc" }}>{formatCurrency(listing.unit_price)}</div>
                          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{formatCurrency(listing.quantity * listing.unit_price)} full lot</div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Available</div>
                          <div style={{ marginTop: 6, fontWeight: 700 }}>{listing.quantity} units</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Buyer Route</div>
                          <div style={{ marginTop: 6, fontWeight: 700 }}>{buyerBusiness?.name ?? "Select buyer"}</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Trade Status</div>
                          <div style={{ marginTop: 6, fontWeight: 700, textTransform: "capitalize" }}>{listing.status}</div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
                        <label style={{ minWidth: 110 }}>
                          <FieldLabel>Buy Qty</FieldLabel>
                          <input
                            type="number"
                            min={1}
                            max={listing.quantity}
                            value={requestedQty}
                            onChange={(event) =>
                              setBuyQuantityByListingId((prev) => ({
                                ...prev,
                                [listing.id]: Number(event.target.value) || 1,
                              }))
                            }
                          />
                        </label>
                        <div style={{ color: "var(--text-secondary)", fontSize: 12, paddingBottom: 10 }}>
                          Ticket value {formatCurrency(total)}
                        </div>
                        <button onClick={() => void buyListing(listing.id)} disabled={busy || !buyerBusinessId}>
                          Buy For {buyerBusiness ? buyerBusiness.name : "Selected Buyer"}
                        </button>
                        <button
                          onClick={() => void cancelListing(listing.id)}
                          disabled={busy}
                          style={{
                            border: "1px solid rgba(148, 163, 184, 0.16)",
                            background: "rgba(15, 23, 42, 0.72)",
                            color: "#e2e8f0",
                          }}
                        >
                          Cancel Listing
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Storefront Broadcast" eyebrow="NPC Demand">
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <FieldLabel>Store Business</FieldLabel>
                <select value={sourceBusinessId} onChange={(event) => setSourceBusinessId(event.target.value)} title="Store business">
                  <option value="">Select business</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name} ({business.type})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <FieldLabel>Ad Budget Per Tick</FieldLabel>
                <input type="number" min={0} step={0.01} value={storefrontAdBudget} onChange={(event) => setStorefrontAdBudget(Number(event.target.value) || 0)} />
              </label>
              <label>
                <FieldLabel>Traffic Multiplier</FieldLabel>
                <input
                  type="number"
                  min={0.5}
                  max={3}
                  step={0.01}
                  value={storefrontTrafficMultiplier}
                  onChange={(event) => setStorefrontTrafficMultiplier(Number(event.target.value) || 1)}
                />
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
                <input type="checkbox" checked={storefrontAdEnabled} onChange={(event) => setStorefrontAdEnabled(event.target.checked)} style={{ width: 16, height: 16, marginTop: 0 }} />
                <span style={{ color: "#e2e8f0" }}>Ads enabled</span>
              </label>
              <button onClick={() => void saveStorefrontSettings()} disabled={busy || !sourceBusinessId}>
                {busy ? "Saving..." : "Save Storefront Settings"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 16, color: "var(--text-secondary)", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Selected storefront</span>
                <strong style={{ color: "#f8fafc" }}>{sourceBusiness?.name ?? "None"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Ad state</span>
                <strong style={{ color: storefrontAdEnabled ? "#86efac" : "#fca5a5" }}>{storefrontAdEnabled ? "Live" : "Muted"}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Traffic pressure</span>
                <strong style={{ color: "#f8fafc" }}>{storefrontTrafficMultiplier.toFixed(2)}x</strong>
              </div>
            </div>
          </Panel>

          <Panel title="Market Pulse" eyebrow="Tape">
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  background: "rgba(8, 13, 24, 0.7)",
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                  Flow Mix
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>B2B / player-linked trades</span>
                    <strong>{transactionSummary.playerCount}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>NPC shopper trades</span>
                    <strong>{transactionSummary.npcCount}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Units moved</span>
                    <strong>{transactionSummary.units}</strong>
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
                  Hot Supply
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {topItems.length > 0 ? (
                    topItems.map((row) => (
                      <div key={row.key} style={{ display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ color: "#e2e8f0" }}>{formatItemKey(row.key)}</span>
                          <strong>{row.quantity} units</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--text-secondary)", fontSize: 12 }}>
                          <span>{row.listings} listings live</span>
                          <span>From {formatCurrency(row.lowestPrice)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>No active supply data yet.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Recent Market Activity" eyebrow="Live Feed">
            {marketFeed.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>No market transactions yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, maxHeight: 920, overflowY: "auto", paddingRight: 4 }}>
                {marketFeed.map((entry) => (
                  <article
                    key={entry.id}
                    style={{
                      border: "1px solid rgba(148, 163, 184, 0.12)",
                      borderRadius: 14,
                      padding: 12,
                      background: entry.kind === "trade" ? "rgba(15, 23, 42, 0.82)" : "rgba(9, 14, 25, 0.82)",
                      display: "grid",
                      gap: 5,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 13 }}>{entry.title}</div>
                      <StatusBadge tone={entry.kind === "trade" ? "good" : "neutral"}>{entry.kind === "trade" ? "Trade" : "Listing"}</StatusBadge>
                    </div>
                    <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{entry.line}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatTimestamp(entry.createdAt)}</div>
                  </article>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
