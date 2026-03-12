import { create } from "zustand";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import type { BankAccountWithBalance, LoanSummary, TransactionEntry } from "@/domains/banking";
import type { TravelState } from "@/domains/cities-travel";
import type { ChatMessage } from "@/domains/chat";
import type { Contract } from "@/domains/contracts";
import type { Employee, EmployeeSummary } from "@/domains/employees";
import type { BusinessInventoryItem, PersonalInventoryItem, ShippingQueueItem } from "@/domains/inventory";
import type { MarketListing, MarketTransaction } from "@/domains/market";
import type { ManufacturingStatusView, ProductionStatus } from "@/domains/production";
import type { Business, BusinessFinanceDashboard, BusinessUpgrade, BusinessUpgradeProject, BusinessWithBalance } from "@/domains/businesses";
import type { StoreShelfItem } from "@/domains/stores";
import type { UpgradeDefinition } from "@/domains/upgrades";

export type RealtimeConnectionStatus = "connecting" | "connected" | "disconnected";

type SliceState<T> = {
  data: T;
  lastUpdated: number | null;
};

export type PlayerSliceData = {
  playerId: string | null;
  initials: string;
  firstName: string;
  lastName: string;
};

export type BankingSliceData = {
  accounts: BankAccountWithBalance[];
  loanData: {
    summary: LoanSummary | null;
    maxLoanAvailable: number;
  } | null;
  transactions: TransactionEntry[];
  businesses: BusinessWithBalance[];
};

export type InventorySliceData = {
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  shippingQueue: ShippingQueueItem[];
  accounts: BankAccountWithBalance[];
  businesses: BusinessWithBalance[];
  businessNamesById: Record<string, string>;
  cityNamesById: Record<string, string>;
};

export type MarketSliceData = {
  businesses: BusinessWithBalance[];
  listings: MarketListing[];
  transactions: MarketTransaction[];
  currentCityId: string | null;
};

export type ContractsSliceData = Contract[];

export type EmployeesSliceData = {
  employees: Employee[];
  summary: EmployeeSummary | null;
  businesses: Array<{ id: string; name: string }>;
};

export type ProductionSliceData = {
  businesses: BusinessWithBalance[];
  selectedBusinessId: string;
  manufacturing: ManufacturingStatusView | null;
};

export type BusinessDetailsEmployee = Employee & {
  employee_assignments?: Array<Record<string, unknown>> | null;
};

export type BusinessDetailsEntry = {
  business: Business;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  shelfItems: StoreShelfItem[];
  upgrades: BusinessUpgrade[];
  upgradeProjects: BusinessUpgradeProject[];
  employees: BusinessDetailsEmployee[];
  financeDashboard: BusinessFinanceDashboard | null;
  ownedBusinesses: Array<Pick<BusinessWithBalance, "id" | "name" | "city_id">>;
  upgradeDefinitions: UpgradeDefinition[];
};

export type BusinessDetailsSliceData = Record<string, BusinessDetailsEntry>;

export type AppShellSliceData = {
  playerCount: number;
  onlinePlayers: OnlinePlayerPreview[];
  notificationsCount: number;
  unreadChatCount: number;
  connectionStatus: RealtimeConnectionStatus;
};

export type GameStoreHydrationPayload = {
  player?: Partial<PlayerSliceData>;
  businesses?: BusinessWithBalance[];
  banking?: Partial<BankingSliceData>;
  inventory?: Partial<InventorySliceData>;
  market?: Partial<MarketSliceData>;
  contracts?: ContractsSliceData;
  employees?: Partial<EmployeesSliceData>;
  production?: Partial<ProductionSliceData>;
  businessDetails?: BusinessDetailsSliceData;
  travel?: TravelState | null;
  chat?: ChatMessage[];
  appShell?: Partial<AppShellSliceData>;
  hydrated?: boolean;
};

