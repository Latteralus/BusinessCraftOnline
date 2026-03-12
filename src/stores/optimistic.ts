import { useGameStore } from "./game-store";

type SliceKey = Exclude<keyof ReturnType<typeof useGameStore.getState>, keyof {
  hydrated: true;
  setHydrated: true;
  hydrateFromServer: true;
  setPlayer: true;
  patchPlayer: true;
  setBusinesses: true;
  patchBusinesses: true;
  removeBusiness: true;
  setBanking: true;
  patchBanking: true;
  setInventory: true;
  patchInventory: true;
  setMarket: true;
  patchMarket: true;
  setContracts: true;
  patchContracts: true;
  removeContract: true;
  setEmployees: true;
  patchEmployees: true;
  removeEmployee: true;
  setProduction: true;
  patchProduction: true;
  setTravel: true;
  patchTravel: true;
  setChat: true;
  patchChat: true;
  removeChatMessage: true;
  setAppShell: true;
  patchAppShell: true;
}>;

type Rollback = () => void;

export async function runOptimisticUpdate<T>(
  _slice: SliceKey,
  optimisticUpdate: (state: ReturnType<typeof useGameStore.getState>) => void | Rollback,
  apiCall: () => Promise<T>
) {
  const rollback = optimisticUpdate(useGameStore.getState());

  try {
    return await apiCall();
  } catch (error) {
    rollback?.();
    throw error;
  }
}

export function upsertEntityById<T extends { id: string }>(collection: T[], entity: T): T[] {
  const index = collection.findIndex((entry) => entry.id === entity.id);
  if (index === -1) {
    return [entity, ...collection];
  }

  const next = collection.slice();
  next[index] = entity;
  return next;
}

export function removeEntityById<T extends { id: string }>(collection: T[], entityId: string): T[] {
  return collection.filter((entry) => entry.id !== entityId);
}

export function restoreEntityById<T extends { id: string }>(
  collection: T[],
  previousEntity: T | null | undefined
): T[] {
  if (!previousEntity) {
    return collection;
  }

  const index = collection.findIndex((entry) => entry.id === previousEntity.id);
  if (index === -1) {
    return [previousEntity, ...collection];
  }

  const next = collection.slice();
  next[index] = previousEntity;
  return next;
}
