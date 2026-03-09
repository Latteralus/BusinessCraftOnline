"use client";

import { NPC_PRICE_CEILINGS } from "@/config/items";
import type { BusinessInventoryItem, PersonalInventoryItem, ShippingQueueItem } from "@/domains/inventory";
import type { BankAccountWithBalance, BankingAccountsResponse } from "@/domains/banking";
import type { BusinessesResponse, BusinessWithBalance } from "@/domains/businesses";
import type { CitiesResponse } from "@/domains/cities-travel";
import { apiGet, apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import Link from "next/link";
import { useMemo, useState } from "react";

type Props = {
  initialData: {
    personalInventory: PersonalInventoryItem[];
    businessInventory: BusinessInventoryItem[];
    shippingQueue: ShippingQueueItem[];
    accounts: BankAccountWithBalance[];
    businesses: BusinessWithBalance[];
    businessNamesById: Record<string, string>;
    cityNamesById: Record<string, string>;
  };
};

export default function InventoryClient({ initialData }: Props) {
  const availableItemKeys = Object.keys(NPC_PRICE_CEILINGS);
  const [personalInventory, setPersonalInventory] = useState(initialData.personalInventory);
  const [businessInventory, setBusinessInventory] = useState(initialData.businessInventory);
  const [shippingQueue, setShippingQueue] = useState(initialData.shippingQueue);
  const [accounts, setAccounts] = useState(initialData.accounts);
  const [businesses, setBusinesses] = useState(initialData.businesses);
  const [businessNamesById, setBusinessNamesById] = useState(initialData.businessNamesById);
  const [cityNamesById, setCityNamesById] = useState(initialData.cityNamesById);
  const [sourceType, setSourceType] = useState<"personal" | "business">("personal");
  const [sourceBusinessId, setSourceBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [destinationType, setDestinationType] = useState<"personal" | "business">("business");
  const [destinationBusinessId, setDestinationBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [itemKey, setItemKey] = useState(availableItemKeys[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const [quality, setQuality] = useState("40");
  const [fundingAccountId, setFundingAccountId] = useState(initialData.accounts.find((a) => a.account_type === "checking")?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
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

  type InventoryResponse = {
    personalInventory: PersonalInventoryItem[];
    businessInventory: BusinessInventoryItem[];
    shippingQueue: ShippingQueueItem[];
    businessNamesById: Record<string, string>;
    cityNamesById: Record<string, string>;
    error?: string;
  };

  type TransferResponse = {
    transferType?: "shipping" | "instant";
    shippingMinutes?: number;
    shippingCost?: number;
    error?: string;
  };

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [inventoryJson, accountsJson, businessesJson, citiesJson] = await Promise.all([
        apiGet<InventoryResponse>(apiRoutes.inventory.root, { fallbackError: "Failed to load inventory." }),
        apiGet<BankingAccountsResponse>(apiRoutes.banking.accounts, { fallbackError: "Failed to load bank accounts." }),
        apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
        apiGet<CitiesResponse>(apiRoutes.cities, { fallbackError: "Failed to load cities." }),
      ]);

      setPersonalInventory(inventoryJson.personalInventory ?? []);
      setBusinessInventory(inventoryJson.businessInventory ?? []);
      setShippingQueue(inventoryJson.shippingQueue ?? []);
      setBusinessNamesById(inventoryJson.businessNamesById ?? {});
      const nextCityNamesById: Record<string, string> = { ...(inventoryJson.cityNamesById ?? {}) };
      for (const city of citiesJson.cities ?? []) {
        nextCityNamesById[city.id] = city.name;
      }
      setCityNamesById(nextCityNamesById);
      setAccounts(accountsJson.accounts ?? []);
      setBusinesses(businessesJson.businesses ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh inventory.");
    } finally {
      setLoading(false);
    }
  }

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
          fundingAccountId,
        },
        { fallbackError: "Transfer failed." }
      );

      setSuccess(
        data.transferType === "shipping"
          ? `Transfer queued for shipping (${data.shippingMinutes ?? 0} min, ${formatCurrency(data.shippingCost ?? 0)}).`
          : "Transfer completed instantly."
      );

      await loadData();
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

      {loading ? <p>Refreshing inventory data...</p> : null}
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
          <button onClick={submitTransfer} disabled={submitting || !itemKey.trim() || Number(quantity) <= 0 || Number(quality) < 1 || Number(quality) > 100}>
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
