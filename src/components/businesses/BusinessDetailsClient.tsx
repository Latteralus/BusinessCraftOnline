"use client";

import { useState, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { Business, BusinessUpgrade } from "@/domains/businesses";
import type { ProductionStatus, ManufacturingStatusView } from "@/domains/production";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { EmployeeAssignment, Employee } from "@/domains/employees";
import { getWorkerEffectiveStatus } from "@/domains/employees/worker-state";
import type { UpgradeDefinition } from "@/domains/upgrades";
import { calculateUpgradePreview } from "@/domains/upgrades";
import { BASE_WAGE_PER_HOUR } from "@/config/employees";
import { formatItemKey } from "@/lib/items";

type TabType = "overview" | "finance" | "operations" | "employees" | "inventory" | "upgrades";

type Props = {
  business: Business;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  upgrades: BusinessUpgrade[];
  employees: (Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] })[];
  upgradeDefinitions?: UpgradeDefinition[];
  financeSummary?: { balance: number; totalValueOnMarket: number; itemsSold24h: number; revenue24h: number } | null;
  initialTab?: string;
};

const FIRST_NAMES = [
  "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph",
  "Thomas", "Charles", "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth",
  "Barbara", "Susan", "Jessica", "Sarah", "Karen", "Oliver", "Noah", "Elijah",
  "Lucas", "Mason", "Harper", "Evelyn", "Abigail", "Emily", "Ella",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
];

