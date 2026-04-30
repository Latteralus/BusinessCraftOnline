export function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

export function round2(value: number): number {
  return roundTo(value, 2);
}

export function round4(value: number): number {
  return roundTo(value, 4);
}
