"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NPC_PRICE_CEILINGS } from "@/config/items";
import type { BusinessInventoryItem, PersonalInventoryItem, ShippingQueueItem } from "@/domains/inventory";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { fetchInventoryPageData, queryKeys, type InventoryPageData } from "@/lib/client/queries";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import Link from "next/link";
import { useMemo, useState } from "react";

type Props = {
  initialData: InventoryPageData;
};

export default function InventoryClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const availableItemKeys = Object.keys(NPC_PRICE_CEILINGS);
  const inventoryPageQuery = useQuery({
    queryKey: queryKeys.inventoryPage,
    queryFn: fetchInventoryPageData,
    initialData,
  });
  const { personalInventory, businessInventory, shippingQueue, accounts, businesses, businessNamesById, cityNamesById } =
    inventoryPageQuery.data;
  const [sourceType, setSourceType] = useState<"personal" | "business">("personal");
  const [sourceBusinessId, setSourceBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [destinationType, setDestinationType] = useState<"personal" | "business">("business");
  const [destinationBusinessId, setDestinationBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [itemKey, setItemKey] = useState(availableItemKeys[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const [quality, setQuality] = useState("40");
  const [unitPrice, setUnitPrice] = useState("1");
  const [fundingAccountId, setFundingAccountId] = useState(initialData.accounts.find((a) => a.account_type === "checking")?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const businessOptions = useMemo(
    () =>
      businesses.map((business) => ({
        businessId: business.id,
        businessName: business.name,
        cityId: business.city_id,
      })),
    [businesses]
  );

  type TransferResponse = {
    transferType?: "shipping" | "same_city";
    shippingMinutes?: number;
    shippingCost?: number;
    error?: string;
  };

  async function submitTransfer() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const selectedSource = businessOptions.find((option) => option.businessId === sourceBusinessId);
    const selectedDestination = businessOptions.find((option) => option.businessId === destinationBusinessId);

    try {
      const data = await apiPost<TransferResponse>(
        apiRoutes.inventory.transfer,
        {
          sourceType,
          sourceBusinessId: sourceType === "business" ? sourceBusinessId : undefined,
          sourceCityId: sourceType === "business" ? selectedSource?.cityId : undefined,
        destinationType,
        destinationBusinessId: destinationType === "business" ? destinationBusinessId : undefined,
        destinationCityId: destinationType === "business" ? selectedDestination?.cityId : undefined,
          itemKey: itemKey.trim(),
          quantity: Number(quantity),
          quality: Number(quality),
          fundingAccountId:
            sourceType === "business" && destinationType === "business" ? undefined : fundingAccountId,
          unitPrice: sourceType === "business" && destinationType === "business" ? Number(unitPrice) : undefined,
        },
        { fallbackError: "Transfer failed." }
      );

      setSuccess(
        data.transferType === "shipping"
          ? `Transfer queued for shipping (${data.shippingMinutes ?? 0} min, ${formatCurrency(data.shippingCost ?? 0)}).`
          : "Transfer completed instantly."
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bankingPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.businessesPage }),
        queryClient.invalidateQueries({ queryKey: queryKeys.marketPage }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Inventory</h1>
          <p>Personal inventory, business inventory, shipping queue, and transfer controls.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {inventoryPageQuery.isFetching ? <p>Refreshing inventory data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      {success ? <p style={{ color: "#34d399" }}>{success}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Transfer Items</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
          <label>
            Source Type
            <select value={sourceType} onChange={(event) => setSourceType(event.target.value as "personal" | "business")}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </select>
          </label>
          {sourceType === "business" ? (
            <label>
              Source Business
              <select value={sourceBusinessId} onChange={(event) => setSourceBusinessId(event.target.value)}>
                <option value="">Select business</option>
                {businessOptions.map((option) => (
                  <option key={option.businessId} value={option.businessId}>
                    {option.businessName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Destination Type
            <select value={destinationType} onChange={(event) => setDestinationType(event.target.value as "personal" | "business")}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </select>
          </label>
          {destinationType === "business" ? (
            <>
              <label>
                Destination Business
                <select value={destinationBusinessId} onChange={(event) => setDestinationBusinessId(event.target.value)}>
                  <option value="">Select business</option>
                  {businessOptions.map((option) => (
                    <option key={option.businessId} value={option.businessId}>
                      {option.businessName}
                    </option>
                  ))}
                </select>
              </label>
              <p style={{ margin: 0, color: "#94a3b8" }}>
                Destination City: {(() => {
                  const selected = businessOptions.find((option) => option.businessId === destinationBusinessId);
                  return selected ? cityNamesById[selected.cityId] ?? selected.cityId : "Select destination business";
                })()}
              </p>
            </>
          ) : null}
          <label>
            Item
            <select value={itemKey} onChange={(event) => setItemKey(event.target.value)}>
              {availableItemKeys.map((key) => (
                <option key={key} value={key}>{formatItemKey(key)}</option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          <label>
            Quality
            <input type="number" min="1" max="100" value={quality} onChange={(event) => setQuality(event.target.value)} />
          </label>
          {sourceType === "business" && destinationType === "business" ? (
            <label>
              Price Per Unit
              <input type="number" min="1" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
            </label>
          ) : null}
          {sourceType === "business" && destinationType === "business" ? (
            <p style={{ margin: 0, color: "#94a3b8" }}>
              Business-to-business shipping and purchase charges post to business accounts.
            </p>
          ) : (
            <label>
              Funding Account (for shipping)
              <select value={fundingAccountId} onChange={(event) => setFundingAccountId(event.target.value)}>
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.account_type} ({formatCurrency(account.balance)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button onClick={submitTransfer} disabled={submitting || !itemKey.trim() || Number(quantity) <= 0 || Number(quality) < 1 || Number(quality) > 100 || (sourceType === "business" && destinationType === "business" && Number(unitPrice) < 1)}>
            {submitting ? "Submitting..." : "Submit Transfer"}
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Personal Inventory</h2>
        {personalInventory.length === 0 ? <p>No personal items.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {personalInventory.map((row) => (
              <div key={row.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                <strong>{formatItemKey(row.item_key)}</strong> · Qty {row.quantity} · Q{row.quality}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Business Inventory</h2>
        {businessInventory.length === 0 ? <p>No business inventory rows.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {businessInventory.map((row) => (
              <div key={row.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                <strong>{formatItemKey(row.item_key)}</strong> · Qty {row.quantity} · Reserved {row.reserved_quantity} · Q{row.quality}
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  Business {businessNamesById[row.business_id] ?? row.business_id} · City {cityNamesById[row.city_id] ?? row.city_id}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Shipping Queue</h2>
        {shippingQueue.length === 0 ? <p>No shipping queue entries.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {shippingQueue.map((row) => (
              <div key={row.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                <strong>{formatItemKey(row.item_key)}</strong> · Qty {row.quantity} · {formatCurrency(row.cost)} · {row.status}
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  {cityNamesById[row.from_city_id] ?? row.from_city_id} → {cityNamesById[row.to_city_id] ?? row.to_city_id} · arrives {formatDateTime(row.arrives_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
