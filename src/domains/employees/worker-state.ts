import type { EmployeeStatus } from "@/config/employees";

export function getWorkerEffectiveStatus(status: EmployeeStatus, shiftEndsAt: string | null): EmployeeStatus {
  if (status !== "assigned") return status;
  if (!shiftEndsAt) return "resting";
  return new Date(shiftEndsAt).getTime() <= Date.now() ? "resting" : "assigned";
}

export function isWorkerOperational(status: EmployeeStatus, shiftEndsAt: string | null): boolean {
  return getWorkerEffectiveStatus(status, shiftEndsAt) === "assigned";
}
