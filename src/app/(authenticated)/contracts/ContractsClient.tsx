"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NPC_PRICE_CEILINGS } from "@/config/items";
import type { Contract, ContractStatus } from "@/domains/contracts";
import { formatCurrency } from "@/lib/formatters";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { fetchContractsPageData, queryKeys, type ContractsPageData } from "@/lib/client/queries";
import { formatItemKey } from "@/lib/items";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

type Props = {
  initialData: ContractsPageData;
};

const ACTIVE_STATUSES: ContractStatus[] = ["open", "accepted", "in_progress"];

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

function MetricCard(props: { label: string; value: string; sub: string; tone?: "neutral" | "positive" | "negative" | "accent" }) {
  const color =
    props.tone === "positive"
      ? "#86efac"
      : props.tone === "negative"
        ? "#fca5a5"
        : props.tone === "accent"
          ? "#c4b5fd"
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

function FieldLabel(props: { children: ReactNode }) {
  return <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", marginBottom: 6 }}>{props.children}</div>;
}

function StatusBadge(props: { status: ContractStatus }) {
  const styles: Record<ContractStatus, CSSProperties> = {
    open: { border: "1px solid rgba(96, 165, 250, 0.28)", background: "rgba(96, 165, 250, 0.12)", color: "#bfdbfe" },
    accepted: { border: "1px solid rgba(251, 191, 36, 0.28)", background: "rgba(251, 191, 36, 0.12)", color: "#fde68a" },
    in_progress: { border: "1px solid rgba(168, 85, 247, 0.28)", background: "rgba(168, 85, 247, 0.12)", color: "#d8b4fe" },
    fulfilled: { border: "1px solid rgba(34, 197, 94, 0.28)", background: "rgba(34, 197, 94, 0.12)", color: "#86efac" },
    cancelled: { border: "1px solid rgba(248, 113, 113, 0.28)", background: "rgba(248, 113, 113, 0.12)", color: "#fca5a5" },
    expired: { border: "1px solid rgba(148, 163, 184, 0.24)", background: "rgba(148, 163, 184, 0.1)", color: "#cbd5e1" },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...styles[props.status],
      }}
    >
      {props.status.replace("_", " ")}
    </span>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ContractsClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const contractsPageQuery = useQuery({
    queryKey: queryKeys.contractsPage,
    queryFn: fetchContractsPageData,
    initialData,
  });
  const businesses = contractsPageQuery.data.businesses;
  const contracts = contractsPageQuery.data.contracts;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [itemKey, setItemKey] = useState(Object.keys(NPC_PRICE_CEILINGS)[0] ?? "");
  const [requiredQuantity, setRequiredQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0.01);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === businessId) ?? null,
    [businessId, businesses]
  );

  const summary = useMemo(() => {
    const open = contracts.filter((contract) => contract.status === "open").length;
    const live = contracts.filter((contract) => ACTIVE_STATUSES.includes(contract.status)).length;
    const fulfilled = contracts.filter((contract) => contract.status === "fulfilled").length;
    const totalValue = contracts.reduce((sum, contract) => sum + contract.required_quantity * contract.unit_price, 0);
    const remainingUnits = contracts.reduce(
      (sum, contract) => sum + Math.max(0, contract.required_quantity - contract.delivered_quantity),
      0
    );
    const completionRate =
      contracts.length > 0 ? (fulfilled / contracts.length) * 100 : 0;

    return { open, live, fulfilled, totalValue, remainingUnits, completionRate };
  }, [contracts]);

  const pipeline = useMemo(() => {
    return {
      open: contracts.filter((contract) => contract.status === "open"),
      execution: contracts.filter((contract) => contract.status === "accepted" || contract.status === "in_progress"),
      closed: contracts.filter((contract) => ["fulfilled", "cancelled", "expired"].includes(contract.status)),
    };
  }, [contracts]);

  async function refreshContractsData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.contractsPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.businessesPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventoryPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.marketPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bankingPage }),
    ]);
  }

  async function createContract() {
    if (!businessId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(
        apiRoutes.contracts.root,
        { businessId, title: title.trim(), itemKey, requiredQuantity, unitPrice },
        { fallbackError: "Failed to create contract." }
      );
      await refreshContractsData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create contract.");
    } finally {
      setBusy(false);
    }
  }

  async function action(contractId: string, kind: "accept" | "cancel" | "fulfill") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path =
        kind === "accept"
          ? apiRoutes.contracts.accept(contractId)
          : kind === "cancel"
            ? apiRoutes.contracts.cancel(contractId)
            : apiRoutes.contracts.fulfill(contractId);
      await apiPost(path, undefined, { fallbackError: `Failed to ${kind} contract.` });
      await refreshContractsData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${kind} contract.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim" style={{ display: "grid", gap: 18 }}>
      <header className="lc-page-header">
        <div>
          <h1>Contracts</h1>
          <p>Your deals and supply orders.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      <section
        style={{
          marginTop: 0,
          background:
            "radial-gradient(circle at top left, rgba(167, 139, 250, 0.12), transparent 30%), radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 26%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Deal Room</div>
            <div style={{ marginTop: 8, fontSize: "1.95rem", fontWeight: 800, color: "#f8fafc" }}>
              Contracts
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              Post supply orders, take jobs, and track what still needs to be delivered.
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
            <div style={{ color: "#cbd5e1", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em" }}>Contract Status</div>
            <StatusBadge status={contractsPageQuery.isFetching ? "accepted" : "fulfilled"} />
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {summary.live} live agreements across {businesses.length} businesses
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
          <MetricCard label="Open Solicitations" value={`${summary.open}`} sub="Awaiting acceptance" tone="accent" />
          <MetricCard label="Live Pipeline" value={`${summary.live}`} sub="Open, accepted, or in progress" />
          <MetricCard label="Booked Contract Value" value={formatCurrency(summary.totalValue)} sub="Notional value across all agreements" tone="positive" />
          <MetricCard label="Remaining Units" value={`${summary.remainingUnits}`} sub="Outstanding delivery commitment" />
          <MetricCard label="Fulfillment Rate" value={`${summary.completionRate.toFixed(0)}%`} sub={`${summary.fulfilled} contracts closed successfully`} tone="positive" />
        </div>
      </section>

      {error ? (
        <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(248, 113, 113, 0.28)", background: "rgba(127, 29, 29, 0.22)", color: "#fecaca" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.92fr)", gap: 18 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Issuer Desk" eyebrow="Create Agreement">
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(260px, 0.85fr)", gap: 18 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <label>
                  <FieldLabel>Issuing Business</FieldLabel>
                  <select value={businessId} onChange={(event) => setBusinessId(event.target.value)} title="Business">
                    <option value="">Select business</option>
                    {businesses.map((business) => (
                      <option key={business.id} value={business.id}>{business.name} ({business.type})</option>
                    ))}
                  </select>
                </label>
                <label>
                  <FieldLabel>Agreement Title</FieldLabel>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Regional grain supply agreement" />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel>Item</FieldLabel>
                    <select value={itemKey} onChange={(event) => setItemKey(event.target.value)}>
                      {Object.keys(NPC_PRICE_CEILINGS).map((key) => (
                        <option key={key} value={key}>{formatItemKey(key)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel>Required Quantity</FieldLabel>
                    <input type="number" min={1} value={requiredQuantity} onChange={(event) => setRequiredQuantity(Number(event.target.value) || 1)} />
                  </label>
                  <label>
                    <FieldLabel>Unit Price</FieldLabel>
                    <input type="number" min={0.01} step={0.01} value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value) || 0.01)} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => void createContract()} disabled={busy || !businessId || !title.trim()}>
                    {busy ? "Issuing..." : "Create Contract"}
                  </button>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    Agreement face value {formatCurrency(requiredQuantity * unitPrice)}
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid rgba(148, 163, 184, 0.12)", borderRadius: 16, padding: 16, background: "rgba(8, 13, 24, 0.72)", display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 6 }}>
                    Agreement Brief
                  </div>
                  <div style={{ color: "#f8fafc", fontSize: "1.1rem", fontWeight: 700 }}>
                    {title.trim() || "Untitled contract"}
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>
                    {selectedBusiness ? `${selectedBusiness.name} issuing at ${formatCurrency(selectedBusiness.balance)} cash balance` : "Choose the business posting the agreement."}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Commodity</span><strong>{formatItemKey(itemKey)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Required volume</span><strong>{requiredQuantity} units</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Rate</span><strong>{formatCurrency(unitPrice)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Contract value</span><strong>{formatCurrency(requiredQuantity * unitPrice)}</strong></div>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  Use this desk to create B2B sourcing agreements that complement the market page: contracts establish a committed obligation, while market listings remain opportunistic inventory flow.
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Agreement Board" eyebrow="Pipeline">
            {contracts.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>No contracts yet. Issue a supply agreement to start the pipeline.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {contracts.map((contract) => {
                  const remaining = Math.max(0, contract.required_quantity - contract.delivered_quantity);
                  const isActive = ACTIVE_STATUSES.includes(contract.status);
                  const progress = contract.required_quantity > 0 ? (contract.delivered_quantity / contract.required_quantity) * 100 : 0;
                  const contractValue = contract.required_quantity * contract.unit_price;
                  const deliveredValue = contract.delivered_quantity * contract.unit_price;

                  return (
                    <article key={contract.id} style={{ border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 16, padding: 16, background: "radial-gradient(circle at top right, rgba(167, 139, 250, 0.06), transparent 26%), linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))", display: "grid", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                            <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{contract.title}</h3>
                            <StatusBadge status={contract.status} />
                          </div>
                          <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                            {formatItemKey(contract.item_key)} delivery agreement created {formatTimestamp(contract.created_at)}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Face Value</div>
                          <div style={{ marginTop: 4, fontWeight: 800, fontSize: "1.15rem", color: "#f8fafc" }}>{formatCurrency(contractValue)}</div>
                          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Delivered {formatCurrency(deliveredValue)}</div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                          <span style={{ color: "var(--text-secondary)" }}>Delivery Progress</span>
                          <strong>{contract.delivered_quantity}/{contract.required_quantity}</strong>
                        </div>
                        <div style={{ height: 10, background: "rgba(148,163,184,0.1)", borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ width: `${Math.max(4, Math.min(100, progress))}%`, height: "100%", background: contract.status === "fulfilled" ? "#22c55e" : contract.status === "cancelled" ? "#f87171" : "#a78bfa", borderRadius: 999 }} />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Remaining</div>
                          <div style={{ marginTop: 6, fontWeight: 700 }}>{remaining} units</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Unit Price</div>
                          <div style={{ marginTop: 6, fontWeight: 700 }}>{formatCurrency(contract.unit_price)}</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Accepted</div>
                          <div style={{ marginTop: 6, fontWeight: 700 }}>{formatTimestamp(contract.accepted_at)}</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Due / Expiry</div>
                          <div style={{ marginTop: 6, fontWeight: 700 }}>{formatTimestamp(contract.due_at ?? contract.expires_at)}</div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        {contract.status === "open" ? <button onClick={() => void action(contract.id, "accept")} disabled={busy}>Accept</button> : null}
                        {isActive ? <button onClick={() => void action(contract.id, "fulfill")} disabled={busy}>Fulfill</button> : null}
                        {isActive || contract.status === "open" ? (
                          <button onClick={() => void action(contract.id, "cancel")} disabled={busy} style={{ border: "1px solid rgba(148, 163, 184, 0.16)", background: "rgba(15, 23, 42, 0.72)", color: "#e2e8f0" }}>
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Pipeline Snapshot" eyebrow="Board Readout">
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ padding: 14, borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.12)", background: "rgba(8, 13, 24, 0.7)" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Pipeline Mix</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Open offers</span><strong>{pipeline.open.length}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Execution</span><strong>{pipeline.execution.length}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--text-secondary)" }}>Closed</span><strong>{pipeline.closed.length}</strong></div>
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.12)", background: "rgba(8, 13, 24, 0.7)" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Execution Queue</div>
                <div style={{ display: "grid", gap: 10 }}>
                  {pipeline.execution.length > 0 ? (
                    pipeline.execution.slice(0, 5).map((contract) => (
                      <div key={contract.id} style={{ display: "grid", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ color: "#e2e8f0" }}>{contract.title}</span>
                          <strong>{Math.max(0, contract.required_quantity - contract.delivered_quantity)} left</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--text-secondary)", fontSize: 12 }}>
                          <span>{formatItemKey(contract.item_key)}</span>
                          <span>{formatCurrency(contract.unit_price)} / unit</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "var(--text-muted)" }}>No agreements currently in execution.</div>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
