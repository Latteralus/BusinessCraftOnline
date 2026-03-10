"use client";

import { EXTRACTION_OUTPUT_ITEM_BY_BUSINESS } from "@/config/production";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
} from "@/config/production";
import type { Business } from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView, ProductionStatus } from "@/domains/production";
import { buildManufacturingOperationsView } from "@/domains/production/view";
import type { StoreShelfItem } from "@/domains/stores";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency, formatLabel } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import type { ReactNode } from "react";

type Props = {
  business: Business;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  shelfItems: StoreShelfItem[];
  employees: (Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] })[];
};

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function calculateExtractionThroughput(production: ProductionStatus) {
  return production.slots.reduce((sum, slot) => {
    if (slot.status !== "active") return sum;

    const businessType = production.businessType as keyof typeof EXTRACTION_REQUIRED_TOOL_BY_BUSINESS;
    const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[businessType];
    const fallbackMultiplier = EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[businessType] ?? 0;
    const hasOperationalTool =
      !requiredTool ||
      (slot.tool_item_key === requiredTool &&
        slot.tool?.item_type === requiredTool &&
        (slot.tool?.uses_remaining ?? 0) > 0);

    return sum + (hasOperationalTool ? 1 : fallbackMultiplier || 0);
  }, 0);
}

function MiniOpStat(props: { label: ReactNode; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
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
      <div style={{ fontSize: "1.3rem", fontWeight: 700, color }}>{props.value}</div>
      {props.sub ? <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div> : null}
    </div>
  );
}

