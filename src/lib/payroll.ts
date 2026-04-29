import { WAGE_TICK_MINUTES, calculatePayrollCharge } from "@/config/employees";
import { formatCurrency } from "@/lib/formatters";

export function formatPayrollTickLabel(): string {
  return `${WAGE_TICK_MINUTES} min`;
}

export function formatPayrollTickAmount(hourlyWage: number): string {
  return formatCurrency(calculatePayrollCharge(hourlyWage));
}

export function formatPayrollRateWithTick(hourlyWage: number): string {
  return `${formatCurrency(hourlyWage)}/hr · ${formatPayrollTickAmount(hourlyWage)}/${formatPayrollTickLabel()}`;
}