type GameStoreState = {
  hydrated: boolean;
  player: SliceState<PlayerSliceData>;
  businesses: SliceState<BusinessWithBalance[]>;
  banking: SliceState<BankingSliceData>;
  inventory: SliceState<InventorySliceData>;
  market: SliceState<MarketSliceData>;
  contracts: SliceState<ContractsSliceData>;
  employees: SliceState<EmployeesSliceData>;
  production: SliceState<ProductionSliceData>;
  businessDetails: SliceState<BusinessDetailsSliceData>;
  travel: SliceState<TravelState | null>;
  chat: SliceState<ChatMessage[]>;
  appShell: SliceState<AppShellSliceData>;
  setHydrated: (hydrated: boolean) => void;
  hydrateFromServer: (payload: GameStoreHydrationPayload) => void;
  setPlayer: (value: PlayerSliceData) => void;
  patchPlayer: (value: Partial<PlayerSliceData>) => void;
  setBusinesses: (value: BusinessWithBalance[]) => void;
  patchBusinesses: (value: Partial<BusinessWithBalance> & { id: string }) => void;
  removeBusiness: (businessId: string) => void;
  setBanking: (value: BankingSliceData) => void;
  patchBanking: (value: Partial<BankingSliceData>) => void;
  setInventory: (value: InventorySliceData) => void;
  patchInventory: (value: Partial<InventorySliceData>) => void;
  setMarket: (value: MarketSliceData) => void;
  patchMarket: (value: Partial<MarketSliceData>) => void;
  setContracts: (value: ContractsSliceData) => void;
  patchContracts: (value: Partial<Contract> & { id: string }) => void;
  removeContract: (contractId: string) => void;
  setEmployees: (value: EmployeesSliceData) => void;
  patchEmployees: (value: Partial<Employee> & { id: string }) => void;
  removeEmployee: (employeeId: string) => void;
  setProduction: (value: ProductionSliceData) => void;
  patchProduction: (value: Partial<ProductionSliceData>) => void;
  setBusinessDetails: (value: BusinessDetailsSliceData) => void;
  upsertBusinessDetail: (businessId: string, value: BusinessDetailsEntry) => void;
  patchBusinessDetail: (businessId: string, value: Partial<BusinessDetailsEntry>) => void;
  removeBusinessDetail: (businessId: string) => void;
  setTravel: (value: TravelState | null) => void;
  patchTravel: (value: Partial<TravelState>) => void;
  setChat: (value: ChatMessage[]) => void;
  patchChat: (value: ChatMessage | ChatMessage[]) => void;
  removeChatMessage: (messageId: string) => void;
  setAppShell: (value: AppShellSliceData) => void;
  patchAppShell: (value: Partial<AppShellSliceData>) => void;
};

const now = () => Date.now();

const emptyPlayer: PlayerSliceData = {
  playerId: null,
  initials: "··",
  firstName: "",
  lastName: "",
};

const emptyBanking: BankingSliceData = {
  accounts: [],
  loanData: null,
  transactions: [],
  businesses: [],
};

const emptyInventory: InventorySliceData = {
  personalInventory: [],
  businessInventory: [],
  shippingQueue: [],
  accounts: [],
  businesses: [],
  businessNamesById: {},
  cityNamesById: {},
};

const emptyMarket: MarketSliceData = {
  businesses: [],
  listings: [],
  transactions: [],
  currentCityId: null,
};

const emptyEmployees: EmployeesSliceData = {
  employees: [],
  summary: null,
  businesses: [],
};

const emptyProduction: ProductionSliceData = {
  businesses: [],
  selectedBusinessId: "",
  manufacturing: null,
};

const emptyAppShell: AppShellSliceData = {
  playerCount: 0,
  onlinePlayers: [],
  notificationsCount: 0,
  unreadChatCount: 0,
  connectionStatus: "connecting",
};

function upsertById<T extends { id: string }>(collection: T[], value: Partial<T> & { id: string }) {
  const index = collection.findIndex((item) => item.id === value.id);
  if (index === -1) {
    return [...collection, value as T];
  }

  const next = collection.slice();
  next[index] = { ...next[index], ...value };
  return next;
}

function removeById<T extends { id: string }>(collection: T[], id: string) {
  return collection.filter((item) => item.id !== id);
}

function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const merged = new Map<string, ChatMessage>();
  for (const message of current) {
    merged.set(message.id, message);
  }
  for (const message of incoming) {
    merged.set(message.id, message);
  }
  return Array.from(merged.values()).sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
}

