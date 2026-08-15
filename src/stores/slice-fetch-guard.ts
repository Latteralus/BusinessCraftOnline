// Coordinates writes into game-store slices that can be triggered from two
// independent places at once: a mutation's own `syncMutationViews` resync and
// the realtime provider's postgres_changes-triggered refetch of the same
// table. Both fire a GET for the same slice around the same time, and without
// ordering, whichever response happens to resolve last wins even if it's the
// staler one — silently reverting a just-applied sale/transfer until some
// later event corrects it. A per-slice generation counter ensures only the
// result of the most recently *started* fetch for a given key is ever
// committed to the store.
// Shared key names so `mutation-sync.ts` and `realtime-provider.tsx` guard the
// same generation counter when they refetch the same slice.
export const SLICE_KEYS = {
  businesses: "businesses",
  banking: "banking",
  inventory: "inventory",
  market: "market",
  employees: "employees",
  contracts: "contracts",
  production: "production",
  businessDetail: (businessId: string) => `businessDetail:${businessId}`,
} as const;

const generations = new Map<string, number>();

export function beginSliceFetch(key: string): number {
  const next = (generations.get(key) ?? 0) + 1;
  generations.set(key, next);
  return next;
}

export function isLatestSliceFetch(key: string, token: number): boolean {
  return generations.get(key) === token;
}

export async function runGuardedSliceFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  apply: (data: T) => void
): Promise<void> {
  const token = beginSliceFetch(key);
  const data = await fetcher();
  if (isLatestSliceFetch(key, token)) {
    apply(data);
  }
}
