"use client";

import { NPC_PRICE_CEILINGS } from "@/config/items";
import { formatMarketTransactionLine } from "@/domains/market/feed";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency } from "@/lib/formatters";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import type { MarketPageData } from "@/lib/client/queries";
import { formatItemKey } from "@/lib/items";
import { TooltipLabel } from "@/components/ui/tooltip";
import type { MarketListing, MarketTransaction } from "@/domains/market";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useGameStore, useMarketSlice } from "@/stores/game-store";
import { detailSyncTarget, mergeDetailSyncTargets, syncMutationViews } from "@/stores/mutation-sync";
import { runOptimisticUpdate } from "@/stores/optimistic";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function MiniSparkline(props: { points: number[]; tone?: string }) {
  const { path, latestX, latestY } = useMemo(() => {
    if (props.points.length === 0) {
      return { path: "", latestX: 92, latestY: 24 };
    }

    const width = 92;
    const height = 24;
    const min = Math.min(...props.points);
    const max = Math.max(...props.points);
    const range = Math.max(1, max - min);
    const coords = props.points.map((point, index) => ({
      x: props.points.length === 1 ? width : (index / (props.points.length - 1)) * width,
      y: height - ((point - min) / range) * height,
    }));

    return {
      path: coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(" "),
      latestX: coords.at(-1)?.x ?? width,
      latestY: coords.at(-1)?.y ?? height / 2,
    };
  }, [props.points]);

  return (
    <svg viewBox="0 0 92 24" width="92" height="24" aria-hidden="true">
      <path d={path} fill="none" stroke={props.tone ?? "#fbbf24"} strokeWidth="2" strokeLinecap="round" />
      <circle cx={latestX} cy={latestY} r="3.5" fill={props.tone ?? "#fbbf24"} opacity="0.92" />
      <circle cx={latestX} cy={latestY} r="6" fill={props.tone ?? "#fbbf24"} opacity="0.18" />
    </svg>
  );
}

