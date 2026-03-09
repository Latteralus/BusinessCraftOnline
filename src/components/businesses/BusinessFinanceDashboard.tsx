"use client";

import { FINANCE_PERIODS, type FinancePeriod } from "@/config/finance";
import type { BusinessFinanceDashboard } from "@/domains/businesses";
import { formatCurrency } from "@/lib/formatters";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

type Props = {
  financeDashboard: BusinessFinanceDashboard | null;
  initialPeriod?: FinancePeriod;
};

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function MiniStat(props: { label: string; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
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

function LineChart(props: {
  title: string;
  series: Array<{ label: string; value: number; color: string }>;
  points: Array<Record<string, number | string>>;
}) {
  const width = 520;
  const height = 180;
  const pad = 18;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;
  const values = props.points.flatMap((point) => props.series.map((serie) => Number(point[serie.label] ?? 0)));
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;

  const paths = props.series.map((serie) => {
    const d = props.points
      .map((point, index) => {
        const x = pad + (props.points.length <= 1 ? chartW / 2 : (index / (props.points.length - 1)) * chartW);
        const y = pad + chartH - ((Number(point[serie.label] ?? 0) - min) / range) * chartH;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
    return { ...serie, d };
  });

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
          <path key={serie.label} d={serie.d} fill="none" stroke={serie.color} strokeWidth="3" strokeLinecap="round" />
        ))}
        {props.points.map((point, index) => {
          const x = pad + (props.points.length <= 1 ? chartW / 2 : (index / (props.points.length - 1)) * chartW);
          return (
            <text key={String(point.label)} x={x} y={height - 2} textAnchor="middle" fill="rgba(148,163,184,0.8)" fontSize="10">
              {String(point.label)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function BusinessFinanceDashboardPanel({ financeDashboard, initialPeriod }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedPeriod, setSelectedPeriod] = useState<FinancePeriod>(
    initialPeriod ?? financeDashboard?.currentPeriod ?? "30d"
  );

  const snapshot = financeDashboard?.periods[selectedPeriod];
  const changeFromPrevious = financeDashboard
    ? financeDashboard.valuation.currentValue - financeDashboard.valuation.previousValue
    : 0;

  const updatePeriod = (nextPeriod: FinancePeriod) => {
    setSelectedPeriod(nextPeriod);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("period", nextPeriod);
    nextParams.set("tab", "finance");
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FINANCE_PERIODS.map((period) => (
              <button
                key={period}
                onClick={() => updatePeriod(period)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: selectedPeriod === period ? "1px solid rgba(96,165,250,0.6)" : "1px solid rgba(148,163,184,0.16)",
                  background: selectedPeriod === period ? "rgba(37, 99, 235, 0.18)" : "rgba(15, 23, 42, 0.65)",
                  color: selectedPeriod === period ? "#dbeafe" : "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {period}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <MiniStat label="Cash" value={formatCurrency(snapshot.kpis.cash)} />
          <MiniStat label="Revenue" value={formatCurrency(snapshot.kpis.revenue)} tone="positive" />
          <MiniStat label="Gross Margin" value={snapshot.kpis.grossMargin === null ? "N/A" : `${snapshot.kpis.grossMargin.toFixed(1)}%`} sub={formatCurrency(snapshot.kpis.grossProfit)} tone={snapshot.kpis.grossProfit >= 0 ? "positive" : "negative"} />
          <MiniStat label="Owner Equity" value={formatCurrency(snapshot.kpis.ownerEquity)} />
          <MiniStat label="Inventory Asset" value={formatCurrency(snapshot.kpis.inventoryAssetValue)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr)", gap: 18 }}>
        <LineChart title="Revenue / COGS / Gross Profit" series={chartSeries} points={snapshot.series} />
        <LineChart title="Cash Balance" series={cashSeries} points={snapshot.series} />
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
            { label: "Owner Contributions", amount: financeDashboard.capital.ownerContributions },
            { label: "Owner Draws", amount: -financeDashboard.capital.ownerDraws },
            { label: "Intercompany Inflows", amount: financeDashboard.capital.intercompanyInflows },
            { label: "Intercompany Outflows", amount: -financeDashboard.capital.intercompanyOutflows },
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
        <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
          Activity Tape
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {snapshot.recentEvents.map((event) => (
            <div
              key={event.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 12,
                alignItems: "center",
                borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
                paddingBottom: 8,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{new Date(event.occurredAt).toLocaleString()}</div>
              <div>
                <div style={{ color: "#e2e8f0" }}>{event.label}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{event.source} · {event.accountCode}</div>
              </div>
              <div style={{ color: event.amount >= 0 ? "#86efac" : "#fca5a5", fontWeight: 700 }}>{formatSignedCurrency(event.amount)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
