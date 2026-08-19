import type { UpgradeDefinition } from "./types";

function formatUnit(value: number): string {
  return Number(Math.max(0, value).toFixed(2)).toString();
}

function deriveEffectSuffix(effectLabel: string): string {
  const label = effectLabel.trim();
  if (/ multiplier$/i.test(label)) return label.replace(/ multiplier$/i, "").toLowerCase();
  if (/^additional /i.test(label)) return label.replace(/^additional /i, "").toLowerCase();
  return label.toLowerCase();
}

export function formatUpgradeEffectValue(definition: UpgradeDefinition, effectValue: number): string {
  switch (definition.ui_format) {
    case "flat_integer": {
      const whole = Math.max(0, Math.round(effectValue));
      let suffix = deriveEffectSuffix(definition.effect_label);
      if (whole === 1 && suffix.endsWith("s")) suffix = suffix.slice(0, -1);
      return `+${whole} ${suffix}`;
    }
    case "quality_points":
      return `+${Math.max(0, Math.round(effectValue))} quality`;
    case "unit_down":
      return `-${formatUnit(1 - effectValue)} ${deriveEffectSuffix(definition.effect_label)}`;
    case "unit_up":
    default:
      return `+${formatUnit(effectValue - 1)} ${deriveEffectSuffix(definition.effect_label)}`;
  }
}

export function formatInstallTimeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}
