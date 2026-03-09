"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NPC_PRICE_CEILINGS } from "@/config/items";
import type { MarketListing, MarketStorefrontSetting, MarketTransaction } from "@/domains/market";
import { formatMarketTransactionLine } from "@/domains/market/feed";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { fetchMarketPageData, queryKeys, type MarketPageData } from "@/lib/client/queries";
import { formatItemKey } from "@/lib/items";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props = {
  initialData: MarketPageData;
};

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

  const ownListings = useMemo(() => listings.filter((listing) => listing.status === "active"), [listings]);
  const marketFeed = useMemo(() => {
    const toTime = (value: string) =>
      new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

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
      line: `[${toTime(listing.created_at)}] ${listing.business?.name ?? "A business"} posted ${listing.quantity} ${formatItemKey(
        listing.item_key
      )} at $${listing.unit_price.toFixed(2)} each for $${(listing.quantity * listing.unit_price).toFixed(2)}`,
    }));

    const transactionEvents = transactions.map((tx) => ({
      id: `tx-${tx.id}`,
      createdAt: tx.created_at,
      line: formatMarketTransactionLine({
        transaction: tx,
        businessNameById,
        formatTimestamp: toTime,
      }),
    }));

    return [...listingEvents, ...transactionEvents]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 40);
  }, [businesses, listings, transactions]);

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
      await apiPost(apiRoutes.market.root, { sourceBusinessId, itemKey, quality, quantity, unitPrice }, { fallbackError: "Failed to create listing." });
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
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Market</h1>
          <p>Publish inventory listings, buy items, and configure storefront demand for NPC shoppers.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {marketPageQuery.isFetching ? <p>Refreshing market...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Storefront Controls</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 620 }}>
          <label>
            Store Business
            <select value={sourceBusinessId} onChange={(event) => setSourceBusinessId(event.target.value)}>
              <option value="">Select business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({business.type})
                </option>
              ))}
            </select>
          </label>
          <label>
            Ad Budget Per Tick
            <input type="number" min={0} step={0.01} value={storefrontAdBudget} onChange={(event) => setStorefrontAdBudget(Number(event.target.value) || 0)} />
          </label>
          <label>
            Traffic Multiplier
            <input type="number" min={0.5} max={3} step={0.01} value={storefrontTrafficMultiplier} onChange={(event) => setStorefrontTrafficMultiplier(Number(event.target.value) || 1)} />
          </label>
          <label>
            <input type="checkbox" checked={storefrontAdEnabled} onChange={(event) => setStorefrontAdEnabled(event.target.checked)} /> Ads Enabled
          </label>
          <button onClick={() => void saveStorefrontSettings()} disabled={busy || !sourceBusinessId}>
            Save Storefront Settings
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Create Listing</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 620 }}>
          <label>
            Source Business
            <select value={sourceBusinessId} onChange={(event) => setSourceBusinessId(event.target.value)}>
              <option value="">Select business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({business.type})
                </option>
              ))}
            </select>
          </label>
          <label>
            Item Key
            <select value={itemKey} onChange={(event) => setItemKey(event.target.value)}>
              {Object.keys(NPC_PRICE_CEILINGS).map((key) => (
                <option key={key} value={key}>
                  {formatItemKey(key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quality
            <input type="number" min={1} max={100} value={quality} onChange={(event) => setQuality(Number(event.target.value) || 1)} />
          </label>
          <label>
            Quantity
            <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value) || 1)} />
          </label>
          <label>
            Unit Price
            <input type="number" min={0.01} step={0.01} value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value) || 0.01)} />
          </label>
          <button onClick={() => void createListing()} disabled={busy || !sourceBusinessId}>
            Publish Listing
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Active Listings</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 620, marginBottom: 12 }}>
          <label>
            Buyer Business
            <select value={buyerBusinessId} onChange={(event) => setBuyerBusinessId(event.target.value)}>
              <option value="">Select business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({business.type})
                </option>
              ))}
            </select>
          </label>
        </div>
        {ownListings.length === 0 ? <p>No active listings found.</p> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {ownListings.map((listing) => (
            <article key={listing.id} style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, display: "grid", gap: 4 }}>
              <strong>{formatItemKey(listing.item_key)} (Q{listing.quality})</strong>
              <span>Listed by: {listing.business?.name ?? `Business ${listing.source_business_id.slice(0, 8)}`}</span>
              <span>
                Quantity: {listing.quantity} | Price: ${listing.unit_price.toFixed(2)} | Status: {listing.status}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label>
                  Buy Qty
                  <input
                    type="number"
                    min={1}
                    max={listing.quantity}
                    value={buyQuantityByListingId[listing.id] ?? 1}
                    onChange={(event) =>
                      setBuyQuantityByListingId((prev) => ({
                        ...prev,
                        [listing.id]: Number(event.target.value) || 1,
                      }))
                    }
                  />
                </label>
                <button onClick={() => void buyListing(listing.id)} disabled={busy}>
                  Buy
                </button>
                <button onClick={() => void cancelListing(listing.id)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Recent Market Activity</h2>
        {marketFeed.length === 0 ? <p>No market transactions yet.</p> : null}
        <div style={{ display: "grid", gap: 8 }}>
          {marketFeed.map((entry) => (
            <article key={entry.id} style={{ border: "1px solid #334155", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}>
              <span>{entry.line}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