export const useGameStore = create<GameStoreState>((set) => ({
  hydrated: false,
  player: { data: emptyPlayer, lastUpdated: null },
  businesses: { data: [], lastUpdated: null },
  banking: { data: emptyBanking, lastUpdated: null },
  inventory: { data: emptyInventory, lastUpdated: null },
  market: { data: emptyMarket, lastUpdated: null },
  contracts: { data: [], lastUpdated: null },
  employees: { data: emptyEmployees, lastUpdated: null },
  production: { data: emptyProduction, lastUpdated: null },
  businessDetails: { data: {}, lastUpdated: null },
  travel: { data: null, lastUpdated: null },
  chat: { data: [], lastUpdated: null },
  appShell: { data: emptyAppShell, lastUpdated: null },
  setHydrated: (hydrated) => set({ hydrated }),
  hydrateFromServer: (payload) =>
    set((state) => {
      const timestamp = now();
      const next = { ...state, hydrated: payload.hydrated ?? true };

      if (payload.player) {
        next.player = {
          data: { ...state.player.data, ...payload.player },
          lastUpdated: timestamp,
        };
      }
      if (payload.businesses) {
        next.businesses = { data: payload.businesses, lastUpdated: timestamp };
      }
      if (payload.banking) {
        next.banking = {
          data: { ...state.banking.data, ...payload.banking },
          lastUpdated: timestamp,
        };
      }
      if (payload.inventory) {
        next.inventory = {
          data: { ...state.inventory.data, ...payload.inventory },
          lastUpdated: timestamp,
        };
      }
      if (payload.market) {
        next.market = {
          data: { ...state.market.data, ...payload.market },
          lastUpdated: timestamp,
        };
      }
      if (payload.contracts) {
        next.contracts = { data: payload.contracts, lastUpdated: timestamp };
      }
      if (payload.employees) {
        next.employees = {
          data: { ...state.employees.data, ...payload.employees },
          lastUpdated: timestamp,
        };
      }
      if (payload.production) {
        next.production = {
          data: { ...state.production.data, ...payload.production },
          lastUpdated: timestamp,
        };
      }
      if (payload.businessDetails) {
        next.businessDetails = {
          data: { ...state.businessDetails.data, ...payload.businessDetails },
          lastUpdated: timestamp,
        };
      }
      if ("travel" in payload) {
        next.travel = { data: payload.travel ?? null, lastUpdated: timestamp };
      }
      if (payload.chat) {
        next.chat = { data: payload.chat, lastUpdated: timestamp };
      }
      if (payload.appShell) {
        next.appShell = {
          data: { ...state.appShell.data, ...payload.appShell },
          lastUpdated: timestamp,
        };
      }

      return next;
    }),
  setPlayer: (value) => set({ player: { data: value, lastUpdated: now() } }),
  patchPlayer: (value) =>
    set((state) => ({
      player: {
        data: { ...state.player.data, ...value },
        lastUpdated: now(),
      },
    })),
  setBusinesses: (value) => set({ businesses: { data: value, lastUpdated: now() } }),
  patchBusinesses: (value) =>
    set((state) => ({
      businesses: {
        data: upsertById(state.businesses.data, value),
        lastUpdated: now(),
      },
    })),
  removeBusiness: (businessId) =>
    set((state) => ({
      businesses: {
        data: removeById(state.businesses.data, businessId),
        lastUpdated: now(),
      },
    })),
  setBanking: (value) => set({ banking: { data: value, lastUpdated: now() } }),
  patchBanking: (value) =>
    set((state) => ({
      banking: {
        data: { ...state.banking.data, ...value },
        lastUpdated: now(),
      },
    })),
  setInventory: (value) => set({ inventory: { data: value, lastUpdated: now() } }),
  patchInventory: (value) =>
    set((state) => ({
      inventory: {
        data: { ...state.inventory.data, ...value },
        lastUpdated: now(),
      },
    })),
  setMarket: (value) => set({ market: { data: value, lastUpdated: now() } }),
  patchMarket: (value) =>
    set((state) => ({
      market: {
        data: { ...state.market.data, ...value },
        lastUpdated: now(),
      },
    })),
  setContracts: (value) => set({ contracts: { data: value, lastUpdated: now() } }),
  patchContracts: (value) =>
    set((state) => ({
      contracts: {
        data: upsertById(state.contracts.data, value),
        lastUpdated: now(),
      },
    })),
  removeContract: (contractId) =>
    set((state) => ({
      contracts: {
        data: removeById(state.contracts.data, contractId),
        lastUpdated: now(),
      },
    })),
  setEmployees: (value) => set({ employees: { data: value, lastUpdated: now() } }),
  patchEmployees: (value) =>
    set((state) => ({
      employees: {
        data: {
          ...state.employees.data,
          employees: upsertById(state.employees.data.employees, value),
        },
        lastUpdated: now(),
      },
    })),
  removeEmployee: (employeeId) =>
    set((state) => ({
      employees: {
        data: {
          ...state.employees.data,
          employees: removeById(state.employees.data.employees, employeeId),
        },
        lastUpdated: now(),
      },
    })),
  setProduction: (value) => set({ production: { data: value, lastUpdated: now() } }),
  patchProduction: (value) =>
    set((state) => ({
      production: {
        data: { ...state.production.data, ...value },
        lastUpdated: now(),
      },
    })),
  setBusinessDetails: (value) => set({ businessDetails: { data: value, lastUpdated: now() } }),
  upsertBusinessDetail: (businessId, value) =>
    set((state) => ({
      businessDetails: {
        data: { ...state.businessDetails.data, [businessId]: value },
        lastUpdated: now(),
      },
    })),
  patchBusinessDetail: (businessId, value) =>
    set((state) => ({
      businessDetails: {
        data: {
          ...state.businessDetails.data,
          [businessId]: {
            ...state.businessDetails.data[businessId],
            ...value,
          },
        },
        lastUpdated: now(),
      },
    })),
  removeBusinessDetail: (businessId) =>
    set((state) => {
      const next = { ...state.businessDetails.data };
      delete next[businessId];
      return {
        businessDetails: {
          data: next,
          lastUpdated: now(),
        },
      };
    }),
  setTravel: (value) => set({ travel: { data: value, lastUpdated: now() } }),
  patchTravel: (value) =>
    set((state) => ({
      travel: {
        data: state.travel.data ? { ...state.travel.data, ...value } : (value as TravelState),
        lastUpdated: now(),
      },
    })),
  setChat: (value) => set({ chat: { data: value, lastUpdated: now() } }),
  patchChat: (value) =>
    set((state) => ({
      chat: {
        data: mergeChatMessages(state.chat.data, Array.isArray(value) ? value : [value]),
        lastUpdated: now(),
      },
    })),
  removeChatMessage: (messageId) =>
    set((state) => ({
      chat: {
        data: removeById(state.chat.data, messageId),
        lastUpdated: now(),
      },
    })),
  setAppShell: (value) => set({ appShell: { data: value, lastUpdated: now() } }),
  patchAppShell: (value) =>
    set((state) => ({
      appShell: {
        data: { ...state.appShell.data, ...value },
        lastUpdated: now(),
      },
    })),
}));

