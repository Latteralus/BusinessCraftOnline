import {
  getWorkerEffectiveStatus as getSharedWorkerEffectiveStatus,
  isWorkerOperational as isSharedWorkerOperational,
} from "../../../shared/employees/status";
import type { EmployeeStatus } from "@/config/employees";

export function getWorkerEffectiveStatus(status: EmployeeStatus, shiftEndsAt: string | null): EmployeeStatus {
  return getSharedWorkerEffectiveStatus(status, shiftEndsAt);
}

export function isWorkerOperational(status: EmployeeStatus, shiftEndsAt: string | null): boolean {
  return isSharedWorkerOperational(status, shiftEndsAt);
}
