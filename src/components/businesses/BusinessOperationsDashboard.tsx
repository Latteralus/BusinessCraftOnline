"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import type { Business } from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import {
  buildExtractionOperationsView,
  buildManufacturingOperationsView,
  getExtractionSlotThroughput,
  type ManufacturingStatusView,
  type ProductionStatus,
} from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency, formatLabel } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { PRODUCTION_RETOOL_DURATION_MINUTES } from "@/config/production";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useNowMs() {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return nowMs;
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getLiveCycleProgress(anchorIso: string | null, baseProgress: number, ratePerMinute: number, nowMs: number) {
  const normalizedBase = clamp(baseProgress, 0, 0.999);
  if (!anchorIso || ratePerMinute <= 0) {
    return normalizedBase;
  }

  const anchorMs = new Date(anchorIso).getTime();
  if (!Number.isFinite(anchorMs)) {
    return normalizedBase;
  }

  const elapsedMinutes = Math.max(0, (nowMs - anchorMs) / 60_000);
  const generatedUnits = normalizedBase + elapsedMinutes * ratePerMinute;
  return generatedUnits - Math.floor(generatedUnits);
}

function getRetoolProgress(retoolCompleteAt: string | null, nowMs: number) {
  if (!retoolCompleteAt) {
    return null;
  }

  const completeMs = new Date(retoolCompleteAt).getTime();
  if (!Number.isFinite(completeMs)) {
    return null;
  }

  const startedMs = completeMs - PRODUCTION_RETOOL_DURATION_MINUTES * 60_000;
  const progress = clamp((nowMs - startedMs) / (completeMs - startedMs), 0, 1);
  return {
    progress,
    remainingMs: Math.max(0, completeMs - nowMs),
  };
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

function LiveFlowPanel(props: {
  title: string;
  nowMs: number;
  rows: Array<{ id: string; label: string; sublabel: string; progress: number; color: string; accent?: string }>;
}) {
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
      <div style={{ display: "grid", gap: 12 }}>
        {props.rows.map((row) => (
          <div key={row.id} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <div>
                <div style={{ color: "#f8fafc", fontWeight: 600 }}>{row.label}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{row.sublabel}</div>
              </div>
              <div style={{ color: row.accent ?? row.color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {Math.round(row.progress * 100)}%
              </div>
            </div>
            <div style={{ position: "relative", height: 12, borderRadius: 999, background: "rgba(148, 163, 184, 0.08)", overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(90deg, ${row.color}22, ${row.color}55, ${row.color}22)`,
                  transform: `translateX(${((props.nowMs / 40) % 200) - 100}%)`,
                  opacity: 0.45,
                }}
              />
              <div style={{ width: `${row.progress * 100}%`, height: "100%", background: row.color, borderRadius: 999, transition: "width 900ms linear" }} />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `calc(${row.progress * 100}% - 7px)`,
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  transform: "translateY(-50%)",
                  background: row.color,
                  boxShadow: `0 0 0 4px ${row.color}22, 0 0 18px ${row.color}66`,
                  transition: "left 900ms linear",
                }}
              />
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
  const nowMs = useNowMs();
  const assignedEmployees = props.employees.filter((employee) => employee.employer_business_id === props.business.id);
  const availableInventoryUnits = props.inventory.reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved_quantity), 0);
  const shelfUnits = props.shelfItems.reduce((sum, item) => sum + item.quantity, 0);

  if (props.production) {
    const { production } = props;
    const activeSlots = production.summary.active;
    const { throughputPerMinute, degradedSlots, outputItemKey } = buildExtractionOperationsView(production);
    const utilization = production.maxSlots > 0 ? (activeSlots / production.maxSlots) * 100 : 0;
    const occupancy = production.maxSlots > 0 ? (production.summary.occupied / production.maxSlots) * 100 : 0;
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
            <MiniOpStat label={<TooltipLabel label="Throughput" content="Expected per-minute extraction output from all active slots, including degraded fallback output when tools are missing." />} value={`${throughputPerMinute} ${formatItemKey(outputItemKey)}/min`} sub={degradedSlots > 0 ? `${production.summary.active} active lanes · ${degradedSlots} degraded` : `${production.summary.active} active lanes`} tone="positive" />
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
              { label: "Output Commodity", value: formatItemKey(outputItemKey) },
              { label: "Assigned Workers", value: `${production.summary.occupied}/${production.maxSlots}` },
              { label: "Idle Capacity", value: `${Math.max(0, production.maxSlots - production.summary.active)} slots` },
              { label: "Inventory Ready", value: `${availableInventoryUnits} units` },
            ]}
          />
        </div>
        <LiveFlowPanel
          title="Live Lane Flow"
          nowMs={nowMs}
          rows={production.slots.slice(0, 5).map((slot) => {
            const isActive = slot.status === "active";
            const retool = getRetoolProgress(slot.retool_complete_at, nowMs);
            const progress = retool
              ? retool.progress
              : getLiveCycleProgress(
                  slot.last_extracted_at,
                  slot.output_progress,
                  isActive ? getExtractionSlotThroughput(slot, production.businessType) : 0,
                  nowMs
                );
            return {
              id: slot.id,
              label: `${slot.line_label} ${slot.slot_number}`,
              sublabel: retool
                ? `Retooling · ${formatCountdown(retool.remainingMs)} remaining`
                : `${formatLabel(slot.status)}${slot.employee_id ? " · staffed" : " · unstaffed"}`,
              progress,
              color: retool ? "#c084fc" : isActive ? "#22c55e" : slot.status === "resting" ? "#f59e0b" : "#60a5fa",
            };
          })}
        />
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
        <LiveFlowPanel
          title="Live Cell Pulse"
          nowMs={nowMs}
          rows={props.manufacturing.lines.slice(0, 5).map((line) => {
            const retool = getRetoolProgress(line.retool_complete_at, nowMs);
            const recipeRate = line.configured_recipe?.baseOutputQuantity ?? 0;
            const progress = retool
              ? retool.progress
              : getLiveCycleProgress(line.last_tick_at, line.output_progress, line.status === "active" ? recipeRate : 0, nowMs);
            return {
              id: line.id,
              label: `Line ${line.line_number}`,
              sublabel: retool
                ? `Retooling · ${formatCountdown(retool.remainingMs)} remaining`
                : `${line.configured_recipe?.displayName ?? "No recipe"} · ${formatLabel(line.status)}`,
              progress,
              color: retool ? "#c084fc" : line.status === "active" ? "#facc15" : line.status === "resting" ? "#f59e0b" : "#60a5fa",
            };
          })}
        />
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