export default function MarketClient({ initialData }: Props) {
  const market = useMarketSlice();
  const patchMarket = useGameStore((state) => state.patchMarket);
  const businesses = market.businesses;
  const listings = market.listings;
  const transactions = market.transactions;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [sourceBusinessId, setSourceBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [buyerBusinessId, setBuyerBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [itemKey, setItemKey] = useState(Object.keys(NPC_PRICE_CEILINGS)[0] ?? "");
  const [quality, setQuality] = useState(50);
  const [quantity, setQuantity] = useState(5);
  const [unitPrice, setUnitPrice] = useState(5);
  const [buyQuantityByListingId, setBuyQuantityByListingId] = useState<Record<string, number>>({});

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const activeListings = useMemo(() => listings.filter((listing) => listing.status === "active"), [listings]);

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
    const counterparties = new Set<string>();
    for (const tx of transactions) {
      if (tx.seller_business_id) counterparties.add(tx.seller_business_id);
      if (tx.buyer_business_id) counterparties.add(tx.buyer_business_id);
    }

    return { revenue, net, fees, units, counterparties: counterparties.size };
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

    return transactions.map((tx) => ({
      id: `tx-${tx.id}`,
      createdAt: tx.created_at,
      title: `${formatItemKey(tx.item_key)} trade cleared`,
      line: formatMarketTransactionLine({
        transaction: tx,
        businessNameById,
        formatTimestamp: formatClock,
      }),
      kind: "trade" as const,
    }))
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

  const tapePulse = useMemo(() => {
    const windowMs = 1000 * 60 * 60;
    const sliceCount = 12;
    const bucketMs = windowMs / sliceCount;
    const buckets = Array.from({ length: sliceCount }, () => 0);
    for (const transaction of transactions) {
      const ageMs = nowMs - new Date(transaction.created_at).getTime();
      if (ageMs < 0 || ageMs > windowMs) continue;
      const index = clamp(sliceCount - 1 - Math.floor(ageMs / bucketMs), 0, sliceCount - 1);
      buckets[index] += transaction.quantity;
    }
    return buckets;
  }, [nowMs, transactions]);

  async function createListing() {
    if (!sourceBusinessId || busy) return;
    setBusy(true);
    setError(null);
    const optimisticId = `optimistic-listing-${Date.now()}`;
    try {
      await runOptimisticUpdate("market", () => {
        const sourceBusinessName = businesses.find((business) => business.id === sourceBusinessId)?.name;
        const optimisticListing: MarketListing = {
          id: optimisticId,
          owner_player_id: "",
          source_business_id: sourceBusinessId,
          source_inventory_id: null,
          city_id: businesses.find((business) => business.id === sourceBusinessId)?.city_id ?? "",
          item_key: itemKey,
          quality,
          quantity,
          reserved_quantity: quantity,
          unit_price: unitPrice,
          listing_type: "sell",
          status: "active",
          expires_at: null,
          filled_at: null,
          cancelled_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          business: sourceBusinessName ? { name: sourceBusinessName } : undefined,
        };
        patchMarket({ listings: [optimisticListing, ...listings] });
      }, async () => {
        const payload = await apiPost<{ listing?: MarketListing }>(
          apiRoutes.market.root,
          { sourceBusinessId, itemKey, quality, quantity, unitPrice },
          { fallbackError: "Failed to create listing." }
        );
        if (payload.listing) {
          patchMarket({
            listings: [payload.listing, ...listings.filter((listing) => listing.id !== optimisticId)],
          });
        }
        return payload;
      });
      await syncMutationViews({
        businesses: true,
        banking: true,
        inventory: true,
        market: true,
        businessDetails: detailSyncTarget(sourceBusinessId),
      });
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
      await runOptimisticUpdate("market", () => {
        patchMarket({
          listings: listings.map((listing) =>
            listing.id === listingId
              ? {
                  ...listing,
                  status: "cancelled",
                  cancelled_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              : listing
          ),
        });
      }, async () => {
        const payload = await apiPost<{ listing?: MarketListing }>(
          apiRoutes.market.cancel(listingId),
          undefined,
          { fallbackError: "Failed to cancel listing." }
        );
        if (payload.listing) {
          patchMarket({
            listings: listings.map((listing) => (listing.id === listingId ? payload.listing! : listing)),
          });
        }
        return payload;
      });
      const listing = listings.find((entry) => entry.id === listingId) ?? null;
      await syncMutationViews({
        businesses: true,
        banking: true,
        inventory: true,
        market: true,
        businessDetails: detailSyncTarget(listing?.source_business_id),
      });
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
      const purchaseQuantity = Math.max(1, buyQuantityByListingId[listingId] ?? 1);
      const targetListing = listings.find((listing) => listing.id === listingId) ?? null;
      await runOptimisticUpdate("market", () => {
        if (!targetListing) return;
        const nextQuantity = Math.max(0, targetListing.quantity - purchaseQuantity);
        patchMarket({
          listings: listings.map((listing) =>
            listing.id === listingId
              ? {
                  ...listing,
                  quantity: nextQuantity,
                  reserved_quantity: Math.max(0, listing.reserved_quantity - purchaseQuantity),
                  status: nextQuantity <= 0 ? "filled" : listing.status,
                  filled_at: nextQuantity <= 0 ? new Date().toISOString() : listing.filled_at,
                  updated_at: new Date().toISOString(),
                }
              : listing
          ),
        });
      }, async () => {
        const payload = await apiPost<{ listing?: MarketListing; transaction?: MarketTransaction }>(
          apiRoutes.market.buy(listingId),
          {
            quantity: purchaseQuantity,
            buyerBusinessId,
          },
          { fallbackError: "Failed to buy listing." }
        );
        patchMarket({
          listings: payload.listing
            ? listings.map((listing) => (listing.id === listingId ? payload.listing! : listing))
            : listings,
          transactions: payload.transaction ? [payload.transaction, ...transactions] : transactions,
        });
        return payload;
      });
      const listing = listings.find((entry) => entry.id === listingId) ?? null;
      await syncMutationViews({
        businesses: true,
        banking: true,
        inventory: true,
        market: true,
        businessDetails: mergeDetailSyncTargets(
          detailSyncTarget(listing?.source_business_id),
          detailSyncTarget(buyerBusinessId)
        ),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to buy listing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim" style={{ display: "grid", gap: 18 }}>
      <header className="lc-page-header">
        <div>
          <h1>Market</h1>
          <p>The market floor.</p>
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
              Market
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              Buy, sell, and move goods while the floor stays live around you.
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
            <StatusBadge tone={busy ? "warn" : "good"}>{busy ? "Order Processing" : "Market Live"}</StatusBadge>
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
          <MarketMetric label="Active Item Classes" value={`${listingSummary.distinctItems}`} sub={`${listingSummary.cities} cities represented in the book`} />
          <MarketMetric label="Trading Businesses" value={`${transactionSummary.counterparties}`} sub="Distinct businesses active in recent exchange clears" />
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
                    <FieldLabel><TooltipLabel label="Source Business" content="The business posting inventory onto the market as a public listing." /></FieldLabel>
                    <select value={sourceBusinessId} onChange={(event) => setSourceBusinessId(event.target.value)} title="Source business">
                      <option value="">Select business</option>
                      {businesses.map((business) => (
                        <option key={business.id} value={business.id}>
                          {business.name} ({formatBusinessType(business.type)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Buyer Business" content="The business that will receive inventory when you buy a listing." /></FieldLabel>
                    <select value={buyerBusinessId} onChange={(event) => setBuyerBusinessId(event.target.value)} title="Buyer business">
                      <option value="">Select business</option>
                      {businesses.map((business) => (
                        <option key={business.id} value={business.id}>
                          {business.name} ({formatBusinessType(business.type)})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel><TooltipLabel label="Item" content="The commodity or product being listed for sale." /></FieldLabel>
                    <select value={itemKey} onChange={(event) => setItemKey(event.target.value)} title="Item key">
                      {Object.keys(NPC_PRICE_CEILINGS).map((key) => (
                        <option key={key} value={key}>
                          {formatItemKey(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Quality" content="Higher quality goods are tracked separately and can justify stronger pricing." /></FieldLabel>
                    <input type="number" min={1} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value) || 1)} />
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Quantity" content="How many units will be placed into the listing." /></FieldLabel>
                    <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 1)} />
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Unit Price" content="The asking price per unit before any market fees are applied." /></FieldLabel>
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
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Current ask" content="The per-unit price you are about to post for the new listing." /></span>
                    <strong>{formatCurrency(unitPrice)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Weighted floor avg" content="Average ask price across active listings, weighted by the listed volume." /></span>
                    <strong>{formatCurrency(listingSummary.avgAsk)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Destination routing" content="The buyer business selected to receive purchased inventory from the order book." /></span>
                    <strong>{buyerBusiness?.name ?? "No buyer selected"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Market coverage</span>
                    <strong>{listingSummary.cities} cities</strong>
                  </div>
                </div>

                <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  Set the buyer business before lifting an ask so incoming inventory lands in the correct operation.
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
                  const listingAgeMs = Math.max(0, nowMs - new Date(listing.created_at).getTime());
                  const freshnessRatio = clamp(1 - listingAgeMs / (1000 * 60 * 60), 0.08, 1);
                  const motionPhase = ((nowMs / 1000) % 3) / 3;

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

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                            Order Book Motion
                          </div>
                          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                            Fresh on floor {formatCountdown(listingAgeMs)}
                          </div>
                        </div>
                        <div
                          style={{
                            position: "relative",
                            height: 12,
                            borderRadius: 999,
                            background: "rgba(15, 23, 42, 0.94)",
                            overflow: "hidden",
                            border: "1px solid rgba(148, 163, 184, 0.08)",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: `${(listing.quantity / Math.max(1, listing.quantity + requestedQty)) * 100}%`,
                              borderRadius: 999,
                              background: "linear-gradient(90deg, rgba(59,130,246,0.85), rgba(125,211,252,0.72))",
                            }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              left: `${clamp((1 - freshnessRatio + motionPhase * freshnessRatio) * 100, 5, 95)}%`,
                              top: -2,
                              width: 16,
                              height: 16,
                              marginLeft: -8,
                              borderRadius: 999,
                              background: "#fbbf24",
                              boxShadow: "0 0 16px rgba(251, 191, 36, 0.45)",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--text-secondary)", fontSize: 12 }}>
                          <span>{listing.quantity} units still open</span>
                          <span>{Math.round(freshnessRatio * 100)}% freshness</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
                        <label style={{ minWidth: 110 }}>
                    <FieldLabel><TooltipLabel label="Buy Qty" content="How many units to purchase from this listing. The total updates with your selected quantity." /></FieldLabel>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                            <button
                              type="button"
                              onClick={() =>
                                setBuyQuantityByListingId((prev) => ({
                                  ...prev,
                                  [listing.id]: listing.quantity,
                                }))
                              }
                              disabled={busy || listing.quantity <= 0}
                              style={{
                                border: "1px solid rgba(148, 163, 184, 0.16)",
                                background: "rgba(15, 23, 42, 0.72)",
                                color: "#e2e8f0",
                              }}
                            >
                              Max
                            </button>
                          </div>
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
                  Trade Flow
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Rolling 60 minute tape</div>
                  <MiniSparkline points={tapePulse} tone="#fbbf24" />
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Recent exchange clears</span>
                    <strong>{transactions.length}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Businesses involved</span>
                    <strong>{transactionSummary.counterparties}</strong>
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
