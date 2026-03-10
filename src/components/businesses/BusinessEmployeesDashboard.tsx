"use client";

import { BASE_WAGE_PER_HOUR } from "@/config/employees";
import type { Business } from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import { getWorkerEffectiveStatus } from "@/domains/employees/worker-state";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency, formatEmployeeType, formatLabel } from "@/lib/formatters";
import { useEffect, useMemo, useState } from "react";

type Props = {
  business: Business;
  employees: (Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] })[];
};

function WorkforceCard(props: { label: string; value: string; sub?: string; tone?: "neutral" | "positive" | "negative" }) {
  const color =
    props.tone === "positive" ? "#86efac" : props.tone === "negative" ? "#fca5a5" : "#f8fafc";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(11, 17, 29, 0.98), rgba(6, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 700, color }}>{props.value}</div>
      {props.sub ? <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div> : null}
    </div>
  );
}

function WorkforceBars(props: { title: string; rows: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...props.rows.map((row) => row.value));
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
      <div style={{ display: "grid", gap: 10 }}>
        {props.rows.map((row) => (
          <div key={row.label} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
              <strong style={{ color: "#f8fafc" }}>{row.value}</strong>
            </div>
            <div style={{ height: 10, background: "rgba(148,163,184,0.1)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(4, (row.value / max) * 100)}%`, height: "100%", background: row.color, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkforceTable(props: { title: string; rows: Array<{ label: string; value: string }> }) {
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
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, borderBottom: "1px solid rgba(148,163,184,0.08)", paddingBottom: 8 }}>
            <div style={{ color: "var(--text-secondary)" }}>{row.label}</div>
            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ShiftRail(props: { label: string; sub: string; progress: number; color: string }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ color: "#f8fafc", fontWeight: 600 }}>{props.label}</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div>
        </div>
        <strong style={{ color: props.color }}>{Math.round(props.progress * 100)}%</strong>
      </div>
      <div style={{ height: 10, background: "rgba(148,163,184,0.1)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${props.progress * 100}%`, height: "100%", background: props.color, borderRadius: 999, transition: "width 900ms linear" }} />
      </div>
    </div>
  );
}

export default function BusinessEmployeesDashboard({ business, employees }: Props) {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

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

  const thisBusinessEmployees = employees.filter(
    (employee) => Boolean(getAssignmentForBusiness(employee)) || employee.employer_business_id === business.id
  );

  const byStatus = new Map<string, number>();
  const byType = new Map<string, number>();
  let payrollAll = 0;
  let payrollBusiness = 0;
  let unpaidCount = 0;
  let assignedCount = 0;
  let availableCount = 0;

  for (const employee of employees) {
    const effectiveStatus = getWorkerEffectiveStatus(employee.status, employee.shift_ends_at);
    byStatus.set(effectiveStatus, (byStatus.get(effectiveStatus) ?? 0) + 1);
    byType.set(employee.employee_type, (byType.get(employee.employee_type) ?? 0) + 1);
    payrollAll += employee.wage_per_hour || 0;
    if (effectiveStatus === "unpaid") unpaidCount += 1;
    if (effectiveStatus === "assigned") assignedCount += 1;
    if (effectiveStatus === "available") availableCount += 1;
  }

  for (const employee of thisBusinessEmployees) {
    payrollBusiness += getAssignmentForBusiness(employee)?.wage_per_hour ?? employee.wage_per_hour ?? BASE_WAGE_PER_HOUR[employee.employee_type];
  }

  const specialists = byType.get("specialist") ?? 0;
  const crossBusinessAssignments = employees.filter((employee) => {
    const assignment = getAssignments(employee)[0];
    return assignment && assignment.business_id !== business.id;
  }).length;
  const activeShiftCountdowns = useMemo(
    () =>
      thisBusinessEmployees
        .map((employee) => {
          if (!employee.shift_ends_at) return null;
          const endsMs = new Date(employee.shift_ends_at).getTime();
          if (!Number.isFinite(endsMs) || endsMs <= nowMs) return null;
          const totalShiftMs = 8 * 60 * 60 * 1000;
          const remainingMs = endsMs - nowMs;
          return {
            id: employee.id,
            label: `${employee.first_name} ${employee.last_name}`,
            remainingMs,
            progress: clamp(1 - remainingMs / totalShiftMs, 0, 1),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort((a, b) => a.remainingMs - b.remainingMs)
        .slice(0, 4),
    [nowMs, thisBusinessEmployees]
  );

  return (
    <div style={{ display: "grid", gap: 18, marginBottom: 18 }}>
      <div
        style={{
          background: "radial-gradient(circle at top left, rgba(96, 165, 250, 0.12), transparent 35%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 16 }}>
          Workforce Command
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <WorkforceCard label="Headcount" value={`${employees.length}`} sub={`${thisBusinessEmployees.length} attached to this site`} />
          <WorkforceCard label="Payroll Burn" value={formatCurrency(payrollBusiness)} sub={`${formatCurrency(payrollAll)} company-wide hourly`} />
          <WorkforceCard label="Operationally Ready" value={`${assignedCount + availableCount}`} sub={`${availableCount} available · ${assignedCount} assigned`} tone="positive" />
          <WorkforceCard label="Payroll Risk" value={`${unpaidCount}`} sub={unpaidCount > 0 ? "Workers awaiting settlement" : "No unpaid workers"} tone={unpaidCount > 0 ? "negative" : "neutral"} />
          <WorkforceCard label="Specialists" value={`${specialists}`} sub="High-skill staff on payroll" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 18 }}>
        <WorkforceBars
          title="Status Mix"
          rows={[
            { label: "Assigned", value: byStatus.get("assigned") ?? 0, color: "#22c55e" },
            { label: "Available", value: byStatus.get("available") ?? 0, color: "#60a5fa" },
            { label: "Unpaid", value: byStatus.get("unpaid") ?? 0, color: "#ef4444" },
            { label: "Resting", value: byStatus.get("resting") ?? 0, color: "#f59e0b" },
          ]}
        />
        <WorkforceTable
          title="Workforce Notes"
          rows={[
            { label: "Employees Attached Here", value: `${thisBusinessEmployees.length}` },
            { label: "Cross-Business Placements", value: `${crossBusinessAssignments}` },
            { label: "Hourly Payroll Here", value: formatCurrency(payrollBusiness) },
            { label: "Hourly Payroll Total", value: formatCurrency(payrollAll) },
            { label: "Unpaid Alerts", value: `${unpaidCount}` },
          ]}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        <WorkforceBars
          title="Employment Mix"
          rows={[
            { label: formatEmployeeType("temp"), value: byType.get("temp") ?? 0, color: "#60a5fa" },
            { label: formatEmployeeType("part_time"), value: byType.get("part_time") ?? 0, color: "#22c55e" },
            { label: formatEmployeeType("full_time"), value: byType.get("full_time") ?? 0, color: "#f59e0b" },
            { label: formatEmployeeType("specialist"), value: byType.get("specialist") ?? 0, color: "#a78bfa" },
          ]}
        />
        <WorkforceTable
          title="Business Staffing Posture"
          rows={[
            { label: "Business Type", value: formatBusinessType(business.type) },
            { label: "Entity Type", value: formatLabel(business.entity_type) },
            { label: "Workers at Site", value: `${thisBusinessEmployees.length}` },
            { label: "Available Bench", value: `${availableCount}` },
            { label: "Assigned Bench", value: `${assignedCount}` },
          ]}
        />
        <WorkforceTable
          title="Compensation Snapshot"
          rows={[
            { label: "Temp Base", value: `${formatCurrency(BASE_WAGE_PER_HOUR.temp)}/hr` },
            { label: "Part-Time Base", value: `${formatCurrency(BASE_WAGE_PER_HOUR.part_time)}/hr` },
            { label: "Full-Time Base", value: `${formatCurrency(BASE_WAGE_PER_HOUR.full_time)}/hr` },
            { label: "Specialist Base", value: `${formatCurrency(BASE_WAGE_PER_HOUR.specialist)}/hr` },
            { label: "Current Site Burn", value: `${formatCurrency(payrollBusiness)}/hr` },
          ]}
        />
      </div>

      {activeShiftCountdowns.length > 0 ? (
        <div
          style={{
            background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 12 }}>
            Shift Cadence
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {activeShiftCountdowns.map((shift, index) => (
              <ShiftRail
                key={shift.id}
                label={shift.label}
                sub={`${formatCountdown(shift.remainingMs)} remaining on active shift`}
                progress={shift.progress}
                color={["#22c55e", "#60a5fa", "#f59e0b", "#a78bfa"][index % 4]}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
