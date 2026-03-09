"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EMPLOYEE_TYPES } from "@/config/employees";
import type { Employee, EmployeeRole, EmployeeSummary, EmployeeType } from "@/domains/employees";
import { apiDelete, apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { fetchEmployeesPageData, queryKeys, type EmployeesPageData } from "@/lib/client/queries";
import { formatNullableDateTime } from "@/lib/formatters";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Business = { id: string; name: string };
type Props = {
  initialData: EmployeesPageData;
};

const FIRST_NAMES = ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles", "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen", "Oliver", "Noah", "Elijah", "Lucas", "Mason", "Harper", "Evelyn", "Abigail", "Emily", "Ella"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson"];

export default function EmployeesClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const employeesPageQuery = useQuery({
    queryKey: queryKeys.employeesPage,
    queryFn: fetchEmployeesPageData,
    initialData,
  });
  const employees = employeesPageQuery.data.employees;
  const summary = employeesPageQuery.data.summary;
  const businesses = employeesPageQuery.data.businesses as Business[];
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

  async function refreshEmployeesData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.employeesPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.businessesPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.productionPage }),
    ]);
  }

  async function submitHire() {
    if (hiring) return;
    setHiring(true);
    setError(null);
    setSuccess(null);
    const randomFirstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const randomLastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    try {
      await apiPost(
        apiRoutes.employees.root,
        {
          firstName: randomFirstName,
          lastName: randomLastName,
          businessId: hireBusinessId,
          employeeType,
          specialtySkillKey: employeeType === "specialist" ? specialtySkillKey || undefined : undefined,
        },
        { fallbackError: "Failed to hire employee." }
      );
      setSpecialtySkillKey("");
      setSuccess("Employee hired successfully.");
      await refreshEmployeesData();
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
      await apiPost(
        apiRoutes.employees.assign,
        { employeeId: assignEmployeeId, businessId: assignBusinessId, role: assignRole },
        { fallbackError: "Failed to assign employee." }
      );
      setSuccess("Employee assigned successfully.");
      setAssignEmployeeId("");
      setAssignBusinessId("");
      await refreshEmployeesData();
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
      await apiPost(apiRoutes.employees.reactivate, { employeeId }, { fallbackError: "Failed to reactivate employee." });
      setSuccess("Employee re-activated.");
      await refreshEmployeesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reactivate employee.");
    }
  }

  async function unassign(employeeId: string) {
    setError(null);
    setSuccess(null);
    try {
      await apiPost(apiRoutes.employees.unassign, { employeeId }, { fallbackError: "Failed to unassign employee." });
      setSuccess("Employee unassigned.");
      await refreshEmployeesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unassign employee.");
    }
  }

  async function fire(employeeId: string) {
    setError(null);
    setSuccess(null);
    try {
      await apiDelete(apiRoutes.employees.detail(employeeId), undefined, { fallbackError: "Failed to fire employee." });
      setSuccess("Employee fired.");
      await refreshEmployeesData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fire employee.");
    }
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Employees</h1>
          <p>Hire, assign, re-activate, and manage worker availability.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {employeesPageQuery.isFetching ? <p>Refreshing employees...</p> : null}
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
            Hiring Business
            <select value={hireBusinessId} onChange={(event) => setHireBusinessId(event.target.value)}>
              <option value="">Select business</option>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>
          <label>
            Employee Type
            <select value={employeeType} onChange={(event) => setEmployeeType(event.target.value as EmployeeType)}>
              {EMPLOYEE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          {employeeType === "specialist" ? (
            <label>
              Specialty Skill Key
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
            Employee
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
            Business
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
            Role
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
