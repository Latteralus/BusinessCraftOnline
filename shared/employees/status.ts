export const EMPLOYEE_STATUSES = ["available", "assigned", "resting", "unpaid", "fired"] as const;

export type SharedEmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export function getWorkerEffectiveStatus(
  status: SharedEmployeeStatus,
  shiftEndsAt: string | null
): SharedEmployeeStatus {
  void shiftEndsAt;
  if (status !== "assigned") return status;
  return "assigned";
}

export function isWorkerOperational(status: SharedEmployeeStatus, shiftEndsAt: string | null): boolean {
  return getWorkerEffectiveStatus(status, shiftEndsAt) === "assigned";
}
