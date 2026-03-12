export type HydratedSliceVersionSelector<T> = (value: T) => string | number | null | undefined;

export type HydratedSliceSyncCheckInput<T> = {
  current: T | null | undefined;
  incoming: T;
  getVersion?: HydratedSliceVersionSelector<T>;
  getArraySizes?: Array<(value: T) => unknown[] | null | undefined>;
  getContentSignatures?: Array<(value: T) => unknown>;
};

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

export function shouldSyncHydratedEntry<T>({
  current,
  incoming,
  getVersion,
  getArraySizes = [],
  getContentSignatures = [],
}: HydratedSliceSyncCheckInput<T>): boolean {
  if (!current) return true;

  if (getVersion) {
    const currentVersion = getVersion(current);
    const incomingVersion = getVersion(incoming);
    if (currentVersion !== incomingVersion) {
      return true;
    }
  }

  for (const selectArray of getArraySizes) {
    const currentLength = selectArray(current)?.length ?? 0;
    const incomingLength = selectArray(incoming)?.length ?? 0;
    if (currentLength !== incomingLength) {
      return true;
    }
  }

  for (const getContentSignature of getContentSignatures) {
    const currentSignature = stableSerialize(getContentSignature(current));
    const incomingSignature = stableSerialize(getContentSignature(incoming));
    if (currentSignature !== incomingSignature) {
      return true;
    }
  }

  return false;
}

export function resolveHydratedEntry<T>(current: T | null | undefined, incoming: T): T {
  return current ?? incoming;
}
