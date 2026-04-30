"use client";

import { DEFAULT_INVENTORY_UNIT_COST, INVENTORY_BASELINE_UNIT_COSTS } from "@/config/finance";
import { TooltipLabel } from "@/components/ui/tooltip";
import { summarizeBusinessInventory, type BusinessInventoryItem } from "@/domains/inventory";
import type { StoreShelfItem } from "@/domains/stores";
import { formatCurrency } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Props = {
  inventory: BusinessInventoryItem[];
  shelfItems: StoreShelfItem[];
};

function InventoryCard(props: { label: ReactNode; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
  const color =
    props.tone === "positive" ? "#86efac" : props.tone === "negative" ? "#fca5a5" : "#f8fafc";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(11, 17, 29, 0.98), rgba(6, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 700, color }}>{props.value}</div>
      {props.sub ? <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div> : null}
    </div>
  );
}

function InventoryBars(props: { title: string; rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...props.rows.map((row) => row.value));
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
        {props.title}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {props.rows.map((row) => (
          <div key={row.label} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
              <strong style={{ color: "#f8fafc" }}>{row.value}</strong>
            </div>
            <div style={{ height: 10, background: "rgba(148,163,184,0.1)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, height: "100%", background: row.color, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InventoryTable(props: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
        {props.title}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {props.rows.map((row) => (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, borderBottom: "1px solid rgba(148,163,184,0.08)", paddingBottom: 8 }}>
            <div style={{ color: "var(--text-secondary)" }}>{row.label}</div>
            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowRail(props: { label: string; sub: string; progress: number; color: string }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ color: "#f8fafc", fontWeight: 600 }}>{props.label}</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div>
        </div>
        <strong style={{ color: props.color }}>{Math.round(props.progress * 100)}%</strong>
      </div>
      <div style={{ position: "relative", height: 10, background: "rgba(148,163,184,0.1)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${props.progress * 100}%`, height: "100%", background: props.color, borderRadius: 999, transition: "width 900ms linear" }} />
      </div>
    </div>
  );
}

export default function BusinessInventoryDashboard({ inventory, shelfItems }: Props) {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const summary = summarizeBusinessInventory(inventory, shelfItems);
  const estimatedAssetValue = inventory.reduce((sum, row) => {
    const unitCost =
      row.unit_cost && row.unit_cost > 0
        ? row.unit_cost
        : INVENTORY_BASELINE_UNIT_COSTS[row.item_key] ?? DEFAULT_INVENTORY_UNIT_COST;
    return sum + row.quantity * unitCost;
  }, 0);
  const topLines = inventory
    .map((row) => ({ label: `${formatItemKey(row.item_key)} Q${row.quality}`, value: row.quantity }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const liveMarkerColor = ["#22c55e", "#60a5fa", "#f59e0b"][Math.floor((nowMs / 1200) % 3)];

  return (
    <div style={{ display: "grid", gap: 18, marginBottom: 18 }}>
      <div
        style={{
          background: "radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 35%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 16 }}>
          Inventory Control Room
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <InventoryCard label={<TooltipLabel label="Available Stock" content="Units currently free to move, sell, or feed into operations." />} value={`${summary.availableUnits} units`} sub={`${inventory.length} inventory lines`} tone="positive" />
          <InventoryCard label={<TooltipLabel label="Reserved Stock" content="Units already committed to shelves, listings, or other downstream obligations." />} value={`${summary.reservedUnits} units`} sub="Committed to shelves or listings" tone={summary.reservedUnits > 0 ? "negative" : "neutral"} />
          <InventoryCard label={<TooltipLabel label="Shelf Staging" content="Units currently placed onto live shelves for retail sale." />} value={`${summary.shelfUnits} units`} sub={`${shelfItems.length} shelf rows live`} />
          <InventoryCard label={<TooltipLabel label="Asset Estimate" content="Approximate inventory value using observed unit cost or fallback baseline costs." />} value={formatCurrency(estimatedAssetValue)} sub="Based on observed or baseline cost" />
          <InventoryCard label={<TooltipLabel label="Total Footprint" content="All units held by the business, regardless of whether they are free or reserved." />} value={`${summary.totalUnits} units`} sub="Across all item grades" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 18 }}>
        <InventoryBars
          title="Stock Position"
          rows={[
            { label: "Available", value: summary.availableUnits, color: "#22c55e" },
            { label: "Reserved", value: summary.reservedUnits, color: "#ef4444" },
            { label: "Shelf Units", value: summary.shelfUnits, color: "#60a5fa" },
          ]}
        />
        <InventoryTable
          title="Stock Notes"
          rows={[
            { label: "Inventory Lines", value: `${inventory.length}` },
            { label: "Shelf Rows", value: `${shelfItems.length}` },
            { label: "Available Units", value: `${summary.availableUnits}` },
            { label: "Reserved Units", value: `${summary.reservedUnits}` },
            { label: "Estimated Asset", value: formatCurrency(estimatedAssetValue) },
          ]}
        />
      </div>

      <div
        style={{
          background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
          border: "1px solid rgba(148, 163, 184, 0.16)",
          borderRadius: 16,
          padding: 18,
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
          Live Stock Flow
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <FlowRail label="Shelf Pull" sub={`${summary.shelfUnits} staged for sale or dispatch`} progress={summary.shelfFill} color="#22c55e" />
          <FlowRail label="Reserve Load" sub={`${summary.reservedUnits} committed units locked`} progress={summary.reserveLoad} color="#ef4444" />
          <FlowRail label="Free Flow" sub={`${summary.availableUnits} units ready to move`} progress={summary.freeFlow} color={liveMarkerColor} />
        </div>
      </div>

      <InventoryBars
        title="Top Stock Lines"
        rows={
          topLines.length > 0
            ? topLines.map((row, index) => ({
                label: row.label,
                value: row.value,
                color: ["#22c55e", "#60a5fa", "#f59e0b", "#a78bfa", "#f43f5e"][index % 5],
              }))
            : [{ label: "No stock", value: 0, color: "#334155" }]
        }
      />
    </div>
  );
}
