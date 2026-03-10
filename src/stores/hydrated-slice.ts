export type HydratedSliceVersionSelector<T> = (value: T) => string | number | null | undefined;

export type HydratedSliceSyncCheckInput<T> = {
  current: T | null | undefined;
  incoming: T;
  getVersion?: HydratedSliceVersionSelector<T>;
  getArraySizes?: Array<(value: T) => unknown[] | null | undefined>;
};

export function shouldSyncHydratedEntry<T>({
  current,
  incoming,
  getVersion,
  getArraySizes = [],
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

  return false;
}

export function resolveHydratedEntry<T>(current: T | null | undefined, incoming: T): T {
  return current ?? incoming;
}
