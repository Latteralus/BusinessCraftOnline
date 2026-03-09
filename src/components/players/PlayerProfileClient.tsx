"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { PlayerProfilePreview, PublicPlayerBusiness } from "@/domains/auth-character";
import { formatCurrency, formatDateTime, formatLabel } from "@/lib/formatters";

type TabType = "overview" | "businesses" | "details";

type Props = {
  profile: PlayerProfilePreview;
  businesses: PublicPlayerBusiness[];
  initialTab?: string;
  isCurrentPlayer: boolean;
};

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  const toneColor =
    tone === "good"
      ? "#86efac"
      : tone === "warn"
        ? "#fca5a5"
        : "var(--text-primary)";

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        background: "var(--bg-primary)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          fontSize: "0.72rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 700, color: toneColor }}>{value}</div>
    </div>
  );
}

export default function PlayerProfileClient({
  profile,
  businesses,
  initialTab,
  isCurrentPlayer,
}: Props) {
  const router = useRouter();
  const defaultTab = (initialTab as TabType) || "overview";
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);

  useAutoRefresh(() => {
    router.refresh();
  }, { intervalMs: 30_000, enabled: true });

  useEffect(() => {
    if (initialTab && ["overview", "businesses", "details"].includes(initialTab)) {
      setActiveTab(initialTab as TabType);
    }
  }, [initialTab]);

  return (
    <div className="card anim" style={{ marginTop: 24 }}>
      <div
        className="card-header"
        style={{ padding: 0, borderBottom: "1px solid var(--border-subtle)", overflowX: "auto" }}
      >
        <div style={{ display: "flex", gap: 24, padding: "0 24px" }}>
          {(["overview", "businesses", "details"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "transparent",
                border: "none",
                padding: "16px 0",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: activeTab === tab ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: activeTab === tab ? "2px solid var(--accent-blue)" : "2px solid transparent",
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "color 0.2s, border-color 0.2s",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body" style={{ minHeight: 320 }}>
        {activeTab === "overview" ? (
          <div style={{ display: "grid", gap: 20 }}>
            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <StatCard label="Net Worth" value={formatCurrency(profile.net_worth)} tone="good" />
              <StatCard label="Location" value={profile.current_city_name ?? "Unknown"} />
              <StatCard label="Business Level" value={`Lv. ${profile.business_level}`} />
              <StatCard label="Owned Businesses" value={String(profile.total_businesses)} />
            </div>

            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              }}
            >
              <div style={{ padding: 18, borderRadius: 12, background: "var(--bg-primary)" }}>
                <h3 style={{ marginTop: 0, marginBottom: 14 }}>Character</h3>
                <div style={{ display: "grid", gap: 10, color: "var(--text-secondary)" }}>
                  <div><strong style={{ color: "var(--text-primary)" }}>Name:</strong> {profile.character_name}</div>
                  <div><strong style={{ color: "var(--text-primary)" }}>Username:</strong> @{profile.username}</div>
                  <div><strong style={{ color: "var(--text-primary)" }}>Joined:</strong> {formatDateTime(profile.joined_at)}</div>
                  <div>
                    <strong style={{ color: "var(--text-primary)" }}>Status:</strong>{" "}
                    {profile.is_online ? "Online now" : profile.last_seen_at ? `Last seen ${formatDateTime(profile.last_seen_at)}` : "Offline"}
                  </div>
                </div>
              </div>

              <div style={{ padding: 18, borderRadius: 12, background: "var(--bg-primary)" }}>
                <h3 style={{ marginTop: 0, marginBottom: 14 }}>Public Snapshot</h3>
                <div style={{ display: "grid", gap: 10, color: "var(--text-secondary)" }}>
                  <div><strong style={{ color: "var(--text-primary)" }}>Estimated Net Worth:</strong> {formatCurrency(profile.net_worth)}</div>
                  <div><strong style={{ color: "var(--text-primary)" }}>Known Business Holdings:</strong> {profile.total_businesses}</div>
                  <div><strong style={{ color: "var(--text-primary)" }}>Current Base:</strong> {profile.current_city_name ?? "Unknown"}</div>
                  <div><strong style={{ color: "var(--text-primary)" }}>Profile Type:</strong> Public operator profile</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "businesses" ? (
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Owned Businesses</h3>
            {businesses.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {businesses.map((business) => {
                  const inner = (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 16,
                        padding: 18,
                        borderRadius: 12,
                        background: "var(--bg-primary)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "1rem", fontWeight: 700 }}>{business.name}</div>
                        <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: "0.92rem" }}>
                          {formatLabel(business.type)} • {business.city_name ?? "Unknown City"} • {formatLabel(business.entity_type)}
                        </div>
                        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: "0.82rem" }}>
                          Founded {formatDateTime(business.created_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                        Public listing
                      </div>
                    </div>
                  );

                  return isCurrentPlayer ? (
                    <Link
                      key={business.business_id}
                      href={`/businesses/${business.business_id}`}
                      prefetch={false}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={business.business_id}>{inner}</div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", marginBottom: 0 }}>No businesses on record.</p>
            )}
          </div>
        ) : null}

        {activeTab === "details" ? (
          <div style={{ display: "grid", gap: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>Public Details</h3>
            {[
              { label: "Estimated Net Worth", value: formatCurrency(profile.net_worth) },
              { label: "Business Level", value: `Lv. ${profile.business_level}` },
              { label: "Owned Businesses", value: String(profile.total_businesses) },
              { label: "Current Location", value: profile.current_city_name ?? "Unknown" },
              { label: "Joined", value: formatDateTime(profile.joined_at) },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{item.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
