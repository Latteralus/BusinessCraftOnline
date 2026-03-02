import type { ReactNode } from "react";

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

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" }) {
  return <span className={`lc-badge lc-badge-${tone}`}>{children}</span>;
}

