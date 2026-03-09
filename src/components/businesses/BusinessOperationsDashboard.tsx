"use client";

import { EXTRACTION_OUTPUT_ITEM_BY_BUSINESS } from "@/config/production";
import type { Business } from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView, ProductionStatus } from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import { formatCurrency, formatLabel } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";

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

function MiniOpStat(props: { label: string; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
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
            <MiniOpStat label="Throughput" value={`${activeSlots} ${formatItemKey(outputItem)}/min`} sub={`${production.summary.active} active lanes`} tone="positive" />
            <MiniOpStat label="Slot Utilization" value={formatPercent(utilization)} sub={`${production.summary.active}/${production.maxSlots} slots running`} />
            <MiniOpStat label="Crew Coverage" value={formatPercent(occupancy)} sub={`${production.summary.occupied} staffed`} />
            <MiniOpStat label="Tool Health" value={averageToolHealth > 0 ? `${Math.round(averageToolHealth)} uses avg` : "No tools"} sub={production.summary.toolBroken > 0 ? `${production.summary.toolBroken} blocked` : "All lanes serviceable"} tone={production.summary.toolBroken > 0 ? "negative" : "neutral"} />
            <MiniOpStat label="Output Buffer" value={`${availableInventoryUnits} units`} sub={`Ready stock in yard`} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 18 }}>
          <HorizontalBarChart
            title="Lane Status"
            rows={[
              { label: "Active", value: production.summary.active, color: "#22c55e" },
              { label: "Idle", value: production.summary.idle, color: "#60a5fa" },
              { label: "Resting", value: production.summary.resting, color: "#f59e0b" },
              { label: "Tool Broken", value: production.summary.toolBroken, color: "#ef4444" },
            ]}
          />
          <OpsTable
            title="Dispatch Notes"
            rows={[
              { label: "Business Type", value: formatLabel(production.businessType) },
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
    const leadLine =
      props.manufacturing.lines.find((line) => line.status === "active") ??
      props.manufacturing.lines.find((line) => line.configured_recipe) ??
      props.manufacturing.lines[0] ??
      null;
    const recipe = leadLine?.configured_recipe ?? null;
    const perMinute = leadLine?.status === "active" && recipe ? recipe.baseOutputQuantity : 0;
    const inputCoverage = recipe
      ? recipe.inputs.map((input: { itemKey: string; quantity: number }) => {
          const available = props.inventory
            .filter((row) => row.item_key === input.itemKey)
            .reduce((sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity), 0);
          return {
            itemKey: input.itemKey,
            available,
            required: input.quantity,
            coverageMinutes: input.quantity > 0 ? Math.floor(available / input.quantity) : 0,
          };
        })
      : [];
    const bottleneck = inputCoverage.slice().sort((a: { coverageMinutes: number }, b: { coverageMinutes: number }) => a.coverageMinutes - b.coverageMinutes)[0] ?? null;
    const workerReady = props.manufacturing.summary.occupied > 0;

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
            <MiniOpStat label="Run Rate" value={recipe ? `${perMinute} ${formatItemKey(recipe.outputItemKey)}/min` : "No recipe"} sub={recipe ? recipe.displayName : "Retool a line to begin"} tone={leadLine?.status === "active" ? "positive" : "neutral"} />
            <MiniOpStat label="Cell Status" value={leadLine ? formatLabel(leadLine.status) : "Idle"} sub={workerReady ? "Worker on station" : "Worker missing"} tone={workerReady ? "positive" : "negative"} />
            <MiniOpStat label="Input Coverage" value={bottleneck ? `${bottleneck.coverageMinutes} min` : "N/A"} sub={bottleneck ? `${formatItemKey(bottleneck.itemKey)} is limiting` : "No recipe active"} tone={bottleneck && bottleneck.coverageMinutes === 0 ? "negative" : "neutral"} />
            <MiniOpStat label="Output Buffer" value={`${availableInventoryUnits} units`} sub="Finished stock on hand" />
            <MiniOpStat label="Crew" value={`${props.manufacturing.summary.occupied}/${props.manufacturing.maxLines}`} sub="Workers on production lines" />
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
              { label: "Inventory Ready", value: `${availableInventoryUnits} units` },
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
          <MiniOpStat label="Shelf Throughput" value={`${shelfUnits} units live`} sub={`${props.shelfItems.length} active facings`} tone="positive" />
          <MiniOpStat label="Shelf Fill" value={formatPercent(shelfFill)} sub={`${shelfUnits} shelf / ${availableInventoryUnits} backroom`} />
          <MiniOpStat label="Assortment Depth" value={`${props.shelfItems.length} SKUs`} sub={`${props.inventory.length} inventory lines`} />
          <MiniOpStat label="Average Ticket" value={props.shelfItems.length > 0 ? formatCurrency(averageShelfPrice) : "$0.00"} sub="Average shelf price" />
          <MiniOpStat label="Crew Attached" value={`${assignedEmployees.length}`} sub="Workers attached to this site" />
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
            { label: "Business Type", value: formatLabel(props.business.type) },
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
