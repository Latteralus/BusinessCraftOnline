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
  slice: SliceKey,
  optimisticUpdate: (state: ReturnType<typeof useGameStore.getState>) => void | Rollback,
  apiCall: () => Promise<T>
) {
  const snapshot = useGameStore.getState()[slice];
  const rollback = optimisticUpdate(useGameStore.getState());

  try {
    return await apiCall();
  } catch (error) {
    useGameStore.setState({ [slice]: snapshot } as Partial<ReturnType<typeof useGameStore.getState>>);
    rollback?.();
    throw error;
  }
}
