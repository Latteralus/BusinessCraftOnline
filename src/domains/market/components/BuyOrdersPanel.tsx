"use client";

import { useMemo, useState } from "react";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import { formatShortTimestamp } from "@/lib/core/time-display";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  DashboardPanel as Panel,
  FieldLabel,
  StatusBadge,
} from "@/components/ui/primitives";
import type { MarketBuyOrder, MarketTransaction } from "@/domains/market";
import { useGameStore, useInventorySlice, useMarketSlice } from "@/stores/game-store";
import { detailSyncTarget, mergeDetailSyncTargets, syncMutationViews } from "@/stores/mutation-sync";
import { upsertEntityById } from "@/stores/optimistic";
import type { MarketSliceData } from "@/stores/game-store";

function updateMarketState(updater: (current: MarketSliceData) => MarketSliceData) {
  useGameStore.setState((state) => ({
    market: {
      data: updater(state.market.data),
      lastUpdated: Date.now(),
    },
  }));
}

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.14)",
  borderRadius: 16,
  padding: 16,
  background: "radial-gradient(circle at top right, rgba(167, 139, 250, 0.07), transparent 24%), linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
  display: "grid",
  gap: 12,
};

const chipStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "rgba(15, 23, 42, 0.58)",
  border: "1px solid rgba(148,163,184,0.08)",
};

