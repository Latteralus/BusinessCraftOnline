export function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function round2(value: number): number {
  return Number(value.toFixed(2));
}

