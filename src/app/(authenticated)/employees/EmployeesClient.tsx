"use client";

import { EMPLOYEE_TYPES } from "@/config/employees";
import type { Employee, EmployeeRole, EmployeeSummary, EmployeeType } from "@/domains/employees";
import { apiDelete, apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import type { EmployeesPageData } from "@/lib/client/queries";
import { formatNullableDateTime } from "@/lib/formatters";
import { TooltipLabel } from "@/components/ui/tooltip";
import { makeNpcShopperName } from "../../../../shared/core/npc-shopper-names";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useEmployeesSlice, useGameStore } from "@/stores/game-store";
import { detailSyncTarget, syncMutationViews } from "@/stores/mutation-sync";
import { runOptimisticUpdate } from "@/stores/optimistic";

type Business = { id: string; name: string };
type Props = {
  initialData: EmployeesPageData;
};

function makeHireName() {
  const fullName = makeNpcShopperName(Math.random);
  const [firstName, ...rest] = fullName.split(" ");

  return {
    firstName: firstName ?? "Alex",
    lastName: rest.join(" ") || "Smith",
  };
}

export default function EmployeesClient({ initialData }: Props) {
  const employeesSlice = useEmployeesSlice();
  const employees = employeesSlice.employees;
  const patchEmployees = useGameStore((state) => state.patchEmployees);
  const removeEmployee = useGameStore((state) => state.removeEmployee);
  const summary = useMemo<EmployeeSummary>(() => {
    const byStatus = {
      available: 0,
      assigned: 0,
      resting: 0,
      unpaid: 0,
      fired: 0,
    } satisfies EmployeeSummary["byStatus"];
    for (const employee of employees) {
      byStatus[employee.status] += 1;
    }
    return {
      totalEmployees: employees.length,
      byStatus,
      assignedCount: byStatus.assigned,
      availableCount: byStatus.available,
      restingCount: byStatus.resting,
      unpaidCount: byStatus.unpaid,
      firedCount: byStatus.fired,
    };
  }, [employees]);
  const businesses = employeesSlice.businesses as Business[];
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [employeeType, setEmployeeType] = useState<EmployeeType>("temp");
  const [hireBusinessId, setHireBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [specialtySkillKey, setSpecialtySkillKey] = useState("");
  const [hiring, setHiring] = useState(false);
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignBusinessId, setAssignBusinessId] = useState("");
  const [assignRole, setAssignRole] = useState<EmployeeRole>("production");
  const [assigning, setAssigning] = useState(false);

  const manageableEmployees = useMemo(
    () => employees.filter((employee) => employee.status !== "fired"),
    [employees]
  );

  const selectedAssignEmployee = useMemo(
    () => employees.find((employee) => employee.id === assignEmployeeId) ?? null,
    [assignEmployeeId, employees]
  );

  const assignableBusinesses = useMemo(() => {
    if (!selectedAssignEmployee?.employer_business_id) return businesses;
    return businesses.filter((business) => business.id === selectedAssignEmployee.employer_business_id);
  }, [businesses, selectedAssignEmployee]);

  useEffect(() => {
    if (!assignEmployeeId) {
      setAssignBusinessId("");
      return;
    }

    if (assignableBusinesses.length === 1) {
      setAssignBusinessId(assignableBusinesses[0].id);
      return;
    }

    if (!assignableBusinesses.some((business) => business.id === assignBusinessId)) {
      setAssignBusinessId("");
    }
  }, [assignBusinessId, assignEmployeeId, assignableBusinesses]);

  async function submitHire() {
    if (hiring) return;
    setHiring(true);
    setError(null);
    setSuccess(null);
    const { firstName, lastName } = makeHireName();
    const optimisticId = `optimistic-employee-${Date.now()}`;
    try {
      await runOptimisticUpdate("employees", () => {
        patchEmployees({
          id: optimisticId,
          player_id: "",
          employer_business_id: hireBusinessId || null,
          first_name: firstName,
          last_name: lastName,
          employee_type: employeeType,
          status: "available",
          specialty_skill_key:
            employeeType === "specialist" ? ((specialtySkillKey || "logistics") as Employee["specialty_skill_key"]) : null,
          hire_cost: 0,
          wage_per_hour: 0,
          unpaid_wage_due: 0,
          last_wage_charged_at: null,
          shift_ends_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }, async () => {
        const payload = await apiPost<{ employee?: Employee }>(
          apiRoutes.employees.root,
          {
            firstName,
            lastName,
            businessId: hireBusinessId,
            employeeType,
            specialtySkillKey: employeeType === "specialist" ? specialtySkillKey || undefined : undefined,
          },
          { fallbackError: "Failed to hire employee." }
        );
        if (payload.employee) {
          removeEmployee(optimisticId);
          patchEmployees(payload.employee);
        }
        return payload;
      });
      await syncMutationViews({
        businesses: true,
        banking: true,
        employees: true,
        businessDetails: detailSyncTarget(hireBusinessId),
      });
      setSpecialtySkillKey("");
      setSuccess("Employee hired successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to hire employee.");
    } finally {
      setHiring(false);
    }
  }

  async function submitAssign() {
    if (assigning) return;
    setAssigning(true);
    setError(null);
    setSuccess(null);
    try {
      await runOptimisticUpdate("employees", () => {
        patchEmployees({
          id: assignEmployeeId,
          employer_business_id:
            employees.find((employee) => employee.id === assignEmployeeId)?.employer_business_id ?? assignBusinessId,
          status: "assigned",
          updated_at: new Date().toISOString(),
        });
      }, async () => {
        const payload = await apiPost<{ employee?: Employee }>(
          apiRoutes.employees.assign,
          { employeeId: assignEmployeeId, businessId: assignBusinessId, role: assignRole },
          { fallbackError: "Failed to assign employee." }
        );
        if (payload.employee) {
          patchEmployees(payload.employee);
        }
        return payload;
      });
      await syncMutationViews({
        employees: true,
        businessDetails: detailSyncTarget(assignBusinessId),
      });
      setSuccess("Employee assigned successfully.");
      setAssignEmployeeId("");
      setAssignBusinessId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign employee.");
    } finally {
      setAssigning(false);
    }
  }

  async function reactivate(employeeId: string) {
    setError(null);
    setSuccess(null);
    try {
      await runOptimisticUpdate("employees", () => {
        patchEmployees({
          id: employeeId,
          status: "available",
          updated_at: new Date().toISOString(),
        });
      }, async () => {
        const payload = await apiPost<{ employee?: Employee }>(
          apiRoutes.employees.reactivate,
          { employeeId },
          { fallbackError: "Failed to reactivate employee." }
        );
        if (payload.employee) {
          patchEmployees(payload.employee);
        }
        return payload;
      });
      const businessId = employees.find((employee) => employee.id === employeeId)?.employer_business_id ?? null;
      await syncMutationViews({
        employees: true,
        businessDetails: detailSyncTarget(businessId),
      });
      setSuccess("Employee re-activated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate employee.");
    }
  }

  async function unassign(employeeId: string) {
    setError(null);
    setSuccess(null);
    try {
      await runOptimisticUpdate("employees", () => {
        patchEmployees({
          id: employeeId,
          status: "available",
          updated_at: new Date().toISOString(),
        });
      }, async () => {
        const payload = await apiPost<{ employee?: Employee }>(
          apiRoutes.employees.unassign,
          { employeeId },
          { fallbackError: "Failed to unassign employee." }
        );
        if (payload.employee) {
          patchEmployees(payload.employee);
        }
        return payload;
      });
      const businessId = employees.find((employee) => employee.id === employeeId)?.employer_business_id ?? null;
      await syncMutationViews({
        employees: true,
        businessDetails: detailSyncTarget(businessId),
      });
      setSuccess("Employee unassigned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unassign employee.");
    }
  }

  async function fire(employeeId: string) {
    setError(null);
    setSuccess(null);
    try {
      await runOptimisticUpdate("employees", () => {
        patchEmployees({
          id: employeeId,
          status: "fired",
          updated_at: new Date().toISOString(),
        });
      }, async () => {
        const payload = await apiDelete<{ employee?: Employee }>(
          apiRoutes.employees.detail(employeeId),
          undefined,
          { fallbackError: "Failed to fire employee." }
        );
        if (payload.employee) {
          patchEmployees(payload.employee);
        }
        return payload;
      });
      const businessId = employees.find((employee) => employee.id === employeeId)?.employer_business_id ?? null;
      await syncMutationViews({
        businesses: true,
        banking: true,
        employees: true,
        businessDetails: detailSyncTarget(businessId),
      });
      setSuccess("Employee fired.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fire employee.");
    }
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Employees</h1>
          <p>Your crew.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {hiring || assigning ? <p>Updating employees...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      {success ? <p style={{ color: "#34d399" }}>{success}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Employee Summary</h2>
        <p style={{ margin: "6px 0" }}><strong>Total:</strong> {summary?.totalEmployees ?? 0}</p>
        <p style={{ margin: "6px 0" }}><strong>Assigned:</strong> {summary?.assignedCount ?? 0} · <strong>Available:</strong> {summary?.availableCount ?? 0} · <strong>Resting:</strong> {summary?.restingCount ?? 0}</p>
        <p style={{ margin: "6px 0" }}><strong>Unpaid:</strong> {summary?.unpaidCount ?? 0} · <strong>Fired:</strong> {summary?.firedCount ?? 0}</p>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Hire Employee</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <label>
            <TooltipLabel label="Hiring Business" content="The business that will employ and pay this worker." />
            <select value={hireBusinessId} onChange={(event) => setHireBusinessId(event.target.value)}>
              <option value="">Select business</option>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>
          <label>
            <TooltipLabel label="Employee Type" content="Temps are cheaper and shorter-term, while specialists require a skill key and are hired for focused work." />
            <select value={employeeType} onChange={(event) => setEmployeeType(event.target.value as EmployeeType)}>
              {EMPLOYEE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          {employeeType === "specialist" ? (
            <label>
              <TooltipLabel label="Specialty Skill Key" content="The specialist's domain skill, such as `metalworking`, used by systems that check expertise." />
              <input value={specialtySkillKey} onChange={(event) => setSpecialtySkillKey(event.target.value)} placeholder="metalworking" />
            </label>
          ) : null}
          <button onClick={submitHire} disabled={hiring || !hireBusinessId || (employeeType === "specialist" && !specialtySkillKey.trim())}>
            {hiring ? "Hiring..." : "Hire Employee"}
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Assign Employee</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <label>
            <TooltipLabel label="Employee" content="Choose the worker you want to place into an assignment." />
            <select value={assignEmployeeId} onChange={(event) => setAssignEmployeeId(event.target.value)}>
              <option value="">Select employee</option>
              {manageableEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name} ({employee.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            <TooltipLabel label="Business" content="Workers can only be assigned to businesses they are allowed to work for." />
            <select value={assignBusinessId} onChange={(event) => setAssignBusinessId(event.target.value)}>
              <option value="">Select business</option>
              {assignableBusinesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>
          {selectedAssignEmployee?.employer_business_id ? (
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.9rem" }}>
              This employee is tied to one business and can only be assigned there.
            </p>
          ) : null}
          <label>
            <TooltipLabel label="Role" content="Production workers operate lines and slots. Supply workers handle logistics-oriented assignments." />
            <select value={assignRole} onChange={(event) => setAssignRole(event.target.value as EmployeeRole)}>
              <option value="production">production</option>
              <option value="supply">supply</option>
            </select>
          </label>
          <button onClick={submitAssign} disabled={assigning || !assignEmployeeId || !assignBusinessId}>
            {assigning ? "Assigning..." : "Assign Employee"}
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Roster</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {employees.length === 0 ? <p>No employees yet.</p> : null}
          {employees.map((employee) => (
            <div key={employee.id} style={{ border: "1px solid #334155", borderRadius: 8, padding: 12 }}>
              <p style={{ margin: 0, fontWeight: 700 }}>{employee.first_name} {employee.last_name}</p>
              <p style={{ margin: "6px 0", color: "#94a3b8" }}>
                {employee.employee_type} · {employee.status}
                {employee.specialty_skill_key ? ` · specialty: ${employee.specialty_skill_key}` : ""}
              </p>
              <p style={{ margin: "6px 0", color: "#94a3b8" }}>Shift Ends: {formatNullableDateTime(employee.shift_ends_at)}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => reactivate(employee.id)} disabled={employee.status === "fired"}>Re-Activate</button>
                <button onClick={() => unassign(employee.id)} disabled={employee.status === "fired"}>Unassign</button>
                <button onClick={() => fire(employee.id)}>Fire</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
