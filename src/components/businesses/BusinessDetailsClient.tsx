"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Business, BusinessUpgrade } from "@/domains/businesses";
import type { ProductionStatus, ManufacturingStatusView } from "@/domains/production";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { EmployeeAssignment, Employee } from "@/domains/employees";

type TabType = "overview" | "operations" | "employees" | "inventory" | "upgrades";

type Props = {
  business: Business;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  upgrades: BusinessUpgrade[];
  employees: (EmployeeAssignment & { employee: Employee })[];
};

export default function BusinessDetailsClient({ business, production, manufacturing, inventory, upgrades, employees }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignSelections, setAssignSelections] = useState<Record<string, string>>({});
  
  const router = useRouter();

  // Find employees that are assigned to this business as production workers
  // but are not currently assigned to any slot.
  const availableWorkersForSlots = employees
    .filter(e => e.role === "production" && !production?.slots?.some(s => s.employee_id === e.employee_id))
    .map(e => e.employee);

  async function assignSlot(slotId: string) {
    const employeeId = assignSelections[slotId];
    if (!employeeId || busy) return;
    
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/slots/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, employeeId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to assign employee to slot.");
      
      setAssignSelections(prev => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error assigning slot");
    } finally {
      setBusy(false);
    }
  }

  async function unassignSlot(slotId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/slots/unassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to unassign slot.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error unassigning slot");
    } finally {
      setBusy(false);
    }
  }

  async function setSlotStatus(slotId: string, status: "active" | "idle") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/slots/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to set slot status.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error setting slot status");
    } finally {
      setBusy(false);
    }
  }

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
        {error && (
          <div style={{ padding: "12px", marginBottom: "16px", background: "rgba(248, 113, 113, 0.1)", color: "#f87171", borderRadius: "8px", border: "1px solid rgba(248, 113, 113, 0.2)" }}>
            {error}
          </div>
        )}
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
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Inventory Items</div>
                <div>{inventory.length}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Upgrades Installed</div>
                <div>{upgrades.length}</div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "operations" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Operations</h3>
            {production || manufacturing ? (
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Type</span>
                  <div style={{ fontWeight: 600 }}>{production ? "Extraction" : "Manufacturing"}</div>
                </div>

                {production && production.slots && (
                  <div>
                    <h4 style={{ marginBottom: 8, fontSize: "0.9rem" }}>Extraction Slots</h4>
                    {production.slots.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {production.slots.map((slot) => {
                          // Find the assigned employee object directly from the passed props
                          const assignedEmp = employees.find(e => e.employee_id === slot.employee_id)?.employee;
                          
                          return (
                            <div key={slot.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--bg-elevated)", borderRadius: 8, flexWrap: "wrap", gap: 12 }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Slot #{slot.slot_number}</div>
                                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                  Worker: {assignedEmp ? `${assignedEmp.first_name}` : "None"}
                                </div>
                                {!assignedEmp && availableWorkersForSlots.length > 0 && (
                                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                                    <select
                                      title="Select worker"
                                      value={assignSelections[slot.id] || ""}
                                      onChange={(e) => setAssignSelections(prev => ({ ...prev, [slot.id]: e.target.value }))}
                                      style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                    >
                                      <option value="">Select worker...</option>
                                      {availableWorkersForSlots.map(w => (
                                        <option key={w.id} value={w.id}>{w.first_name} {w.last_name}</option>
                                      ))}
                                    </select>
                                    <button 
                                      onClick={() => assignSlot(slot.id)}
                                      disabled={busy || !assignSelections[slot.id]}
                                      style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                    >
                                      Assign
                                    </button>
                                  </div>
                                )}
                                {assignedEmp && (
                                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                                    <button
                                      onClick={() => unassignSlot(slot.id)}
                                      disabled={busy}
                                      style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                    >
                                      Unassign
                                    </button>
                                    {slot.status === "active" ? (
                                      <button
                                        onClick={() => setSlotStatus(slot.id, "idle")}
                                        disabled={busy}
                                        style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                      >
                                        Stop
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => setSlotStatus(slot.id, "active")}
                                        disabled={busy}
                                        style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                      >
                                        Start
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <span className={`status-badge ${slot.status === 'active' ? 'status-producing' : ''}`}>{slot.status}</span>
                                {slot.tool && (
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                                    Tool: {slot.tool.item_type} ({slot.tool.uses_remaining} uses)
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No slots unlocked.</p>
                    )}
                  </div>
                )}

                {manufacturing && manufacturing.job && (
                  <div>
                    <h4 style={{ marginBottom: 8, fontSize: "0.9rem" }}>Manufacturing Job</h4>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--bg-elevated)", borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{manufacturing.job.active_recipe_key ? manufacturing.job.active_recipe_key : "No Recipe Active"}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          Worker Assigned: {manufacturing.job.worker_assigned ? "Yes" : "No"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className={`status-badge ${manufacturing.job.status === 'active' ? 'status-producing' : ''}`}>{manufacturing.job.status}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No operations active.</p>
            )}
          </div>
        )}

        {activeTab === "employees" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Employees</h3>
            {employees && employees.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {employees.map((assignment) => (
                  <div key={assignment.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--bg-primary)", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{assignment.employee.first_name}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
                        {assignment.role === "production" ? "Production Worker" : "Supply Worker"} 
                        {assignment.slot_number ? ` (Slot #${assignment.slot_number})` : ""}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                        Wage: ${assignment.wage_per_hour.toFixed(2)}/hr
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`status-badge ${assignment.employee.status === 'assigned' ? 'status-producing' : ''}`}>
                        {assignment.employee.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No employees assigned to this business.</p>
            )}
          </div>
        )}

        {activeTab === "inventory" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Inventory</h3>
            {inventory.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem" }}>Item</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem" }}>Quality</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Available</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Reserved</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "12px 8px" }}>{item.item_key}</td>
                      <td style={{ padding: "12px 8px" }}>{item.quality}</td>
                      <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 600 }}>{item.quantity - item.reserved_quantity}</td>
                      <td style={{ padding: "12px 8px", textAlign: "right", color: "var(--text-muted)" }}>{item.reserved_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Inventory is empty.</p>
            )}
          </div>
        )}

        {activeTab === "upgrades" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Upgrades</h3>
            {upgrades.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {upgrades.map((upgrade) => (
                  <div key={upgrade.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--bg-primary)", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{upgrade.upgrade_key}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>Level {upgrade.level}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No upgrades installed.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
