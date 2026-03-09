import type { EmployeeStatus } from "@/config/employees";
import type { QueryClient } from "@/lib/db/query-client";
import { isWorkerOperational } from "@/domains/employees/worker-state";

type AssignmentRow = {
  employee_id: string;
  assigned_at: string;
};

type EmployeeRow = {
  id: string;
  status: EmployeeStatus;
  shift_ends_at: string | null;
};

export async function getOperationalProductionWorkerForBusiness(
  client: QueryClient,
  businessId: string
): Promise<string | null> {
  const { data: assignmentRows, error: assignmentError } = await client
    .from("employee_assignments")
    .select("employee_id, assigned_at")
    .eq("business_id", businessId)
    .eq("role", "production")
    .order("assigned_at", { ascending: true });

  if (assignmentError) throw assignmentError;

  const assignments = (assignmentRows as AssignmentRow[] | null) ?? [];
  if (assignments.length === 0) return null;

  const employeeIds = assignments.map((row) => row.employee_id);
  const { data: employeeRows, error: employeeError } = await client
    .from("employees")
    .select("id, status, shift_ends_at")
    .in("id", employeeIds);

  if (employeeError) throw employeeError;

  const employeeById = new Map(
    (((employeeRows as EmployeeRow[] | null) ?? []) as EmployeeRow[]).map((row) => [row.id, row])
  );

  for (const assignment of assignments) {
    const employee = employeeById.get(assignment.employee_id);
    if (!employee) continue;
    if (employee.status === "fired" || employee.status === "unpaid") continue;
    if (!isWorkerOperational(employee.status, employee.shift_ends_at)) continue;
    return employee.id;
  }

  return null;
}

export async function syncManufacturingWorkerAssigned(
  client: QueryClient,
  businessId: string
): Promise<boolean> {
  const workerId = await getOperationalProductionWorkerForBusiness(client, businessId);
  const workerAssigned = Boolean(workerId);

  const { data: currentJob, error: currentJobError } = await client
    .from("manufacturing_jobs")
    .select("id, worker_assigned")
    .eq("business_id", businessId)
    .maybeSingle();

  if (currentJobError) throw currentJobError;
  if (!currentJob) return workerAssigned;

  if (Boolean(currentJob.worker_assigned) !== workerAssigned) {
    const { error } = await client
      .from("manufacturing_jobs")
      .update({
        worker_assigned: workerAssigned,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentJob.id);

    if (error) throw error;
  }

  return workerAssigned;
}