function HorizontalBarChart(props: { title: string; rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...props.rows.map((row) => row.value));
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(11, 17, 29, 0.98), rgba(6, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 14 }}>
        {props.title}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {props.rows.map((row) => (
          <div key={row.label} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
              <strong style={{ color: "#f8fafc" }}>{row.value}</strong>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "rgba(148, 163, 184, 0.1)", overflow: "hidden" }}>
              <div style={{ width: `${(row.value / max) * 100}%`, height: "100%", background: row.color, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpsTable(props: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(11, 17, 29, 0.98), rgba(6, 10, 19, 0.98))",
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

export default function BusinessOperationsDashboard(props: Props) {
  const assignedEmployees = props.employees.filter((employee) => employee.employer_business_id === props.business.id);
  const availableInventoryUnits = props.inventory.reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved_quantity), 0);
  const shelfUnits = props.shelfItems.reduce((sum, item) => sum + item.quantity, 0);

  if (props.production) {
    const { production } = props;
    const activeSlots = production.summary.active;
    const throughputPerMinute = calculateExtractionThroughput(production);
    const degradedSlots = production.slots.filter((slot) => {
      if (slot.status !== "active") return false;
      const businessType = production.businessType as keyof typeof EXTRACTION_REQUIRED_TOOL_BY_BUSINESS;
      const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[businessType];
      if (!requiredTool) return false;
      return !(
        slot.tool_item_key === requiredTool &&
        slot.tool?.item_type === requiredTool &&
        (slot.tool?.uses_remaining ?? 0) > 0
      );
    }).length;
    const utilization = production.maxSlots > 0 ? (activeSlots / production.maxSlots) * 100 : 0;
    const occupancy = production.maxSlots > 0 ? (production.summary.occupied / production.maxSlots) * 100 : 0;
    const outputItem =
      EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[
        production.businessType as keyof typeof EXTRACTION_OUTPUT_ITEM_BY_BUSINESS
      ];
    const averageToolHealth =
      production.slots.filter((slot) => slot.tool).length > 0
        ? production.slots
            .filter((slot) => slot.tool)
            .reduce((sum, slot) => sum + (slot.tool?.uses_remaining ?? 0), 0) /
          production.slots.filter((slot) => slot.tool).length
        : 0;

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
            Extraction Control Room
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <MiniOpStat label={<TooltipLabel label="Throughput" content="Expected per-minute extraction output from all active slots, including degraded fallback output when tools are missing." />} value={`${throughputPerMinute} ${formatItemKey(outputItem)}/min`} sub={degradedSlots > 0 ? `${production.summary.active} active lanes · ${degradedSlots} degraded` : `${production.summary.active} active lanes`} tone="positive" />
            <MiniOpStat label={<TooltipLabel label="Slot Utilization" content="Share of total extraction slots that are actively running." />} value={formatPercent(utilization)} sub={`${production.summary.active}/${production.maxSlots} slots running`} />
            <MiniOpStat label={<TooltipLabel label="Crew Coverage" content="Share of slots that currently have a worker assigned." />} value={formatPercent(occupancy)} sub={`${production.summary.occupied} staffed`} />
            <MiniOpStat label={<TooltipLabel label="Tool Health" content="Average remaining tool uses across equipped slots. Missing or depleted tools can degrade output." />} value={averageToolHealth > 0 ? `${Math.round(averageToolHealth)} uses avg` : "No tools"} sub={degradedSlots > 0 ? `${degradedSlots} lane${degradedSlots === 1 ? "" : "s"} on fallback output` : "All lanes serviceable"} tone={degradedSlots > 0 ? "negative" : "neutral"} />
            <MiniOpStat label={<TooltipLabel label="Output Buffer" content="Ready units already sitting in business inventory waiting for use or sale." />} value={`${availableInventoryUnits} units`} sub={`Ready stock in yard`} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 18 }}>
          <HorizontalBarChart
            title="Lane Status"
            rows={[
              { label: "Active", value: production.summary.active, color: "#22c55e" },
              { label: "Idle", value: production.summary.idle, color: "#60a5fa" },
              { label: "Resting", value: production.summary.resting, color: "#f59e0b" },
              { label: "Fallback Rate", value: degradedSlots, color: "#ef4444" },
            ]}
          />
          <OpsTable
            title="Dispatch Notes"
            rows={[
              { label: "Business Type", value: formatBusinessType(production.businessType) },
              { label: "Output Commodity", value: formatItemKey(outputItem) },
              { label: "Assigned Workers", value: `${production.summary.occupied}/${production.maxSlots}` },
              { label: "Idle Capacity", value: `${Math.max(0, production.maxSlots - production.summary.active)} slots` },
              { label: "Inventory Ready", value: `${availableInventoryUnits} units` },
            ]}
          />
        </div>
      </div>
    );
  }

  if (props.manufacturing) {
    const {
      leadLine,
      recipe,
      finishedInventoryUnits,
      perMinute,
      bottleneck,
      workerReady,
    } = buildManufacturingOperationsView(props.manufacturing, props.inventory);

    return (
      <div style={{ display: "grid", gap: 18, marginBottom: 18 }}>
        <div
          style={{
            background: "radial-gradient(circle at top left, rgba(250, 204, 21, 0.12), transparent 35%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            borderRadius: 18,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 16 }}>
            Manufacturing Control Room
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <MiniOpStat label={<TooltipLabel label="Run Rate" content="Expected output per minute from the lead active manufacturing line." />} value={recipe ? `${perMinute} ${formatItemKey(recipe.outputItemKey)}/min` : "No recipe"} sub={recipe ? recipe.displayName : "Retool a line to begin"} tone={leadLine?.status === "active" ? "positive" : "neutral"} />
            <MiniOpStat label={<TooltipLabel label="Cell Status" content="Current state of the lead line, including whether it is idle, active, resting, or retooling." />} value={leadLine ? formatLabel(leadLine.status) : "Idle"} sub={workerReady ? "Worker on station" : "Worker missing"} tone={workerReady ? "positive" : "negative"} />
            <MiniOpStat label={<TooltipLabel label="Input Coverage" content="Estimated minutes of production remaining before the most constrained input runs out." />} value={bottleneck ? `${bottleneck.coverageMinutes} min` : "N/A"} sub={bottleneck ? `${formatItemKey(bottleneck.itemKey)} is limiting` : "No recipe active"} tone={bottleneck && bottleneck.coverageMinutes === 0 ? "negative" : "neutral"} />
            <MiniOpStat label={<TooltipLabel label="Output Buffer" content="Finished goods already produced and waiting in inventory." />} value={`${finishedInventoryUnits} units`} sub="Produced stock on hand" />
            <MiniOpStat label={<TooltipLabel label="Crew" content="Workers currently assigned to manufacturing lines compared with total line capacity." />} value={`${props.manufacturing.summary.occupied}/${props.manufacturing.maxLines}`} sub="Workers on production lines" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 18 }}>
          <HorizontalBarChart
            title="Line Status"
            rows={
              [
                { label: "Active", value: props.manufacturing.summary.active, color: "#22c55e" },
                { label: "Idle", value: props.manufacturing.summary.idle, color: "#60a5fa" },
                { label: "Resting", value: props.manufacturing.summary.resting, color: "#f59e0b" },
                { label: "Retooling", value: props.manufacturing.summary.retooling, color: "#c084fc" },
              ]
            }
          />
          <OpsTable
            title="Line Notes"
            rows={[
              { label: "Recipe", value: recipe ? recipe.displayName : "No active recipe" },
              { label: "Worker Assigned", value: workerReady ? "Yes" : "No" },
              { label: "Line Status", value: leadLine ? formatLabel(leadLine.status) : "Idle" },
              { label: "Bottleneck", value: bottleneck ? formatItemKey(bottleneck.itemKey) : "None" },
              { label: "Output Stock", value: `${finishedInventoryUnits} units` },
            ]}
          />
        </div>
      </div>
    );
  }

  const shelfFill = availableInventoryUnits + shelfUnits > 0 ? (shelfUnits / (availableInventoryUnits + shelfUnits)) * 100 : 0;
  const averageShelfPrice =
    props.shelfItems.length > 0
      ? props.shelfItems.reduce((sum, item) => sum + item.unit_price, 0) / props.shelfItems.length
      : 0;

  return (
    <div style={{ display: "grid", gap: 18, marginBottom: 18 }}>
      <div
        style={{
          background: "radial-gradient(circle at top left, rgba(96, 165, 250, 0.12), transparent 35%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 16 }}>
          Storefloor Control Room
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <MiniOpStat label={<TooltipLabel label="Shelf Throughput" content="Units currently displayed for retail sale on the store floor." />} value={`${shelfUnits} units live`} sub={`${props.shelfItems.length} active facings`} tone="positive" />
          <MiniOpStat label={<TooltipLabel label="Shelf Fill" content="How much of the combined shelf-plus-backroom stock is currently staged on shelves." />} value={formatPercent(shelfFill)} sub={`${shelfUnits} shelf / ${availableInventoryUnits} backroom`} />
          <MiniOpStat label={<TooltipLabel label="Assortment Depth" content="How many distinct shelf rows or SKUs are actively merchandised." />} value={`${props.shelfItems.length} SKUs`} sub={`${props.inventory.length} inventory lines`} />
          <MiniOpStat label={<TooltipLabel label="Average Ticket" content="Average price per shelf row, useful as a quick signal of store positioning." />} value={props.shelfItems.length > 0 ? formatCurrency(averageShelfPrice) : "$0.00"} sub="Average shelf price" />
          <MiniOpStat label={<TooltipLabel label="Crew Attached" content="Workers currently attached to this store location." />} value={`${assignedEmployees.length}`} sub="Workers attached to this site" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 18 }}>
        <HorizontalBarChart
          title="Store Readiness"
          rows={[
            { label: "Shelf Units", value: shelfUnits, color: "#22c55e" },
            { label: "Backroom Units", value: availableInventoryUnits, color: "#60a5fa" },
            { label: "Active Facings", value: props.shelfItems.length, color: "#f59e0b" },
          ]}
        />
        <OpsTable
          title="Floor Notes"
          rows={[
            { label: "Business Type", value: formatBusinessType(props.business.type) },
            { label: "Shelf Items", value: `${props.shelfItems.length}` },
            { label: "Backroom Inventory", value: `${availableInventoryUnits} units` },
            { label: "Crew Attached", value: `${assignedEmployees.length}` },
            { label: "Average Shelf Price", value: props.shelfItems.length > 0 ? formatCurrency(averageShelfPrice) : "$0.00" },
          ]}
        />
      </div>
    </div>
  );
}
