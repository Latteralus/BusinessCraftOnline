"use client";

import type {
  BusinessInventoryItem,
  PersonalInventoryItem,
  ShippingQueueItem,
} from "@/domains/inventory";
import type { BankAccountWithBalance } from "@/domains/banking";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type InventoryResponse = {
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  shippingQueue: ShippingQueueItem[];
  error?: string;
};

type BankingAccountsResponse = {
  accounts: BankAccountWithBalance[];
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
  const [personalInventory, setPersonalInventory] = useState<PersonalInventoryItem[]>([]);
  const [businessInventory, setBusinessInventory] = useState<BusinessInventoryItem[]>([]);
  const [shippingQueue, setShippingQueue] = useState<ShippingQueueItem[]>([]);
  const [accounts, setAccounts] = useState<BankAccountWithBalance[]>([]);

  const [sourceType, setSourceType] = useState<"personal" | "business">("personal");
  const [sourceBusinessId, setSourceBusinessId] = useState("");
  const [destinationType, setDestinationType] = useState<"personal" | "business">("business");
  const [destinationBusinessId, setDestinationBusinessId] = useState("");
  const [destinationCityId, setDestinationCityId] = useState("");
  const [itemKey, setItemKey] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [quality, setQuality] = useState("40");
  const [fundingAccountId, setFundingAccountId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [inventoryRes, accountsRes] = await Promise.all([
      fetch("/api/inventory", { cache: "no-store" }),
      fetch("/api/banking/accounts", { cache: "no-store" }),
    ]);

    const inventoryJson = (await inventoryRes.json()) as InventoryResponse;
    const accountsJson = (await accountsRes.json()) as BankingAccountsResponse;

    if (!inventoryRes.ok) {
      setError(inventoryJson.error ?? "Failed to load inventory.");
      setLoading(false);
      return;
    }

    if (!accountsRes.ok) {
      setError(accountsJson.error ?? "Failed to load bank accounts.");
      setLoading(false);
      return;
    }

    setPersonalInventory(inventoryJson.personalInventory ?? []);
    setBusinessInventory(inventoryJson.businessInventory ?? []);
    setShippingQueue(inventoryJson.shippingQueue ?? []);
    setAccounts(accountsJson.accounts ?? []);

    const checking = (accountsJson.accounts ?? []).find((account) => account.account_type === "checking");
    if (checking) {
      setFundingAccountId((current) => current || checking.id);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  const businessOptions = useMemo(() => {
    const uniqueBusiness = new Map<string, string>();

    for (const row of businessInventory) {
      if (!uniqueBusiness.has(row.business_id)) {
        uniqueBusiness.set(row.business_id, row.city_id);
      }
    }

    return Array.from(uniqueBusiness.entries()).map(([businessId, cityId]) => ({
      businessId,
      cityId,
    }));
  }, [businessInventory]);

  async function submitTransfer() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const selectedSource = businessOptions.find((option) => option.businessId === sourceBusinessId);

    const response = await fetch("/api/inventory/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType,
        sourceBusinessId: sourceType === "business" ? sourceBusinessId : undefined,
        sourceCityId: sourceType === "business" ? selectedSource?.cityId : undefined,
        destinationType,
        destinationBusinessId: destinationType === "business" ? destinationBusinessId : undefined,
        destinationCityId: destinationType === "business" ? destinationCityId : undefined,
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
                        {option.businessId}
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
                          {option.businessId}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Destination City Id
                    <input
                      value={destinationCityId}
                      onChange={(event) => setDestinationCityId(event.target.value)}
                      placeholder="destination city uuid"
                    />
                  </label>
                </>
              ) : null}

              <label>
                Item Key
                <input value={itemKey} onChange={(event) => setItemKey(event.target.value)} />
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
                      Business {row.business_id} · City {row.city_id}
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
                      {row.from_city_id} → {row.to_city_id} · arrives {formatDate(row.arrives_at)}
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
