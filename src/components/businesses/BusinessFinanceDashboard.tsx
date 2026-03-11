"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import type { BusinessFinanceDashboard } from "@/domains/businesses";
import { formatCurrency } from "@/lib/formatters";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  financeDashboard: BusinessFinanceDashboard | null;
  initialPeriod?: string;
};

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function formatLedgerTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function MiniStat(props: { label: ReactNode; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
  const toneColor =
    props.tone === "positive" ? "#86efac" : props.tone === "negative" ? "#fca5a5" : "var(--text-primary)";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(8, 13, 25, 0.96))",
        border: "1px solid rgba(148, 163, 184, 0.14)",
        borderRadius: 14,
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 700, color: toneColor }}>{props.value}</div>
      {props.sub ? <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>{props.sub}</div> : null}
    </div>
  );
}

function getProfitTone(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function formatCompactSigned(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function StatementTable(props: { title: string; rows: Array<{ label: string; amount: number }> }) {
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
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              paddingBottom: 8,
              borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ color: "var(--text-secondary)" }}>{row.label}</div>
            <div style={{ color: row.amount >= 0 ? "#e2e8f0" : "#fca5a5", fontWeight: 600 }}>{formatSignedCurrency(row.amount)}</div>
          </div>
        ))}
      </div>
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

