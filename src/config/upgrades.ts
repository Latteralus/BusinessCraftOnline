export const UPGRADE_COST_MULTIPLIER = 1.25;
export const UPGRADE_GAIN_MULTIPLIER = 1.1;

export function calculateUpgradeCost(baseCost: number, level: number): number {
  return Math.round(baseCost * Math.pow(UPGRADE_COST_MULTIPLIER, Math.max(level - 1, 0)));
}
