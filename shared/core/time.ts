export function toIso(value: Date | number): string {
  return new Date(value).toISOString();
}

export function nowIso(): string {
  return toIso(Date.now());
}

export function addHoursToNowIso(hours: number): string {
  return toIso(Date.now() + hours * 60 * 60 * 1000);
}