function LineChart(props: {
  title: string;
  series: Array<{ label: string; value: number; color: string }>;
  points: Array<Record<string, number | string | boolean>>;
}) {
  const width = 520;
  const height = 180;
  const pad = 18;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const displayedPoints = useMemo(() => {
    return props.points.map((point, index, allPoints) => {
      const previousPoint = index > 0 ? allPoints[index - 1] : null;
      const bucketStart = new Date(String(point.bucketStart ?? "")).getTime();
      const bucketEnd = new Date(String(point.bucketEnd ?? "")).getTime();
      const progress =
        point.isCurrent && Number.isFinite(bucketStart) && Number.isFinite(bucketEnd) && bucketEnd > bucketStart
          ? clamp((nowMs - bucketStart) / (bucketEnd - bucketStart), 0, 1)
          : 1;

      const nextPoint = { ...point } as Record<string, number | string>;
      for (const serie of props.series) {
        const currentValue = Number(point[serie.label] ?? 0);
        const previousValue = previousPoint ? Number(previousPoint[serie.label] ?? 0) : 0;
        nextPoint[serie.label] = point.isCurrent
          ? previousValue + (currentValue - previousValue) * progress
          : currentValue;
      }
      nextPoint.liveProgress = progress;
      return nextPoint;
    });
  }, [nowMs, props.points, props.series]);

  const values = displayedPoints.flatMap((point) => props.series.map((serie) => Number(point[serie.label] ?? 0)));
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;

  const paths = props.series.map((serie) => {
    const coords = displayedPoints
      .map((point, index) => {
        const x = pad + (displayedPoints.length <= 1 ? chartW / 2 : (index / (displayedPoints.length - 1)) * chartW);
        const y = pad + chartH - ((Number(point[serie.label] ?? 0) - min) / range) * chartH;
        return { x, y };
      })
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    return { ...serie, d: buildSmoothPath(coords), coords };
  });

  const currentPointIndex = displayedPoints.findIndex((point) => point.isCurrent);
  const pulseRadius = 4 + ((Math.sin(nowMs / 350) + 1) / 2) * 2.5;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1" }}>{props.title}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {props.series.map((serie) => (
            <div key={serie.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: serie.color, display: "inline-block" }} />
              {serie.value.toLocaleString()}
            </div>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 1, 2, 3].map((step) => {
          const y = pad + (step / 3) * chartH;
          return <line key={step} x1={pad} y1={y} x2={width - pad} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />;
        })}
        {paths.map((serie) => (
          <path key={serie.label} d={serie.d} fill="none" stroke={serie.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {paths.map((serie) =>
          serie.coords.map((point, index) => (
            <circle
              key={`${serie.label}-${index}`}
              cx={point.x}
              cy={point.y}
              r={currentPointIndex === index ? pulseRadius : 2.2}
              fill={serie.color}
              fillOpacity={currentPointIndex === index ? 0.95 : 0.6}
            />
          ))
        )}
        {displayedPoints.map((point, index) => {
          const x = pad + (displayedPoints.length <= 1 ? chartW / 2 : (index / (displayedPoints.length - 1)) * chartW);
          return (
            <text key={`${String(point.label)}-${index}`} x={x} y={height - 2} textAnchor="middle" fill="rgba(148,163,184,0.8)" fontSize="10">
              {String(point.label)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function BusinessFinanceDashboardPanel({ financeDashboard }: Props) {
  const snapshot = financeDashboard?.periods["24h"];
  const changeFromPrevious = financeDashboard
    ? financeDashboard.valuation.currentValue - financeDashboard.valuation.previousValue
    : 0;
  const health = financeDashboard?.health ?? null;
  const horizonCards = useMemo(() => {
    if (!financeDashboard) return [];
    return [
      { key: "1h", title: "Right Now", snapshot: financeDashboard.periods["1h"] },
      { key: "24h", title: "Today", snapshot: financeDashboard.periods["24h"] },
      { key: "7d", title: "This Week", snapshot: financeDashboard.periods["7d"] },
      { key: "30d", title: "This Month", snapshot: financeDashboard.periods["30d"] },
    ];
  }, [financeDashboard]);

  const chartSeries = useMemo(() => {
    if (!snapshot) return [];
    return [
      { label: "revenue", value: snapshot.kpis.revenue, color: "#60a5fa" },
      { label: "cogs", value: snapshot.kpis.cogs, color: "#f97316" },
      { label: "grossProfit", value: snapshot.kpis.grossProfit, color: "#34d399" },
    ];
  }, [snapshot]);

  const cashSeries = useMemo(() => {
    if (!snapshot) return [];
    return [{ label: "cash", value: snapshot.kpis.cash, color: "#facc15" }];
  }, [snapshot]);
  const profitTrendSeries = useMemo(() => {
    if (!financeDashboard) return [];
    return [{ label: "grossProfit", value: financeDashboard.periods["30d"].kpis.grossProfit, color: "#34d399" }];
  }, [financeDashboard]);

  if (!financeDashboard || !snapshot) {
    return <p>Loading finance data...</p>;
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          background: "radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), transparent 35%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Finance Console</div>
            <div style={{ marginTop: 8, fontSize: "1.8rem", fontWeight: 800, color: "#f8fafc" }}>
              {formatCurrency(financeDashboard.valuation.currentValue)}
            </div>
            <div style={{ marginTop: 6, color: changeFromPrevious >= 0 ? "#86efac" : "#fca5a5", fontSize: 13 }}>
              {changeFromPrevious >= 0 ? "Up" : "Down"} {formatCurrency(Math.abs(changeFromPrevious))} vs stored business value
            </div>
          </div>
          <div style={{ minWidth: 260, maxWidth: 420 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Business Health</div>
            <div style={{ marginTop: 8, fontSize: "1.4rem", fontWeight: 800, color: health?.tone === "positive" ? "#86efac" : health?.tone === "negative" ? "#fca5a5" : "#f8fafc" }}>
              {health?.headline ?? "Loading"}
            </div>
            <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 13 }}>
              {health?.reason}
            </div>
            {health?.warnings.length ? (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
                {health.warnings.slice(0, 2).join(" ")}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <MiniStat label={<TooltipLabel label="Cash" content="Liquid business cash available right now." />} value={formatCurrency(snapshot.kpis.cash)} sub={health ? `${formatCompactSigned(health.cashDelta24h)} vs last 24h` : undefined} />
          <MiniStat label={<TooltipLabel label="Making Money" content="Operating profit after cost of goods sold and operating expenses." />} value={formatCurrency(financeDashboard.periods["7d"].kpis.operatingProfit)} sub="Last 7 days" tone={getProfitTone(financeDashboard.periods["7d"].kpis.operatingProfit)} />
          <MiniStat label={<TooltipLabel label="Gross Margin" content="Gross profit as a percentage of revenue after cost of goods sold." />} value={formatPercent(snapshot.kpis.grossMargin)} sub={formatCurrency(snapshot.kpis.grossProfit)} tone={snapshot.kpis.grossProfit >= 0 ? "positive" : "negative"} />
          <MiniStat label={<TooltipLabel label="Owner Equity" content="Net value attributable to the owner after liabilities are considered." />} value={formatCurrency(snapshot.kpis.ownerEquity)} />
          <MiniStat label={<TooltipLabel label="Runway" content="Estimated days the treasury can support current losses at the recent burn rate." />} value={health?.runwayDays === null || health?.runwayDays === undefined ? "Safe" : `${Math.max(1, Math.floor(health.runwayDays))}d`} sub={health?.runwayDays === null || health?.runwayDays === undefined ? "No sustained burn detected" : "At current burn rate"} tone={health?.runwayDays !== null && health?.runwayDays !== undefined && health.runwayDays < 7 ? "negative" : "neutral"} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {horizonCards.map(({ key, title, snapshot: horizon }) => (
          <div
            key={key}
            style={{
              background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
              border: key === "24h" ? "1px solid rgba(96, 165, 250, 0.34)" : "1px solid rgba(148, 163, 184, 0.16)",
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
              {title}
            </div>
            <div style={{ display: "grid", gap: 8, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>Revenue</span>
                <strong style={{ color: "#f8fafc" }}>{formatCurrency(horizon.kpis.revenue)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>Operating Profit</span>
                <strong style={{ color: horizon.kpis.operatingProfit > 0 ? "#86efac" : horizon.kpis.operatingProfit < 0 ? "#fca5a5" : "#f8fafc" }}>
                  {formatCurrency(horizon.kpis.operatingProfit)}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>Margin</span>
                <strong style={{ color: "#f8fafc" }}>{formatPercent(horizon.kpis.grossMargin)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>Storefront Net</span>
                <strong style={{ color: horizon.storefront.netRevenue > 0 ? "#86efac" : horizon.storefront.netRevenue < 0 ? "#fca5a5" : "#f8fafc" }}>
                  {formatCurrency(horizon.storefront.netRevenue)}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>Conversion</span>
                <strong style={{ color: "#f8fafc" }}>{formatPercent(horizon.storefront.conversionRate)}</strong>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <MiniStat
          label={<TooltipLabel label="Shopper Traffic" content="NPC shoppers generated for this storefront during the selected period." />}
          value={`${snapshot.storefront.shoppersGenerated}`}
          sub={snapshot.storefront.shoppersGenerated > 0 ? "NPC visits recorded" : "No shopper traffic yet"}
          tone={snapshot.storefront.shoppersGenerated > 0 ? "positive" : "neutral"}
        />
        <MiniStat
          label={<TooltipLabel label="Storefront Sales" content="Completed NPC shelf purchases captured by storefront snapshots." />}
          value={`${snapshot.storefront.salesCount}`}
          sub={`${snapshot.storefront.unitsSold} units sold`}
          tone={snapshot.storefront.salesCount > 0 ? "positive" : "neutral"}
        />
        <MiniStat
          label={<TooltipLabel label="Conversion" content="Storefront sales divided by generated NPC shoppers in this period." />}
          value={snapshot.storefront.conversionRate === null ? "N/A" : `${snapshot.storefront.conversionRate.toFixed(1)}%`}
          sub={
            snapshot.storefront.shoppersGenerated > 0 && snapshot.storefront.salesCount === 0
              ? "Traffic reached the store but did not convert"
              : "Sales per shopper"
          }
          tone={snapshot.storefront.salesCount > 0 ? "positive" : "neutral"}
        />
        <MiniStat
          label={<TooltipLabel label="Storefront Net" content="Gross storefront revenue after storefront fees and ad spend." />}
          value={formatCurrency(snapshot.storefront.netRevenue)}
          sub={`Gross ${formatCurrency(snapshot.storefront.grossRevenue)}`}
          tone={snapshot.storefront.netRevenue > 0 ? "positive" : snapshot.storefront.netRevenue < 0 ? "negative" : "neutral"}
        />
        <MiniStat
          label={<TooltipLabel label="Average Ticket" content="Average gross sale value per completed storefront purchase." />}
          value={snapshot.storefront.averageTicket === null ? "N/A" : formatCurrency(snapshot.storefront.averageTicket)}
          sub={`Ads ${formatCurrency(snapshot.storefront.adSpend)}`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr)", gap: 18 }}>
        <LineChart title="Today: Revenue / COGS / Gross Profit" series={chartSeries} points={snapshot.series} />
        <LineChart title="Today: Cash Balance" series={cashSeries} points={snapshot.series} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr)", gap: 18 }}>
        <LineChart title="Month: Gross Profit Trend" series={profitTrendSeries} points={financeDashboard.periods["30d"].series} />
        <StatementTable
          title="Health Signals"
          rows={[
            { label: "Today Operating Profit", amount: financeDashboard.periods["24h"].kpis.operatingProfit },
            { label: "7-Day Operating Profit", amount: financeDashboard.periods["7d"].kpis.operatingProfit },
            { label: "30-Day Operating Profit", amount: financeDashboard.periods["30d"].kpis.operatingProfit },
            { label: "24h Cash Change", amount: health?.cashDelta24h ?? 0 },
          ]}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
        <StatementTable title="Income Statement" rows={snapshot.incomeStatement} />
        <StatementTable title="Balance Sheet" rows={financeDashboard.balanceSheet} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 18 }}>
        <StatementTable
          title="Capital & Cash Flow"
          rows={[
            ...snapshot.cashFlow,
            { label: "Owner Contributions", amount: snapshot.capital.ownerContributions },
            { label: "Owner Draws", amount: -snapshot.capital.ownerDraws },
            { label: "Intercompany Sales", amount: snapshot.capital.intercompanySales },
            { label: "Intercompany Purchases", amount: -snapshot.capital.intercompanyPurchases },
          ]}
        />
        <div
          style={{
            background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
            Valuation Drivers
          </div>
          <div style={{ display: "grid", gap: 8, fontVariantNumeric: "tabular-nums" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Method</span><strong>{financeDashboard.valuation.methodology}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Annualized Revenue</span><strong>{formatCurrency(financeDashboard.valuation.annualizedRevenue)}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Annualized Operating Profit</span><strong>{formatCurrency(financeDashboard.valuation.annualizedOperatingProfit)}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Profit Multiple</span><strong>{financeDashboard.valuation.profitMultiple.toFixed(1)}x</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Revenue Multiple</span><strong>{financeDashboard.valuation.revenueMultiple.toFixed(1)}x</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Base Enterprise Value</span><strong>{formatCurrency(financeDashboard.valuation.baseValue)}</strong></div>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 6, color: "var(--text-secondary)", fontSize: 12 }}>
            {financeDashboard.assumptions.map((assumption) => (
              <div key={assumption}>{assumption}</div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
          border: "1px solid rgba(148, 163, 184, 0.16)",
          borderRadius: 16,
          padding: 18,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1" }}>
            Transaction Log
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Journal-style activity feed
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              minWidth: 700,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 170px) minmax(220px, 1.6fr) minmax(140px, 0.9fr) minmax(88px, 0.55fr) minmax(100px, 0.7fr)",
                gap: 12,
                padding: "0 0 8px",
                borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                marginBottom: 0,
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              <div>Posted</div>
              <div>Description</div>
              <div>Account</div>
              <div>Type</div>
              <div style={{ textAlign: "right" }}>Amount</div>
            </div>
            {snapshot.recentEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(120px, 170px) minmax(220px, 1.6fr) minmax(140px, 0.9fr) minmax(88px, 0.55fr) minmax(100px, 0.7fr)",
                  gap: 12,
                  alignItems: "start",
                  borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
                  paddingBottom: 10,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <div>
                  <div style={{ color: "#cbd5e1", fontSize: 12, fontWeight: 600 }}>{formatLedgerTimestamp(event.occurredAt)}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{event.sourceLabel}</div>
                </div>
                <div>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{event.label}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    {event.source === "ledger" ? "Cash-impacting entry" : "Accrual or inventory adjustment"}
                  </div>
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 12 }}>{event.accountLabel}</div>
                <div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 58,
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: `1px solid ${event.postingType === "credit" ? "rgba(52, 211, 153, 0.35)" : "rgba(96, 165, 250, 0.35)"}`,
                      background: event.postingType === "credit" ? "rgba(5, 150, 105, 0.12)" : "rgba(37, 99, 235, 0.12)",
                      color: event.postingType === "credit" ? "#86efac" : "#93c5fd",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {event.postingType}
                  </span>
                </div>
                <div style={{ color: "#f8fafc", fontWeight: 700, textAlign: "right" }}>{formatCurrency(event.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