function toTitleLabel(value: string) {
  return value
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function formatEmployeeType(type: string) {
  if (type === "part_time") return "Part-Time";
  if (type === "full_time") return "Full-Time";
  return toTitleLabel(type);
}

export default function BusinessDetailsClient({ business, production, manufacturing, inventory, upgrades, employees, upgradeDefinitions = [], financeSummary, initialTab }: Props) {
  const router = useRouter();
  const tempPayPer15Min = (BASE_WAGE_PER_HOUR.temp / 4).toFixed(2);
  const partTimePayPer15Min = (BASE_WAGE_PER_HOUR.part_time / 4).toFixed(2);
  const fullTimePayPer15Min = (BASE_WAGE_PER_HOUR.full_time / 4).toFixed(2);
  
  const defaultTab = (initialTab as TabType) || "overview";
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignSelections, setAssignSelections] = useState<Record<string, string>>({});
  const [businessAssignEmployeeId, setBusinessAssignEmployeeId] = useState("");
  const [marketActionItem, setMarketActionItem] = useState<{ id: string; type: "market" | "transfer"; available: number } | null>(null);
  const [actionQuantity, setActionQuantity] = useState(1);
  const [actionPrice, setActionPrice] = useState(1);

  useAutoRefresh(() => {
    router.refresh();
  }, { intervalMs: 8000, enabled: !busy });

  useEffect(() => {
    if (initialTab && ["overview", "finance", "operations", "employees", "inventory", "upgrades"].includes(initialTab)) {
      setActiveTab(initialTab as TabType);
    }
  }, [initialTab]);

  const getAssignments = (
    employee: Employee & {
      employee_assignments?: (EmployeeAssignment & { business: Business })[] | (EmployeeAssignment & { business: Business }) | null;
    }
  ): (EmployeeAssignment & { business: Business })[] => {
    const raw = employee.employee_assignments;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return [raw];
    return [];
  };

  const getAssignmentForBusiness = (
    employee: Employee & {
      employee_assignments?: (EmployeeAssignment & { business: Business })[] | (EmployeeAssignment & { business: Business }) | null;
    }
  ) => getAssignments(employee).find((assignment) => assignment.business_id === business.id);

  // Employees tied to this business either by active assignment row or employer business ownership.
  const thisBusinessEmployees = employees.filter(
    (employee) =>
      Boolean(getAssignmentForBusiness(employee)) || employee.employer_business_id === business.id
  );
  const availableEmployees = employees.filter(e => e.status === "available");
  const availableWorkersForSlots = thisBusinessEmployees
    .filter((employee) => {
      const assignment = getAssignmentForBusiness(employee);
      const effectiveStatus = getWorkerEffectiveStatus(employee.status, employee.shift_ends_at);
      return (
        assignment?.role === "production" &&
        effectiveStatus === "assigned" &&
        !production?.slots?.some((slot) => slot.employee_id === employee.id)
      );
    });

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

  async function purchaseUpgrade(upgradeKey: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/businesses/${business.id}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upgradeKey }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to purchase upgrade.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error purchasing upgrade");
    } finally {
      setBusy(false);
    }
  }

  async function hireEmployee(employeeType: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const randomFirstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const randomLastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: randomFirstName,
          lastName: randomLastName,
          businessId: business.id,
          employeeType,
          specialtySkillKey: employeeType === "specialist" ? "logistics" : undefined,
        }),
      });
      if (!res.ok) {
        let message = "Failed to hire employee.";
        try {
          const payload = await res.json();
          if (payload?.error) message = payload.error;
        } catch {
          // Ignore parse errors and use fallback message.
        }
        throw new Error(message);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error hiring employee");
    } finally {
      setBusy(false);
    }
  }

  async function fireEmployee(employeeId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        let message = "Failed to fire employee.";
        try {
          const payload = await res.json();
          if (payload?.error) message = payload.error;
        } catch {
          // Ignore parse errors and use fallback message.
        }
        throw new Error(message);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error firing employee");
    } finally {
      setBusy(false);
    }
  }

  async function unassignEmployeeGlobal(employeeId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/employees/unassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to unassign employee.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error unassigning employee");
    } finally {
      setBusy(false);
    }
  }

  async function assignEmployeeToThisBusiness(employeeId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/employees/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          businessId: business.id,
          role: "production",
          roleSkillKey: "logistics"
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to assign employee.");

      if (production?.slots?.length) {
        const firstOpenSlot = production.slots.find((slot) => !slot.employee_id);
        if (firstOpenSlot) {
          const slotRes = await fetch("/api/production/slots/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slotId: firstOpenSlot.id, employeeId }),
          });
          if (!slotRes.ok) {
            let slotMessage = "Employee assigned to business, but slot assignment failed.";
            try {
              const payload = await slotRes.json();
              if (payload?.error) slotMessage = `Employee assigned to business, but slot assignment failed: ${payload.error}`;
            } catch {
              // Ignore parse errors and use fallback message.
            }
            setError(slotMessage);
          }
        }
      }

      if (employeeId === businessAssignEmployeeId) {
        setBusinessAssignEmployeeId("");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error assigning employee");
    } finally {
      setBusy(false);
    }
  }

  async function handleActionSubmit(item: BusinessInventoryItem) {
    if (!marketActionItem || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (marketActionItem.type === "market") {
        const res = await fetch("/api/market", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceBusinessId: business.id,
            itemKey: item.item_key,
            quality: item.quality,
            quantity: actionQuantity,
            unitPrice: actionPrice,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to create market listing.");
      } else if (marketActionItem.type === "transfer") {
        const res = await fetch("/api/inventory/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: "business",
            sourceBusinessId: business.id,
            destinationType: "personal",
            itemKey: item.item_key,
            quality: item.quality,
            quantity: actionQuantity,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to transfer item.");
      }
      setMarketActionItem(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error performing action");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card anim" style={{ marginTop: 24 }}>
      <div className="card-header" style={{ padding: 0, borderBottom: "1px solid var(--border-subtle)", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 24, padding: "0 24px" }}>
          {(["overview", "finance", "operations", "employees", "inventory", "upgrades"] as TabType[]).map((tab) => (
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

        {activeTab === "finance" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Finance Overview</h3>
            {financeSummary ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Bank Balance</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 600, color: financeSummary.balance >= 0 ? "var(--text-primary)" : "#f87171" }}>
                    ${financeSummary.balance.toFixed(2)}
                  </div>
                </div>
                <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Revenue (24h)</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 500, color: "var(--accent-green)" }}>
                    +${financeSummary.revenue24h.toFixed(2)}
                  </div>
                </div>
                <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Items Sold (24h)</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 500 }}>
                    {financeSummary.itemsSold24h}
                  </div>
                </div>
                <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Active Listings Value</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 500 }}>
                    ${financeSummary.totalValueOnMarket.toFixed(2)}
                  </div>
                </div>
              </div>
            ) : (
              <p>Loading finance data...</p>
            )}
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

                  <div style={{ marginBottom: 12, padding: 12, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: 8 }}>Assign Employee to This Business</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select
                        title="Select employee"
                        value={businessAssignEmployeeId}
                        onChange={(e) => setBusinessAssignEmployeeId(e.target.value)}
                        style={{ fontSize: "0.75rem", padding: "4px 8px", minWidth: 180 }}
                      >
                        <option value="">Select available employee...</option>
                        {availableEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.first_name} {employee.last_name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => assignEmployeeToThisBusiness(businessAssignEmployeeId)}
                        disabled={busy || !businessAssignEmployeeId}
                        style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                      >
                        Assign
                      </button>
                    </div>
                  </div>
	
	                {production && production.slots && (
	                  <div>
	                    <h4 style={{ marginBottom: 8, fontSize: "0.9rem" }}>Extraction Slots</h4>
                    {production.slots.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {production.slots.map((slot) => {
                          // Find the assigned employee object directly from the passed props
                          const assignedEmp = employees.find(e => e.id === slot.employee_id);
                          
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
                                    Tool: {formatItemKey(slot.tool.item_type)} ({slot.tool.uses_remaining} uses)
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Employees</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => hireEmployee("temp")} disabled={busy} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>Hire Temp ($0 · ${tempPayPer15Min}/15m)</button>
                <button onClick={() => hireEmployee("part_time")} disabled={busy} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>Hire Part Time ($200 · ${partTimePayPer15Min}/15m)</button>
                <button onClick={() => hireEmployee("full_time")} disabled={busy} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>Hire Full Time ($500 · ${fullTimePayPer15Min}/15m)</button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Employees</div>
                <div>{employees.length}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Assigned to This Business</div>
                <div>{thisBusinessEmployees.length}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Wages Per Tick</div>
                <div>${employees.reduce((sum, employee) => sum + (employee.wage_per_hour || 0), 0).toFixed(2)}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>This Business Wages Per Tick</div>
                <div>
                  $
                  {thisBusinessEmployees
                    .reduce((sum, employee) => sum + (getAssignmentForBusiness(employee)?.wage_per_hour ?? employee.wage_per_hour ?? 0), 0)
                    .toFixed(2)}
                </div>
              </div>
            </div>

            {employees && employees.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {employees.map((e) => {
                  const assignment = getAssignmentForBusiness(e) ?? getAssignments(e)[0];
                  return (
                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--bg-primary)", borderRadius: 8, flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.first_name} {e.last_name}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
                          {formatEmployeeType(e.employee_type)} • {toTitleLabel(e.status)}
                        </div>
                        {assignment && (
                          <div style={{ fontSize: "0.8rem", color: "var(--accent-blue)", marginTop: 4 }}>
                            Working at: {assignment.business?.name || "Unknown Business"} ({assignment.role}) {assignment.slot_number ? ` (Slot #${assignment.slot_number})` : ""}
                          </div>
                        )}
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                          Wage: ${(assignment?.wage_per_hour ?? BASE_WAGE_PER_HOUR[e.employee_type]).toFixed(2)}/hr
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {assignment && (
                          <button onClick={() => unassignEmployeeGlobal(e.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>Unassign</button>
                        )}
                        <button onClick={() => fireEmployee(e.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "rgba(248, 113, 113, 0.1)", color: "#f87171", border: "1px solid rgba(248, 113, 113, 0.2)" }}>Fire</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No employees.</p>
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
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => {
                    const available = item.quantity - item.reserved_quantity;
                    const isActionRow = marketActionItem?.id === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr style={{ borderBottom: isActionRow ? "none" : "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "12px 8px" }}>{formatItemKey(item.item_key)}</td>
                          <td style={{ padding: "12px 8px" }}>{item.quality}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 600 }}>{available}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right", color: "var(--text-muted)" }}>{item.reserved_quantity}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right" }}>
                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <button
                                onClick={() => { setMarketActionItem({ id: item.id, type: "market", available }); setActionQuantity(1); setActionPrice(1); }}
                                disabled={busy || available <= 0}
                                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                              >
                                Market
                              </button>
                              <button
                                onClick={() => { setMarketActionItem({ id: item.id, type: "transfer", available }); setActionQuantity(1); }}
                                disabled={busy || available <= 0}
                                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                              >
                                Transfer
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isActionRow && (
                          <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                            <td colSpan={5} style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                                  {marketActionItem.type === "market" ? "List on Market:" : "Transfer to Personal:"}
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Qty:</label>
                                  <input 
                                    type="number" 
                                    title="Quantity"
                                    min={1} 
                                    max={available} 
                                    value={actionQuantity} 
                                    onChange={(e) => setActionQuantity(Math.min(available, Math.max(1, parseInt(e.target.value) || 1)))} 
                                    style={{ width: 60, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }} 
                                  />
                                </div>
                                {marketActionItem.type === "market" && (
                                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Unit Price ($):</label>
                                    <input 
                                      type="number" 
                                      title="Unit Price"
                                      min={0.01} 
                                      step={0.01} 
                                      value={actionPrice} 
                                      onChange={(e) => setActionPrice(Math.max(0.01, parseFloat(e.target.value) || 0.01))} 
                                      style={{ width: 80, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }} 
                                    />
                                  </div>
                                )}
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button onClick={() => setMarketActionItem(null)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>Cancel</button>
                                  <button onClick={() => handleActionSubmit(item)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "var(--accent-blue)", color: "white", border: "none" }}>Confirm</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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
            {upgradeDefinitions.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {upgradeDefinitions.map((def) => {
                  const currentUpgrade = upgrades.find(u => u.upgrade_key === def.upgrade_key);
                  const currentLevel = currentUpgrade?.level || 0;
                  const preview = calculateUpgradePreview(def, { upgradeKey: def.upgrade_key, currentLevel });
                  
                  const isMaxed = !def.is_infinite && def.max_level !== null && currentLevel >= def.max_level;

                  return (
                    <div key={def.upgrade_key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, background: "var(--bg-primary)", borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "1.05rem", marginBottom: 4 }}>{def.display_name}</div>
                        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 8 }}>{def.description}</div>
                        <div style={{ display: "flex", gap: 16, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          <span><strong>Level:</strong> {currentLevel} {def.max_level ? `/ ${def.max_level}` : ""}</span>
                          {!isMaxed && <span><strong>Next Cost:</strong> ${preview.nextCost.toFixed(2)}</span>}
                          <span>
                            <strong>Effect:</strong> {def.effect_label} (+{Math.round((preview.currentEffect - 1) * 100)}% {isMaxed ? "" : `→ +${Math.round((preview.nextEffect - 1) * 100)}%`})
                          </span>
                        </div>
                      </div>
                      <div>
                        {!isMaxed && (
                          <button
                            onClick={() => purchaseUpgrade(def.upgrade_key)}
                            disabled={busy}
                            style={{ padding: "8px 16px", fontWeight: 600 }}
                          >
                            Upgrade
                          </button>
                        )}
                        {isMaxed && (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontWeight: 600 }}>Max Level</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No upgrades available for this business.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