export default function BuyOrdersPanel() {
  const market = useMarketSlice();
  const inventory = useInventorySlice();
  const playerId = useGameStore((state) => state.player.data.playerId);
  const businesses = market.businesses;
  const buyOrders = market.buyOrders;
  const personalInventory = inventory.personalInventory;
  const businessInventory = inventory.businessInventory;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [purchaserType, setPurchaserType] = useState<"business" | "personal">(
    businesses.length > 0 ? "business" : "personal"
  );
  const [purchaserBusinessId, setPurchaserBusinessId] = useState(businesses[0]?.id ?? "");
  const [itemKey, setItemKey] = useState("");
  const [qualityMin, setQualityMin] = useState(1);
  const [qualityMax, setQualityMax] = useState(100);
  const [quantity, setQuantity] = useState(10);
  const [maxUnitPrice, setMaxUnitPrice] = useState(5);

  const [fulfillQtyByOrderId, setFulfillQtyByOrderId] = useState<Record<string, number>>({});
  const [fulfillSourceTypeByOrderId, setFulfillSourceTypeByOrderId] = useState<Record<string, "business" | "personal">>({});
  const [fulfillSourceRowByOrderId, setFulfillSourceRowByOrderId] = useState<Record<string, string>>({});

  const activeBuyOrders = useMemo(() => buyOrders.filter((order) => order.status === "active"), [buyOrders]);
  const purchaserBusiness = useMemo(
    () => businesses.find((business) => business.id === purchaserBusinessId) ?? null,
    [businesses, purchaserBusinessId]
  );

  function fulfillSourceOptionsFor(order: MarketBuyOrder, sourceType: "business" | "personal") {
    if (sourceType === "personal") {
      return personalInventory
        .filter(
          (row) =>
            row.item_key === order.item_key &&
            row.quality >= order.quality_min &&
            row.quality <= order.quality_max &&
            row.quantity > 0
        )
        .map((row) => ({
          id: row.id,
          available: row.quantity,
          label: `${formatItemKey(row.item_key)} · Q${row.quality} · ${row.quantity} units (Personal)`,
        }));
    }

    return businessInventory
      .filter(
        (row) =>
          row.item_key === order.item_key &&
          row.quality >= order.quality_min &&
          row.quality <= order.quality_max &&
          Math.max(0, row.quantity - row.reserved_quantity) > 0
      )
      .map((row) => {
        const business = businesses.find((entry) => entry.id === row.business_id);
        const available = Math.max(0, row.quantity - row.reserved_quantity);
        return {
          id: row.id,
          available,
          businessId: row.business_id,
          label: `${formatItemKey(row.item_key)} · Q${row.quality} · ${available} units (${business?.name ?? "Business"})`,
        };
      });
  }

  async function placeBuyOrder() {
    if (busy || !itemKey.trim() || quantity < 1 || maxUnitPrice <= 0) return;
    if (purchaserType === "business" && !purchaserBusinessId) return;
    if (qualityMax < qualityMin) return;

    setBusy(true);
    setError(null);
    try {
      const payload = await apiPost<{ buyOrder?: MarketBuyOrder }>(
        apiRoutes.market.buyOrders.root,
        {
          purchaserType,
          purchaserBusinessId: purchaserType === "business" ? purchaserBusinessId : undefined,
          itemKey: itemKey.trim(),
          qualityMin,
          qualityMax,
          quantity,
          maxUnitPrice,
        },
        { fallbackError: "Failed to place buy order." }
      );
      if (payload.buyOrder) {
        updateMarketState((current) => ({
          ...current,
          buyOrders: upsertEntityById(current.buyOrders, payload.buyOrder!),
        }));
      }
      await syncMutationViews({
        businesses: true,
        banking: true,
        inventory: true,
        market: true,
        businessDetails: detailSyncTarget(purchaserType === "business" ? purchaserBusinessId : null),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place buy order.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBuyOrder(buyOrderId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await apiPost<{ buyOrder?: MarketBuyOrder }>(
        apiRoutes.market.buyOrders.cancel(buyOrderId),
        undefined,
        { fallbackError: "Failed to cancel buy order." }
      );
      if (payload.buyOrder) {
        updateMarketState((current) => ({
          ...current,
          buyOrders: upsertEntityById(current.buyOrders, payload.buyOrder!),
        }));
      }
      const order = buyOrders.find((entry) => entry.id === buyOrderId) ?? null;
      await syncMutationViews({
        businesses: true,
        banking: true,
        market: true,
        businessDetails: detailSyncTarget(order?.purchaser_business_id ?? null),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel buy order.");
    } finally {
      setBusy(false);
    }
  }

  async function fulfillBuyOrder(order: MarketBuyOrder) {
    if (busy) return;
    const sourceType = fulfillSourceTypeByOrderId[order.id] ?? "business";
    const options = fulfillSourceOptionsFor(order, sourceType);
    const sourceRowId = fulfillSourceRowByOrderId[order.id] ?? options[0]?.id ?? "";
    const selectedOption = options.find((option) => option.id === sourceRowId);
    const requestedQty = Math.max(1, Math.min(order.quantity, fulfillQtyByOrderId[order.id] ?? 1));
    if (!selectedOption || requestedQty > selectedOption.available) return;

    setBusy(true);
    setError(null);
    try {
      const businessOption = sourceType === "business" ? (selectedOption as { businessId?: string }) : null;
      const payload = await apiPost<{ buyOrder?: MarketBuyOrder; transaction?: MarketTransaction }>(
        apiRoutes.market.buyOrders.fulfill(order.id),
        {
          quantity: requestedQty,
          sourceType,
          sourceBusinessId: sourceType === "business" ? businessOption?.businessId : undefined,
          sourceBusinessInventoryId: sourceType === "business" ? sourceRowId : undefined,
          sourcePersonalInventoryId: sourceType === "personal" ? sourceRowId : undefined,
        },
        { fallbackError: "Failed to fulfill buy order." }
      );
      updateMarketState((current) => ({
        ...current,
        buyOrders: payload.buyOrder ? upsertEntityById(current.buyOrders, payload.buyOrder) : current.buyOrders,
        transactions: payload.transaction ? upsertEntityById(current.transactions, payload.transaction) : current.transactions,
      }));
      await syncMutationViews({
        businesses: true,
        banking: true,
        inventory: true,
        market: true,
        businessDetails: mergeDetailSyncTargets(
          detailSyncTarget(order.purchaser_business_id),
          detailSyncTarget(sourceType === "business" ? businessOption?.businessId ?? null : null)
        ),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fulfill buy order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Place Buy Order" eyebrow="Standing Demand">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)", gap: 18 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <label>
                <FieldLabel><TooltipLabel label="Purchaser" content="Who receives the goods and pays for them once the order fills — one of your companies, or your personal account." /></FieldLabel>
                <select value={purchaserType} onChange={(event) => setPurchaserType(event.target.value as "business" | "personal")} title="Purchaser type">
                  <option value="business">Business</option>
                  <option value="personal">Personal</option>
                </select>
              </label>
              <label>
                <FieldLabel><TooltipLabel label="Purchaser Business" content="Which company's funds and inventory this buy order uses. Ignored for personal orders." /></FieldLabel>
                {purchaserType === "business" ? (
                  <select value={purchaserBusinessId} onChange={(event) => setPurchaserBusinessId(event.target.value)} title="Purchaser business">
                    <option value="">Select business</option>
                    {businesses.map((business) => (
                      <option key={business.id} value={business.id}>
                        {business.name} ({formatBusinessType(business.type)})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid rgba(148, 163, 184, 0.16)", background: "rgba(15, 23, 42, 0.72)", minHeight: 46, display: "flex", alignItems: "center" }}>
                    Personal Account
                  </div>
                )}
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <label>
                <FieldLabel><TooltipLabel label="Item" content="The item key to bid on, e.g. iron_ore." /></FieldLabel>
                <input type="text" value={itemKey} onChange={(event) => setItemKey(event.target.value)} placeholder="item_key" />
              </label>
              <label>
                <FieldLabel><TooltipLabel label="Min Quality" content="The lowest quality you'll accept." /></FieldLabel>
                <input type="number" min={1} max={100} value={qualityMin} onChange={(event) => setQualityMin(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
              </label>
              <label>
                <FieldLabel><TooltipLabel label="Max Quality" content="The highest quality you'll accept." /></FieldLabel>
                <input type="number" min={1} max={100} value={qualityMax} onChange={(event) => setQualityMax(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
              </label>
              <label>
                <FieldLabel><TooltipLabel label="Quantity" content="Total units you want to buy in total, across any number of fills." /></FieldLabel>
                <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} />
              </label>
              <label>
                <FieldLabel><TooltipLabel label="Max Unit Price" content="The most you're willing to pay per unit. Fills against cheaper asks pay the lower price." /></FieldLabel>
                <input type="number" min={0.01} step={0.01} value={maxUnitPrice} onChange={(event) => setMaxUnitPrice(Math.max(0.01, Number(event.target.value) || 0.01))} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => void placeBuyOrder()}
                disabled={busy || !itemKey.trim() || (purchaserType === "business" && !purchaserBusinessId) || qualityMax < qualityMin}
              >
                {busy ? "Placing..." : "Place Buy Order"}
              </button>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                Worst-case commitment {formatCurrency(quantity * maxUnitPrice)} — matching sell listings fill instantly at their own (lower) price.
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div>
              <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 6 }}>
                Order Readout
              </div>
              <div style={{ color: "#f8fafc", fontSize: "1.1rem", fontWeight: 700 }}>
                {purchaserType === "business" ? (purchaserBusiness?.name ?? "Select a purchaser business") : "Personal Account"}
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>
                {purchaserType === "business" && purchaserBusiness
                  ? `Cash on hand ${formatCurrency(purchaserBusiness.balance)}`
                  : "Funds are escrowed for whatever doesn't fill immediately."}
              </div>
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
              Any matching sell listings fill this order the moment it's placed. Whatever's left rests on the book — sellers can sell directly into it, or list on the open market and get swept automatically.
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Buy Order Book" eyebrow="Standing Orders">
        {activeBuyOrders.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>No active buy orders. Place one to start bidding for goods.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {activeBuyOrders.map((order) => {
              const isOwnOrder = Boolean(playerId && order.owner_player_id === playerId);
              const sourceType = fulfillSourceTypeByOrderId[order.id] ?? "business";
              const options = fulfillSourceOptionsFor(order, sourceType);
              const sourceRowId = fulfillSourceRowByOrderId[order.id] ?? options[0]?.id ?? "";
              const selectedOption = options.find((option) => option.id === sourceRowId) ?? options[0] ?? null;
              const requestedQty = Math.max(1, Math.min(order.quantity, fulfillQtyByOrderId[order.id] ?? 1));
              const purchaserLabel = order.purchaser_type === "business" ? (order.business?.name ?? "Business") : "Personal Account";

              return (
                <article key={order.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{formatItemKey(order.item_key)}</h3>
                        <StatusBadge tone={isOwnOrder ? "good" : "neutral"}>{isOwnOrder ? "Your Order" : "Open Bid"}</StatusBadge>
                        <StatusBadge tone="warn">Q{order.quality_min}-{order.quality_max}</StatusBadge>
                      </div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                        {purchaserLabel} posted this bid on {formatShortTimestamp(order.created_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Max Bid</div>
                      <div style={{ marginTop: 4, fontWeight: 800, fontSize: "1.2rem", color: "#f8fafc" }}>{formatCurrency(order.max_unit_price)}</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{formatCurrency(order.quantity * order.max_unit_price)} worst case remaining</div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                    <div style={chipStyle}>
                      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Remaining</div>
                      <div style={{ marginTop: 6, fontWeight: 700 }}>{order.quantity} units</div>
                    </div>
                    <div style={chipStyle}>
                      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Purchaser</div>
                      <div style={{ marginTop: 6, fontWeight: 700 }}>{purchaserLabel}</div>
                    </div>
                    <div style={chipStyle}>
                      <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Status</div>
                      <div style={{ marginTop: 6, fontWeight: 700, textTransform: "capitalize" }}>{order.status}</div>
                    </div>
                  </div>

                  {isOwnOrder ? (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => void cancelBuyOrder(order.id)}
                        disabled={busy}
                        style={{ border: "1px solid rgba(148, 163, 184, 0.16)", background: "rgba(15, 23, 42, 0.72)", color: "#e2e8f0" }}
                      >
                        Cancel Buy Order
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
                      <label style={{ minWidth: 150 }}>
                        <FieldLabel><TooltipLabel label="Sell From" content="Which of your inventories to sell out of." /></FieldLabel>
                        <select
                          value={sourceType}
                          onChange={(event) =>
                            setFulfillSourceTypeByOrderId((prev) => ({ ...prev, [order.id]: event.target.value as "business" | "personal" }))
                          }
                          title="Fulfillment source"
                        >
                          <option value="business">Business Inventory</option>
                          <option value="personal">Personal Inventory</option>
                        </select>
                      </label>
                      <label style={{ minWidth: 220 }}>
                        <FieldLabel><TooltipLabel label="Inventory Row" content="The specific stock row to sell into this buy order. Only rows matching the item and quality range are shown." /></FieldLabel>
                        <select
                          value={sourceRowId}
                          onChange={(event) =>
                            setFulfillSourceRowByOrderId((prev) => ({ ...prev, [order.id]: event.target.value }))
                          }
                          title="Source inventory row"
                        >
                          <option value="">Select inventory</option>
                          {options.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ minWidth: 110 }}>
                        <FieldLabel><TooltipLabel label="Sell Qty" content="How many units to sell into this buy order, up to what it still needs and what you have available." /></FieldLabel>
                        <input
                          type="number"
                          min={1}
                          max={Math.min(order.quantity, selectedOption?.available ?? order.quantity)}
                          value={requestedQty}
                          onChange={(event) =>
                            setFulfillQtyByOrderId((prev) => ({ ...prev, [order.id]: Number(event.target.value) || 1 }))
                          }
                        />
                      </label>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12, paddingBottom: 10 }}>
                        Ticket value {formatCurrency(requestedQty * order.max_unit_price)}
                      </div>
                      <button
                        onClick={() => void fulfillBuyOrder(order)}
                        disabled={busy || !selectedOption || requestedQty > (selectedOption?.available ?? 0)}
                      >
                        Sell Into Order
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Panel>

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
    </>
  );
}
