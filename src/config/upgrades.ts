export const UPGRADE_COST_MULTIPLIER = 1.25;
export const UPGRADE_GAIN_MULTIPLIER = 1.1;

export function calculateUpgradeCost(
  baseCost: number,
  level: number,
  multiplier: number = UPGRADE_COST_MULTIPLIER
): number {
  const normalizedLevel = Math.max(level - 1, 0);
  return Number((baseCost * Math.pow(multiplier, normalizedLevel)).toFixed(2));
}

export function calculateUpgradeEffect(
  baseEffect: number,
  level: number,
  multiplier: number = UPGRADE_GAIN_MULTIPLIER
): number {
  const normalizedLevel = Math.max(level - 1, 0);
  return Number((baseEffect * Math.pow(multiplier, normalizedLevel)).toFixed(4));
}
