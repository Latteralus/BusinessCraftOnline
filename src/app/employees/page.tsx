"use client";

import { EMPLOYEE_TYPES } from "@/config/employees";
import type {
  Employee,
  EmployeeRole,
  EmployeeSummary,
  EmployeeType,
} from "@/domains/employees";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type EmployeesResponse = {
  employees: Employee[];
  summary: EmployeeSummary;
  error?: string;
};

type Business = {
  id: string;
  name: string;
};

type BusinessesResponse = {
  businesses: Business[];
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<EmployeeSummary | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [employeeType, setEmployeeType] = useState<EmployeeType>("temp");
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

  async function loadData() {
    setLoading(true);
    setError(null);

    const [employeesRes, businessesRes] = await Promise.all([
      fetch("/api/employees", { cache: "no-store" }),
      fetch("/api/businesses", { cache: "no-store" }),
    ]);

    const employeesJson = (await employeesRes.json()) as EmployeesResponse;
    const businessesJson = (await businessesRes.json()) as BusinessesResponse;

    if (!employeesRes.ok) {
      setError(employeesJson.error ?? "Failed to fetch employees.");
      setLoading(false);
      return;
    }

    if (!businessesRes.ok) {
      setError(businessesJson.error ?? "Failed to fetch businesses.");
      setLoading(false);
      return;
    }

    setEmployees(employeesJson.employees ?? []);
    setSummary(employeesJson.summary ?? null);
    setBusinesses((businessesJson.businesses ?? []).map((business) => ({ id: business.id, name: business.name })));
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function submitHire() {
    if (hiring) return;
    setHiring(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        employeeType,
        specialtySkillKey: employeeType === "specialist" ? specialtySkillKey || undefined : undefined,
      }),
    });

    const data = (await response.json()) as { error?: string };
    setHiring(false);

    if (!response.ok) {
      setError(data.error ?? "Failed to hire employee.");
      return;
    }

    setFirstName("");
    setLastName("");
    setSpecialtySkillKey("");
    setSuccess("Employee hired successfully.");
    await loadData();
  }

  async function submitAssign() {
    if (assigning) return;
    setAssigning(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/employees/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: assignEmployeeId,
        businessId: assignBusinessId,
        role: assignRole,
      }),
    });

    const data = (await response.json()) as { error?: string };
    setAssigning(false);

    if (!response.ok) {
      setError(data.error ?? "Failed to assign employee.");
      return;
    }

    setSuccess("Employee assigned successfully.");
    await loadData();
  }

  async function reactivate(employeeId: string) {
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/employees/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to reactivate employee.");
      return;
    }

    setSuccess("Employee re-activated.");
    await loadData();
  }

  async function unassign(employeeId: string) {
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/employees/unassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to unassign employee.");
      return;
    }

    setSuccess("Employee unassigned.");
    await loadData();
  }

  async function fire(employeeId: string) {
    setError(null);
    setSuccess(null);

    const response = await fetch(`/api/employees/${employeeId}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to fire employee.");
      return;
    }

    setSuccess("Employee fired.");
    await loadData();
  }

  return (
    <main>
      <header className="lc-page-header">
        <div>
          <h1>Employees</h1>
          <p>
            Hire, assign, re-activate, and manage worker availability.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading employees...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      {success ? <p style={{ color: "#34d399" }}>{success}</p> : null}

      {!loading ? (
        <>
          <section>
            <h2 style={{ marginTop: 0 }}>Employee Summary</h2>
            <p style={{ margin: "6px 0" }}>
              <strong>Total:</strong> {summary?.totalEmployees ?? 0}
            </p>
            <p style={{ margin: "6px 0" }}>
              <strong>Assigned:</strong> {summary?.assignedCount ?? 0} · <strong>Available:</strong>{" "}
              {summary?.availableCount ?? 0} · <strong>Resting:</strong> {summary?.restingCount ?? 0}
            </p>
            <p style={{ margin: "6px 0" }}>
              <strong>Unpaid:</strong> {summary?.unpaidCount ?? 0} · <strong>Fired:</strong>{" "}
              {summary?.firedCount ?? 0}
            </p>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Hire Employee</h2>
            <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <label>
                First Name
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              </label>

              <label>
                Last Name
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </label>

              <label>
                Employee Type
                <select
                  value={employeeType}
                  onChange={(event) => setEmployeeType(event.target.value as EmployeeType)}
                >
                  {EMPLOYEE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              {employeeType === "specialist" ? (
                <label>
                  Specialty Skill Key
                  <input
                    value={specialtySkillKey}
                    onChange={(event) => setSpecialtySkillKey(event.target.value)}
                    placeholder="metalworking"
                  />
                </label>
              ) : null}

              <button
                onClick={submitHire}
                disabled={
                  hiring ||
                  !firstName.trim() ||
                  !lastName.trim() ||
                  (employeeType === "specialist" && !specialtySkillKey.trim())
                }
              >
                {hiring ? "Hiring..." : "Hire Employee"}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Assign Employee</h2>
            <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <label>
                Employee
                <select
                  value={assignEmployeeId}
                  onChange={(event) => setAssignEmployeeId(event.target.value)}
                >
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
                <select
                  value={assignBusinessId}
                  onChange={(event) => setAssignBusinessId(event.target.value)}
                >
                  <option value="">Select business</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Role
                <select
                  value={assignRole}
                  onChange={(event) => setAssignRole(event.target.value as EmployeeRole)}
                >
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
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    {employee.first_name} {employee.last_name}
                  </p>
                  <p style={{ margin: "6px 0", color: "#94a3b8" }}>
                    {employee.employee_type} · {employee.status}
                    {employee.specialty_skill_key ? ` · specialty: ${employee.specialty_skill_key}` : ""}
                  </p>
                  <p style={{ margin: "6px 0", color: "#94a3b8" }}>
                    Shift Ends: {formatDate(employee.shift_ends_at)}
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => reactivate(employee.id)} disabled={employee.status === "fired"}>
                      Re-Activate
                    </button>
                    <button onClick={() => unassign(employee.id)} disabled={employee.status === "fired"}>
                      Unassign
                    </button>
                    <button onClick={() => fire(employee.id)} disabled={employee.status === "fired"}>
                      Fire
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