export const gameStoreSelectors = {
  hydrated: (state: GameStoreState) => state.hydrated,
  player: (state: GameStoreState) => state.player.data,
  businesses: (state: GameStoreState) => state.businesses.data,
  banking: (state: GameStoreState) => state.banking.data,
  inventory: (state: GameStoreState) => state.inventory.data,
  market: (state: GameStoreState) => state.market.data,
  contracts: (state: GameStoreState) => state.contracts.data,
  employees: (state: GameStoreState) => state.employees.data,
  production: (state: GameStoreState) => state.production.data,
  businessDetails: (state: GameStoreState) => state.businessDetails.data,
  travel: (state: GameStoreState) => state.travel.data,
  chat: (state: GameStoreState) => state.chat.data,
  appShell: (state: GameStoreState) => state.appShell.data,
  connectionStatus: (state: GameStoreState) => state.appShell.data.connectionStatus,
};

export function useGameHydrated() {
  return useGameStore(gameStoreSelectors.hydrated);
}

export function usePlayerSlice() {
  return useGameStore(gameStoreSelectors.player);
}

export function useBusinessesSlice() {
  return useGameStore(gameStoreSelectors.businesses);
}

export function useBankingSlice() {
  return useGameStore(gameStoreSelectors.banking);
}

export function useInventorySlice() {
  return useGameStore(gameStoreSelectors.inventory);
}

export function useMarketSlice() {
  return useGameStore(gameStoreSelectors.market);
}

export function useContractsSlice() {
  return useGameStore(gameStoreSelectors.contracts);
}

export function useEmployeesSlice() {
  return useGameStore(gameStoreSelectors.employees);
}

export function useProductionSlice() {
  return useGameStore(gameStoreSelectors.production);
}

export function useBusinessDetailsSlice() {
  return useGameStore(gameStoreSelectors.businessDetails);
}

export function useTravelSlice() {
  return useGameStore(gameStoreSelectors.travel);
}

export function useChatSlice() {
  return useGameStore(gameStoreSelectors.chat);
}

export function useAppShellSlice() {
  return useGameStore(gameStoreSelectors.appShell);
}
