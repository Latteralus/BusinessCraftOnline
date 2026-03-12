"use client";

import {
  getBusinessOperationalMode,
  supportsStorefront,
  type Business,
  type BusinessFinanceDashboard,
  type BusinessUpgrade,
} from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import {
  buildExtractionOperationsView,
  getLeadManufacturingLine,
  type ManufacturingStatusView,
  type ProductionStatus,
} from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency, formatLabel } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import { useEffect, useMemo, useState } from "react";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = (current.x + next.x) / 2;
    const midpointY = (current.y + next.y) / 2;
    path += ` Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midpointX.toFixed(2)} ${midpointY.toFixed(2)}`;
  }

  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  path += ` Q ${penultimate.x.toFixed(2)} ${penultimate.y.toFixed(2)} ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return path;
}

function SparklineCard(props: {
  label: string;
  value: string;
  sub: string;
  color: string;
  values: number[];
  tone?: "neutral" | "positive" | "negative";
}) {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const width = 220;
  const height = 52;
  const pad = 6;
  const pulseRadius = 3.5 + ((Math.sin(nowMs / 350) + 1) / 2) * 1.8;

  const { path, points } = useMemo(() => {
    const values = props.values.length > 0 ? props.values : [0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const coords = values.map((value, index) => {
      const x = pad + (values.length <= 1 ? (width - pad * 2) / 2 : (index / (values.length - 1)) * (width - pad * 2));
      const y = pad + (height - pad * 2) - ((value - min) / range) * (height - pad * 2);
      return { x, y };
    });

    return {
      path: buildSmoothPath(coords),
      points: coords,
    };
  }, [props.values]);

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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
            {props.label}
          </div>
          <div style={{ fontSize: "1.35rem", fontWeight: 700, color }}>{props.value}</div>
          <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: 120, height: 52, overflow: "visible" }}>
          <path d={path} fill="none" stroke={props.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.length > 0 ? (
            <>
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={pulseRadius} fill={props.color} fillOpacity={0.95} />
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={pulseRadius + 4} fill={props.color} fillOpacity={0.12} />
            </>
          ) : null}
        </svg>
      </div>
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
  const production = props.production;
  const finance = props.financeDashboard?.periods["30d"] ?? props.financeDashboard?.periods["7d"] ?? null;
  const assignedEmployees = props.employees.filter((employee) => employee.employer_business_id === props.business.id);
  const availableInventoryUnits = props.inventory.reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved_quantity), 0);
  const reservedInventoryUnits = props.inventory.reduce((sum, item) => sum + item.reserved_quantity, 0);
  const inventoryLines = props.inventory.length;
  const isStore = supportsStorefront(props.business.type);
  const operationalMode = getBusinessOperationalMode(props.business.type);

  const extractionView = production ? buildExtractionOperationsView(production) : null;
  const extractionThroughput = extractionView?.throughputPerMinute ?? 0;
  const degradedExtractionSlots = extractionView?.degradedSlots ?? 0;

  const operationsHeadline = production
    ? degradedExtractionSlots > 0
      ? `${production.summary.active}/${production.maxSlots} extraction lanes active · ${degradedExtractionSlots} degraded`
      : `${production.summary.active}/${production.maxSlots} extraction lanes active`
    : props.manufacturing
      ? `${props.manufacturing.summary.active}/${props.manufacturing.maxLines} production lines active`
      : isStore
        ? `${props.shelfItems.length} active shelf rows`
        : "No live operations";

  const activeManufacturingLine = props.manufacturing ? getLeadManufacturingLine(props.manufacturing) : null;
  const manufacturingOutputKeys = new Set(
    (props.manufacturing?.lines ?? [])
      .map((line) => line.configured_recipe?.outputItemKey ?? null)
      .filter((itemKey): itemKey is string => Boolean(itemKey))
  );
  const manufacturingFinishedUnits = props.inventory
    .filter((row) => manufacturingOutputKeys.has(row.item_key))
    .reduce((sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity), 0);
  const throughputHeadline = production
    ? `${extractionThroughput} ${formatItemKey(
        extractionView?.outputItemKey ?? "output"
      )}/min`
    : activeManufacturingLine?.configured_recipe
      ? `${activeManufacturingLine.configured_recipe.baseOutputQuantity} ${formatItemKey(activeManufacturingLine.configured_recipe.outputItemKey)}/min`
      : isStore
        ? `${props.shelfItems.reduce((sum, row) => sum + row.quantity, 0)} shelf units live`
        : "N/A";

  const valueDelta = props.financeDashboard
    ? props.financeDashboard.valuation.currentValue - props.financeDashboard.valuation.previousValue
    : 0;

  const workforceMax = Math.max(1, assignedEmployees.length, props.production?.maxSlots ?? 0, props.shelfItems.length);
  const activeOps = production?.summary.active ?? (props.manufacturing?.summary.active ?? 0);
  const blockedOps = degradedExtractionSlots || (props.manufacturing?.summary.retooling ?? 0);
  const sparklineSource = props.financeDashboard?.periods["30d"]?.series?.length
    ? props.financeDashboard.periods["30d"].series
    : props.financeDashboard?.periods["7d"]?.series?.length
      ? props.financeDashboard.periods["7d"].series
      : props.financeDashboard?.periods["24h"]?.series ?? [];
  const valuationSeries = useMemo(() => {
    if (!props.financeDashboard) return [props.business.value];
    const baseValue = props.financeDashboard.valuation.baseValue;
    return (sparklineSource.length > 0 ? sparklineSource : [{ cash: 0, revenue: 0, grossProfit: 0 }]).map((point) =>
      (Number(point.cash ?? 0) + Math.max(0, Number(point.grossProfit ?? 0)) + baseValue)
    );
  }, [props.business.value, props.financeDashboard, sparklineSource]);
  const cashSeries = useMemo(
    () => (sparklineSource.length > 0 ? sparklineSource.map((point) => Number(point.cash ?? 0)) : [finance?.kpis.cash ?? 0]),
    [finance?.kpis.cash, sparklineSource]
  );
  const activitySeries = useMemo(() => {
    const source = props.financeDashboard?.periods["30d"]?.recentEvents ?? [];
    if (source.length === 0) {
      return [0];
    }

    const buckets = new Map<string, number>();
    for (const event of source) {
      const key = event.occurredAt.slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.values());
  }, [props.financeDashboard]);

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
              {formatBusinessType(props.business.type)} · {formatLabel(props.business.entity_type)} · {operationsHeadline}
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
          <SparklineCard
            label="Cash Position"
            value={finance ? formatCurrency(finance.kpis.cash) : formatCurrency(0)}
            sub={finance ? `${formatCurrency(finance.kpis.revenue)} revenue in window` : "Finance data unavailable"}
            color="#60a5fa"
            values={cashSeries}
          />
          <OverviewCard label="Workforce" value={`${assignedEmployees.length}`} sub={`${props.upgrades.length} upgrades installed`} />
          <OverviewCard label="Inventory Footprint" value={`${availableInventoryUnits} units`} sub={`${inventoryLines} inventory lines · ${reservedInventoryUnits} reserved`} />
          <OverviewCard label="Storefront" value={isStore ? `${props.shelfItems.length} facings` : "Industrial site"} sub={isStore ? "Shelf rows live" : "Production-focused asset"} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
        <SparklineCard
          label="Valuation Flow"
          value={formatCurrency(props.financeDashboard?.valuation.currentValue ?? props.business.value)}
          sub="Blended from live cash, profit, and base enterprise value"
          color="#f472b6"
          values={valuationSeries}
          tone={valueDelta >= 0 ? "positive" : "negative"}
        />
        <SparklineCard
          label="Activity Pulse"
          value={`${props.financeDashboard?.periods["30d"]?.recentEvents.length ?? 0} events`}
          sub="Recent operating and finance movement"
          color="#f59e0b"
          values={activitySeries}
        />
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
            { label: "Business Type", value: formatBusinessType(props.business.type) },
            { label: "Operating Mode", value: operationalMode.charAt(0).toUpperCase() + operationalMode.slice(1) },
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
            {
              label: props.manufacturing ? "Output Stock Units" : "Inventory Ready Units",
              value: `${props.manufacturing ? manufacturingFinishedUnits : availableInventoryUnits}`,
            },
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
                <div style={{ color: "var(--text-muted)", fontSize: 11 }} suppressHydrationWarning>{new Date(event.occurredAt).toLocaleDateString()}</div>
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
