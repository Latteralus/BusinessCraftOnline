import type { UpgradeDefinition } from "./types";

function formatUnit(value: number): string {
  return Number(Math.max(0, value).toFixed(2)).toString();
}

export function formatUpgradeEffectValue(definition: UpgradeDefinition, effectValue: number): string {
  switch (definition.ui_format) {
    case "flat_integer": {
      const whole = Math.max(0, Math.round(effectValue));
      const label = whole === 1 ? "slot" : "slots";
      return `+${whole} ${label}`;
    }
    case "quality_points":
      return `+${Math.max(0, Math.round(effectValue))} quality`;
    case "unit_down":
      return `-${formatUnit(1 - effectValue)}`;
    case "unit_up":
    default:
      return `+${formatUnit(effectValue - 1)}`;
  }
}

export function formatInstallTimeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}
