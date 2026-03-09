"use client";

import { isStoreBusinessType } from "@/config/businesses";
import { EXTRACTION_OUTPUT_ITEM_BY_BUSINESS } from "@/config/production";
import type { Business, BusinessFinanceDashboard, BusinessUpgrade } from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView, ProductionStatus } from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import { formatCurrency, formatLabel } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";

type Props = {
  business: Business;
  financeDashboard: BusinessFinanceDashboard | null;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  shelfItems: StoreShelfItem[];
  upgrades: BusinessUpgrade[];
  employees: (Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] })[];
};

function OverviewCard(props: { label: string; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
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
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 700, color }}>{props.value}</div>
      {props.sub ? <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div> : null}
    </div>
  );
}

function SummaryPanel(props: { title: string; rows: Array<{ label: string; value: string }> }) {
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

function PulseBars(props: { title: string; rows: Array<{ label: string; value: number; max: number; color: string }> }) {
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
        {props.rows.map((row) => {
          const width = row.max > 0 ? Math.max(4, (row.value / row.max) * 100) : 4;
          return (
            <div key={row.label} style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                <strong style={{ color: "#f8fafc" }}>{row.value}</strong>
              </div>
              <div style={{ height: 10, background: "rgba(148,163,184,0.1)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${width}%`, height: "100%", background: row.color, borderRadius: 999 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BusinessOverviewDashboard(props: Props) {
  const finance = props.financeDashboard?.periods["30d"] ?? props.financeDashboard?.periods["7d"] ?? null;
  const assignedEmployees = props.employees.filter((employee) => employee.employer_business_id === props.business.id);
  const availableInventoryUnits = props.inventory.reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved_quantity), 0);
  const reservedInventoryUnits = props.inventory.reduce((sum, item) => sum + item.reserved_quantity, 0);
  const inventoryLines = props.inventory.length;
  const isStore = isStoreBusinessType(props.business.type);

  const operationsHeadline = props.production
    ? `${props.production.summary.active}/${props.production.maxSlots} extraction lanes active`
    : props.manufacturing
      ? `${props.manufacturing.summary.active}/${props.manufacturing.maxLines} production lines active`
      : isStore
        ? `${props.shelfItems.length} active shelf rows`
        : "No live operations";

  const activeManufacturingLine = props.manufacturing?.lines.find((line) => line.status === "active") ?? null;
  const throughputHeadline = props.production
    ? `${props.production.summary.active} ${formatItemKey(
        EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[props.production.businessType as keyof typeof EXTRACTION_OUTPUT_ITEM_BY_BUSINESS]
      )}/tick`
    : activeManufacturingLine?.configured_recipe
      ? `${activeManufacturingLine.configured_recipe.baseOutputQuantity} ${formatItemKey(activeManufacturingLine.configured_recipe.outputItemKey)}/tick`
      : isStore
        ? `${props.shelfItems.reduce((sum, row) => sum + row.quantity, 0)} shelf units live`
        : "N/A";

  const valueDelta = props.financeDashboard
    ? props.financeDashboard.valuation.currentValue - props.financeDashboard.valuation.previousValue
    : 0;

  const workforceMax = Math.max(1, assignedEmployees.length, props.production?.maxSlots ?? 0, props.shelfItems.length);
  const activeOps = props.production?.summary.active ?? (props.manufacturing?.summary.active ?? 0);
  const blockedOps = props.production?.summary.toolBroken ?? (props.manufacturing?.summary.retooling ?? 0);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          background: "radial-gradient(circle at top left, rgba(244, 114, 182, 0.10), transparent 32%), radial-gradient(circle at top right, rgba(96, 165, 250, 0.12), transparent 30%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Executive Overview</div>
            <div style={{ marginTop: 8, fontSize: "1.9rem", fontWeight: 800, color: "#f8fafc" }}>{props.business.name}</div>
            <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 13 }}>
              {formatLabel(props.business.type)} · {formatLabel(props.business.entity_type)} · {operationsHeadline}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Current Valuation</div>
            <div style={{ marginTop: 6, fontSize: "1.5rem", fontWeight: 800, color: "#f8fafc" }}>
              {formatCurrency(props.financeDashboard?.valuation.currentValue ?? props.business.value)}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: valueDelta >= 0 ? "#86efac" : "#fca5a5" }}>
              {valueDelta >= 0 ? "Up" : "Down"} {formatCurrency(Math.abs(valueDelta))} vs prior stored value
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 18 }}>
          <OverviewCard label="Throughput" value={throughputHeadline} sub={operationsHeadline} tone="positive" />
          <OverviewCard label="Cash Position" value={finance ? formatCurrency(finance.kpis.cash) : formatCurrency(0)} sub={finance ? `${formatCurrency(finance.kpis.revenue)} revenue in window` : "Finance data unavailable"} />
          <OverviewCard label="Workforce" value={`${assignedEmployees.length}`} sub={`${props.upgrades.length} upgrades installed`} />
          <OverviewCard label="Inventory Footprint" value={`${availableInventoryUnits} units`} sub={`${inventoryLines} inventory lines · ${reservedInventoryUnits} reserved`} />
          <OverviewCard label="Storefront" value={isStore ? `${props.shelfItems.length} facings` : "Industrial site"} sub={isStore ? "Shelf rows live" : "Production-focused asset"} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 18 }}>
        <PulseBars
          title="Business Pulse"
          rows={[
            { label: "Active Operations", value: activeOps, max: Math.max(1, props.production?.maxSlots ?? 1), color: "#22c55e" },
            { label: "Blocked Operations", value: blockedOps, max: Math.max(1, props.production?.maxSlots ?? 1), color: "#ef4444" },
            { label: "Assigned Workforce", value: assignedEmployees.length, max: workforceMax, color: "#60a5fa" },
            { label: "Inventory Lines", value: inventoryLines, max: Math.max(1, inventoryLines, props.shelfItems.length), color: "#f59e0b" },
            { label: "Shelf / Dispatch Rows", value: props.shelfItems.length, max: Math.max(1, props.shelfItems.length, inventoryLines), color: "#a78bfa" },
          ]}
        />
        <SummaryPanel
          title="At A Glance"
          rows={[
            { label: "Entity", value: formatLabel(props.business.entity_type) },
            { label: "Business Type", value: formatLabel(props.business.type) },
            { label: "Operating Mode", value: props.production ? "Extraction" : props.manufacturing ? "Manufacturing" : isStore ? "Retail" : "Idle" },
            { label: "Finance Signal", value: finance ? `${formatCurrency(finance.kpis.operatingProfit)} operating profit` : "No recent data" },
            { label: "Inventory Asset", value: props.financeDashboard ? formatCurrency(props.financeDashboard.balanceSheet.find((row) => row.label === "Inventory")?.amount ?? 0) : "$0.00" },
          ]}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        <SummaryPanel
          title="Capital Snapshot"
          rows={[
            { label: "Owner Equity", value: finance ? formatCurrency(finance.kpis.ownerEquity) : "$0.00" },
            { label: "Revenue", value: finance ? formatCurrency(finance.kpis.revenue) : "$0.00" },
            { label: "Gross Profit", value: finance ? formatCurrency(finance.kpis.grossProfit) : "$0.00" },
            { label: "Operating Profit", value: finance ? formatCurrency(finance.kpis.operatingProfit) : "$0.00" },
            { label: "Gross Margin", value: finance?.kpis.grossMargin !== null && finance?.kpis.grossMargin !== undefined ? `${finance.kpis.grossMargin.toFixed(1)}%` : "N/A" },
          ]}
        />
        <SummaryPanel
          title="Operational Readiness"
          rows={[
            { label: "Headline", value: operationsHeadline },
            { label: "Throughput", value: throughputHeadline },
            { label: "Assigned Employees", value: `${assignedEmployees.length}` },
            { label: "Inventory Ready Units", value: `${availableInventoryUnits}` },
            { label: "Reserved / Committed", value: `${reservedInventoryUnits}` },
          ]}
        />
        <SummaryPanel
          title="Asset Posture"
          rows={[
            { label: "Inventory Lines", value: `${inventoryLines}` },
            { label: "Upgrades Installed", value: `${props.upgrades.length}` },
            { label: "Shelf Rows", value: `${props.shelfItems.length}` },
            { label: "Business Value (stored)", value: formatCurrency(props.business.value) },
            { label: "Live Valuation", value: formatCurrency(props.financeDashboard?.valuation.currentValue ?? props.business.value) },
          ]}
        />
      </div>

      {props.financeDashboard?.periods["30d"]?.recentEvents?.length ? (
        <div
          style={{
            background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
            Recent Movement
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {props.financeDashboard.periods["30d"].recentEvents.slice(0, 6).map((event) => (
              <div key={event.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, borderBottom: "1px solid rgba(148,163,184,0.08)", paddingBottom: 8 }}>
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{new Date(event.occurredAt).toLocaleDateString()}</div>
                <div>
                  <div style={{ color: "#f8fafc" }}>{event.label}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{event.source} · {event.accountCode}</div>
                </div>
                <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{formatCurrency(event.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
