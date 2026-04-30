import type { CSSProperties, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`lc-card ${className}`.trim()}>{children}</section>;
}

export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="lc-section-title">
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="lc-metric-grid">{children}</div>;
}

export function MetricCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <article className="lc-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export type StatusBadgeTone = "neutral" | "good" | "bad" | "warn" | "accent" | "positive" | "negative";

const badgeStyles: Record<StatusBadgeTone, CSSProperties> = {
  neutral: { border: "1px solid rgba(96, 165, 250, 0.28)", background: "rgba(96, 165, 250, 0.12)", color: "#bfdbfe" },
  good: { border: "1px solid rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.12)", color: "#86efac" },
  positive: { border: "1px solid rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.12)", color: "#86efac" },
  bad: { border: "1px solid rgba(248, 113, 113, 0.3)", background: "rgba(248, 113, 113, 0.12)", color: "#fca5a5" },
  negative: { border: "1px solid rgba(248, 113, 113, 0.3)", background: "rgba(248, 113, 113, 0.12)", color: "#fca5a5" },
  warn: { border: "1px solid rgba(251, 191, 36, 0.3)", background: "rgba(251, 191, 36, 0.12)", color: "#fcd34d" },
  accent: { border: "1px solid rgba(168, 85, 247, 0.28)", background: "rgba(168, 85, 247, 0.12)", color: "#d8b4fe" },
};

export function StatusBadge({
  children,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  tone?: StatusBadgeTone;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`lc-badge lc-badge-${tone}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...badgeStyles[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function DashboardPanel(props: { title: string; eyebrow?: string; children: ReactNode; style?: CSSProperties }) {
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

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

export function DashboardMetricCard(props: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "accent";
  style?: CSSProperties;
}) {
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
        ...props.style,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800, color }}>{props.value}</div>
      {props.sub ? <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div> : null}
    </div>
  );
}
