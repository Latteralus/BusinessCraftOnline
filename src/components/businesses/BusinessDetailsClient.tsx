"use client";

import { useState } from "react";
import type { Business } from "@/domains/businesses";

type TabType = "overview" | "operations" | "employees" | "inventory" | "upgrades";

export default function BusinessDetailsClient({ business }: { business: Business }) {
  const [activeTab, setActiveTab] = useState<TabType>("overview");

  return (
    <div className="card anim" style={{ marginTop: 24 }}>
      <div className="card-header" style={{ padding: 0, borderBottom: "1px solid var(--border-subtle)", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 24, padding: "0 24px" }}>
          {(["overview", "operations", "employees", "inventory", "upgrades"] as TabType[]).map((tab) => (
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
                transition: "color 0.2s, border-color 0.2s"
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body" style={{ minHeight: 400 }}>
        {activeTab === "overview" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Business Overview</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Entity Type</div>
                <div>{business.entity_type.replace(/_/g, " ")}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Valuation</div>
                <div>${business.value.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "operations" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Operations</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Production data goes here.</p>
          </div>
        )}

        {activeTab === "employees" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Employees</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Employee assignment data goes here.</p>
          </div>
        )}

        {activeTab === "inventory" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Inventory</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Business inventory goes here.</p>
          </div>
        )}

        {activeTab === "upgrades" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Upgrades</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Business upgrades go here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
