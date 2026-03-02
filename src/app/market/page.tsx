"use client";

import type { BusinessWithBalance } from "@/domains/businesses";
import type { MarketListing, MarketTransaction } from "@/domains/market";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BusinessesResponse = {
  businesses: BusinessWithBalance[];
  error?: string;
};

type ListingsResponse = {
  listings: MarketListing[];
  transactions?: MarketTransaction[];
  error?: string;
};

export default function MarketPage() {
  const [businesses, setBusinesses] = useState<BusinessWithBalance[]>([]);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [transactions, setTransactions] = useState<MarketTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sourceBusinessId, setSourceBusinessId] = useState("");
  const [itemKey, setItemKey] = useState("iron_bar");
  const [quality, setQuality] = useState(50);
  const [quantity, setQuantity] = useState(5);
  const [unitPrice, setUnitPrice] = useState(5);
  const [buyQuantityByListingId, setBuyQuantityByListingId] = useState<Record<string, number>>({});

  const ownListings = useMemo(() => listings.filter((listing) => listing.status === "active"), [listings]);

  async function loadBusinesses() {
    const response = await fetch("/api/businesses", { cache: "no-store" });
    const payload = (await response.json()) as BusinessesResponse;
    if (!response.ok) throw new Error(payload.error ?? "Failed to load businesses.");

    setBusinesses(payload.businesses ?? []);
    if (!sourceBusinessId && payload.businesses?.length) {
      setSourceBusinessId(payload.businesses[0].id);
    }
  }

  async function loadListings() {
    const response = await fetch("/api/market?includeTransactions=true&transactionsLimit=40", {
      cache: "no-store",
    });
    const payload = (await response.json()) as ListingsResponse;
    if (!response.ok) throw new Error(payload.error ?? "Failed to load market listings.");

    setListings(payload.listings ?? []);
    setTransactions(payload.transactions ?? []);
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        await loadBusinesses();
        await loadListings();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize market page.");
      } finally {
        setLoading(false);
      }
    }

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createListing() {
    if (!sourceBusinessId || busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceBusinessId, itemKey, quality, quantity, unitPrice }),
    });

    const payload = (await response.json()) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to create listing.");
      return;
    }

    await loadListings();
  }

  async function cancelListing(listingId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/market/${listingId}/cancel`, { method: "POST" });
    const payload = (await response.json()) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to cancel listing.");
      return;
    }

    await loadListings();
  }

  async function buyListing(listingId: string) {
    if (busy) return;
    const requestedQuantity = Math.max(1, buyQuantityByListingId[listingId] ?? 1);

    setBusy(true);
    setError(null);
    const response = await fetch(`/api/market/${listingId}/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: requestedQuantity }),
    });

    const payload = (await response.json()) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to buy listing.");
      return;
    }

    await loadListings();
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1>Market</h1>
          <p style={{ color: "#94a3b8" }}>
            Phase 12 market listings: publish inventory, buy listings, and feed NPC demand from active listings.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading market...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      {!loading ? (
        <section style={{ marginTop: 16, border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
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
              <input value={itemKey} onChange={(event) => setItemKey(event.target.value)} />
            </label>
            <label>
              Quality
              <input
                type="number"
                min={1}
                max={100}
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value) || 1)}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value) || 1)}
              />
            </label>
            <label>
              Unit Price
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={unitPrice}
                onChange={(event) => setUnitPrice(Number(event.target.value) || 0.01)}
              />
            </label>
            <button onClick={() => void createListing()} disabled={busy || !sourceBusinessId}>
              Publish Listing
            </button>
          </div>
        </section>
      ) : null}

      {!loading ? (
        <section style={{ marginTop: 16, border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Active Listings</h2>
          {ownListings.length === 0 ? <p>No active listings found.</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {ownListings.map((listing) => (
              <article
                key={listing.id}
                style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, display: "grid", gap: 4 }}
              >
                <strong>
                  {listing.item_key} (Q{listing.quality})
                </strong>
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
      ) : null}

      {!loading ? (
        <section style={{ marginTop: 16, border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Recent Market Activity</h2>
          {transactions.length === 0 ? <p>No market transactions yet.</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {transactions.map((tx) => (
              <article
                key={tx.id}
                style={{ border: "1px solid #334155", borderRadius: 8, padding: 10, display: "grid", gap: 2 }}
              >
                <strong>
                  {tx.item_key} (Q{tx.quality}) x{tx.quantity}
                </strong>
                <span>
                  ${tx.unit_price.toFixed(2)} each • Gross ${tx.gross_total.toFixed(2)} • Fee ${tx.market_fee.toFixed(2)}
                </span>
                <span style={{ color: "#94a3b8" }}>
                  Buyer: {tx.buyer_type === "npc" ? tx.shopper_name ?? "NPC shopper" : "Player"}
                  {tx.buyer_type === "npc" && tx.shopper_tier ? ` (${tx.shopper_tier})` : ""}
                  {tx.sub_tick_index !== null ? ` • Sub-tick ${tx.sub_tick_index + 1}` : ""}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
