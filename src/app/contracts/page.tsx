"use client";

import type { BusinessWithBalance } from "@/domains/businesses";
import type { Contract, ContractStatus } from "@/domains/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

type BusinessesResponse = {
  businesses: BusinessWithBalance[];
  error?: string;
};

type ContractsResponse = {
  contracts: Contract[];
  error?: string;
};

type ContractResponse = {
  contract: Contract;
  error?: string;
};

const ACTIVE_STATUSES: ContractStatus[] = ["open", "accepted", "in_progress"];

export default function ContractsPage() {
  const [businesses, setBusinesses] = useState<BusinessWithBalance[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessId, setBusinessId] = useState("");
  const [title, setTitle] = useState("Supply Agreement");
  const [itemKey, setItemKey] = useState("iron_bar");
  const [requiredQuantity, setRequiredQuantity] = useState(10);
  const [unitPrice, setUnitPrice] = useState(5);

  async function loadBusinesses() {
    const response = await fetch("/api/businesses", { cache: "no-store" });
    const payload = (await response.json()) as BusinessesResponse;
    if (!response.ok) throw new Error(payload.error ?? "Failed to load businesses.");
    setBusinesses(payload.businesses ?? []);
    if (!businessId && payload.businesses?.length) {
      setBusinessId(payload.businesses[0].id);
    }
  }

  async function loadContracts() {
    const response = await fetch("/api/contracts", { cache: "no-store" });
    const payload = (await response.json()) as ContractsResponse;
    if (!response.ok) throw new Error(payload.error ?? "Failed to load contracts.");
    setContracts(payload.contracts ?? []);
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        await loadBusinesses();
        await loadContracts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contracts page.");
      } finally {
        setLoading(false);
      }
    }

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createContract() {
    if (!businessId || busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, title, itemKey, requiredQuantity, unitPrice }),
    });

    const payload = (await response.json()) as ContractResponse;
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Failed to create contract.");
      return;
    }

    await loadContracts();
  }

  async function action(contractId: string, kind: "accept" | "cancel" | "fulfill") {
    if (busy) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/contracts/${contractId}/${kind}`, { method: "POST" });
    const payload = (await response.json()) as ContractResponse;
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? `Failed to ${kind} contract.`);
      return;
    }

    await loadContracts();
  }

  return (
    <main>
      <header className="lc-page-header">
        <div>
          <h1>Contracts</h1>
          <p>
            Phase 11 contracts: create, accept, fulfill, and cancel supply agreements.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading contracts...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      {!loading ? (
        <section>
          <h2 style={{ marginTop: 0 }}>Create Contract</h2>
          <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
            <label>
              Business
              <select value={businessId} onChange={(event) => setBusinessId(event.target.value)} title="Business">
                <option value="">Select business</option>
                {businesses.map((business) => (
                  <option key={business.id} value={business.id}>
                    {business.name} ({business.type})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>

            <label>
              Item Key
              <input value={itemKey} onChange={(event) => setItemKey(event.target.value)} />
            </label>

            <label>
              Required Quantity
              <input
                type="number"
                min={1}
                value={requiredQuantity}
                onChange={(event) => setRequiredQuantity(Number(event.target.value) || 1)}
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

            <button onClick={() => void createContract()} disabled={busy || !businessId}>
              Create Contract
            </button>
          </div>
        </section>
      ) : null}

      {!loading ? (
        <section>
          <h2 style={{ marginTop: 0 }}>Your Contracts</h2>
          {contracts.length === 0 ? <p>No contracts yet.</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {contracts.map((contract) => {
              const remaining = Math.max(0, contract.required_quantity - contract.delivered_quantity);
              const isActive = ACTIVE_STATUSES.includes(contract.status);

              return (
                <article
                  key={contract.id}
                  style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, display: "grid", gap: 4 }}
                >
                  <strong>{contract.title}</strong>
                  <span>
                    {contract.item_key} — {contract.delivered_quantity}/{contract.required_quantity}
                  </span>
                  <span>
                    Status: {contract.status} | Unit Price: ${contract.unit_price.toFixed(2)} | Remaining: {remaining}
                  </span>

                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {contract.status === "open" ? (
                      <button onClick={() => void action(contract.id, "accept")} disabled={busy}>
                        Accept
                      </button>
                    ) : null}

                    {isActive ? (
                      <button onClick={() => void action(contract.id, "fulfill")} disabled={busy}>
                        Fulfill
                      </button>
                    ) : null}

                    {isActive || contract.status === "open" ? (
                      <button onClick={() => void action(contract.id, "cancel")} disabled={busy}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
