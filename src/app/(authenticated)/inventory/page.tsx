"use client";

import { NPC_PRICE_CEILINGS } from "@/config/items";
import type {
  BusinessInventoryItem,
  PersonalInventoryItem,
  ShippingQueueItem,
} from "@/domains/inventory";
import type { BankAccountWithBalance } from "@/domains/banking";
import type { BusinessWithBalance } from "@/domains/businesses";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type InventoryResponse = {
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  shippingQueue: ShippingQueueItem[];
  businessNamesById?: Record<string, string>;
  cityNamesById?: Record<string, string>;
  error?: string;
};

type BankingAccountsResponse = {
  accounts: BankAccountWithBalance[];
  error?: string;
};

type BusinessesResponse = {
  businesses: BusinessWithBalance[];
  error?: string;
};

type CitiesResponse = {
  cities: Array<{ id: string; name: string }>;
  error?: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function InventoryPage() {
  const availableItemKeys = Object.keys(NPC_PRICE_CEILINGS);
  const [personalInventory, setPersonalInventory] = useState<PersonalInventoryItem[]>([]);
  const [businessInventory, setBusinessInventory] = useState<BusinessInventoryItem[]>([]);
  const [shippingQueue, setShippingQueue] = useState<ShippingQueueItem[]>([]);
  const [accounts, setAccounts] = useState<BankAccountWithBalance[]>([]);
  const [businesses, setBusinesses] = useState<BusinessWithBalance[]>([]);
  const [businessNamesById, setBusinessNamesById] = useState<Record<string, string>>({});
  const [cityNamesById, setCityNamesById] = useState<Record<string, string>>({});

  const [sourceType, setSourceType] = useState<"personal" | "business">("personal");
  const [sourceBusinessId, setSourceBusinessId] = useState("");
  const [destinationType, setDestinationType] = useState<"personal" | "business">("business");
  const [destinationBusinessId, setDestinationBusinessId] = useState("");
  const [itemKey, setItemKey] = useState(availableItemKeys[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const [quality, setQuality] = useState("40");
  const [fundingAccountId, setFundingAccountId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadData(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    const [inventoryRes, accountsRes, businessesRes, citiesRes] = await Promise.all([
      fetch("/api/inventory", { cache: "no-store" }),
      fetch("/api/banking/accounts", { cache: "no-store" }),
      fetch("/api/businesses", { cache: "no-store" }),
      fetch("/api/cities", { cache: "no-store" }),
    ]);

    const inventoryJson = (await inventoryRes.json()) as InventoryResponse;
    const accountsJson = (await accountsRes.json()) as BankingAccountsResponse;
    const businessesJson = (await businessesRes.json()) as BusinessesResponse;
    const citiesJson = (await citiesRes.json()) as CitiesResponse;

    if (!inventoryRes.ok) {
      setError(inventoryJson.error ?? "Failed to load inventory.");
      if (showLoading) {
        setLoading(false);
      }
      return;
    }

    if (!accountsRes.ok) {
      setError(accountsJson.error ?? "Failed to load bank accounts.");
      if (showLoading) {
        setLoading(false);
      }
      return;
    }

    if (!businessesRes.ok) {
      setError(businessesJson.error ?? "Failed to load businesses.");
      if (showLoading) {
        setLoading(false);
      }
      return;
    }

    if (!citiesRes.ok) {
      setError(citiesJson.error ?? "Failed to load cities.");
      if (showLoading) {
        setLoading(false);
      }
      return;
    }

    setPersonalInventory(inventoryJson.personalInventory ?? []);
    setBusinessInventory(inventoryJson.businessInventory ?? []);
    setShippingQueue(inventoryJson.shippingQueue ?? []);
    const businessNameMap: Record<string, string> = { ...(inventoryJson.businessNamesById ?? {}) };
    for (const business of businessesJson.businesses ?? []) {
      businessNameMap[business.id] = business.name;
    }
    setBusinessNamesById(businessNameMap);
    const cityNameMap: Record<string, string> = { ...(inventoryJson.cityNamesById ?? {}) };
    for (const city of citiesJson.cities ?? []) {
      cityNameMap[city.id] = city.name;
    }
    setCityNamesById(cityNameMap);
    setAccounts(accountsJson.accounts ?? []);
    setBusinesses(businessesJson.businesses ?? []);

    const checking = (accountsJson.accounts ?? []).find((account) => account.account_type === "checking");
    if (checking) {
      setFundingAccountId((current) => current || checking.id);
    }

    if (businessesJson.businesses && businessesJson.businesses.length > 0) {
      setSourceBusinessId((current) => current || businessesJson.businesses[0].id);
      setDestinationBusinessId((current) => current || businessesJson.businesses[0].id);
    }

    if (showLoading) {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useAutoRefresh(() => loadData(false), { intervalMs: 10000, enabled: !loading });

  const businessOptions = useMemo(
    () =>
      businesses.map((business) => ({
        businessId: business.id,
        businessName: business.name,
        cityId: business.city_id,
      })),
    [businesses]
  );

  async function submitTransfer() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const selectedSource = businessOptions.find((option) => option.businessId === sourceBusinessId);
    const selectedDestination = businessOptions.find(
      (option) => option.businessId === destinationBusinessId
    );

    const response = await fetch("/api/inventory/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    const data = (await response.json()) as {
      transferType?: "same_city" | "shipping";
      shippingCost?: number;
      shippingMinutes?: number;
      error?: string;
    };

    setSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Transfer failed.");
      return;
    }

    if (data.transferType === "shipping") {
      setSuccess(
        `Transfer queued for shipping (${data.shippingMinutes ?? 0} min, ${formatCurrency(
          data.shippingCost ?? 0
        )}).`
      );
    } else {
      setSuccess("Transfer completed instantly.");
    }

    await loadData();
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Inventory</h1>
          <p>
            Personal inventory, business inventory, shipping queue, and transfer controls.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading inventory data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      {success ? <p style={{ color: "#34d399" }}>{success}</p> : null}

      {!loading ? (
        <>
          <section>
            <h2 style={{ marginTop: 0 }}>Transfer Items</h2>
            <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
              <label>
                Source Type
                <select
                  value={sourceType}
                  onChange={(event) => setSourceType(event.target.value as "personal" | "business")}
                >
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                </select>
              </label>

              {sourceType === "business" ? (
                <label>
                  Source Business
                  <select
                    value={sourceBusinessId}
                    onChange={(event) => setSourceBusinessId(event.target.value)}
                  >
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
                <select
                  value={destinationType}
                  onChange={(event) => setDestinationType(event.target.value as "personal" | "business")}
                >
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                </select>
              </label>

              {destinationType === "business" ? (
                <>
                  <label>
                    Destination Business
                    <select
                      value={destinationBusinessId}
                      onChange={(event) => setDestinationBusinessId(event.target.value)}
                    >
                      <option value="">Select business</option>
                      {businessOptions.map((option) => (
                        <option key={option.businessId} value={option.businessId}>
                          {option.businessName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p style={{ margin: 0, color: "#94a3b8" }}>
                    Destination City:{" "}
                    {(() => {
                      const selected = businessOptions.find(
                        (option) => option.businessId === destinationBusinessId
                      );
                      return selected
                        ? cityNamesById[selected.cityId] ?? selected.cityId
                        : "Select destination business";
                    })()}
                  </p>
                </>
              ) : null}

              <label>
                Item
                <select value={itemKey} onChange={(event) => setItemKey(event.target.value)}>
                  {availableItemKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>

              <label>
                Quality
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={quality}
                  onChange={(event) => setQuality(event.target.value)}
                />
              </label>

              <label>
                Funding Account (for shipping)
                <select
                  value={fundingAccountId}
                  onChange={(event) => setFundingAccountId(event.target.value)}
                >
                  <option value="">Select account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.account_type} ({formatCurrency(account.balance)})
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={submitTransfer}
                disabled={
                  submitting ||
                  !itemKey.trim() ||
                  Number(quantity) <= 0 ||
                  Number(quality) < 1 ||
                  Number(quality) > 100
                }
              >
                {submitting ? "Submitting..." : "Submit Transfer"}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Personal Inventory</h2>
            {personalInventory.length === 0 ? (
              <p>No personal items.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {personalInventory.map((row) => (
                  <div key={row.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                    <strong>{row.item_key}</strong> · Qty {row.quantity} · Q{row.quality}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Business Inventory</h2>
            {businessInventory.length === 0 ? (
              <p>No business inventory rows.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {businessInventory.map((row) => (
                  <div key={row.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                    <strong>{row.item_key}</strong> · Qty {row.quantity} · Reserved {row.reserved_quantity} · Q
                    {row.quality}
                    <div style={{ color: "#94a3b8", fontSize: 13 }}>
                      Business {businessNamesById[row.business_id] ?? row.business_id} · City{" "}
                      {cityNamesById[row.city_id] ?? row.city_id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Shipping Queue</h2>
            {shippingQueue.length === 0 ? (
              <p>No shipping queue entries.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {shippingQueue.map((row) => (
                  <div key={row.id} style={{ border: "1px solid #334155", borderRadius: 6, padding: 8 }}>
                    <strong>{row.item_key}</strong> · Qty {row.quantity} · {formatCurrency(row.cost)} · {row.status}
                    <div style={{ color: "#94a3b8", fontSize: 13 }}>
                      {cityNamesById[row.from_city_id] ?? row.from_city_id} →{" "}
                      {cityNamesById[row.to_city_id] ?? row.to_city_id} · arrives{" "}
                      {formatDate(row.arrives_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
