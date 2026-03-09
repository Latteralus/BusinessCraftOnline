import type { BusinessesResponse, BusinessSummary, BusinessWithBalance } from "@/domains/businesses";
import type {
  BankAccountWithBalance,
  BankingAccountsResponse,
  BankingLoanState,
  BankingLoanStateResponse,
  BankingTransactionsResponse,
  TransactionEntry,
} from "@/domains/banking";
import type { CitiesResponse, City, TravelState, TravelStateResponse } from "@/domains/cities-travel";
import type { Contract } from "@/domains/contracts";
import type { Employee, EmployeeSummary } from "@/domains/employees";
import type { BusinessInventoryItem, PersonalInventoryItem, ShippingQueueItem } from "@/domains/inventory";
import type { MarketListing, MarketStorefrontSetting, MarketTransaction } from "@/domains/market";
import type { ManufacturingStatusView } from "@/domains/production";
import type { UpgradeDefinition } from "@/domains/upgrades";
import type { ChatMessage } from "@/domains/chat";
import { apiGet } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";

type BusinessOption = {
  id: string;
  name: string;
};

export type BusinessesPageData = {
  businesses: BusinessWithBalance[];
  summary: BusinessSummary | null;
  cities: City[];
  travelState: TravelState;
  upgradeDefinitions: UpgradeDefinition[];
};

export type BankingPageData = {
  accounts: BankAccountWithBalance[];
  loanData: BankingLoanState;
  transactions: TransactionEntry[];
  businesses: BusinessWithBalance[];
};

export type InventoryPageData = {
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  shippingQueue: ShippingQueueItem[];
  accounts: BankAccountWithBalance[];
  businesses: BusinessWithBalance[];
  businessNamesById: Record<string, string>;
  cityNamesById: Record<string, string>;
};

export type MarketPageData = {
  businesses: BusinessWithBalance[];
  listings: MarketListing[];
  transactions: MarketTransaction[];
  storefront: MarketStorefrontSetting[];
};

export type EmployeesPageData = {
  employees: Employee[];
  summary: EmployeeSummary | null;
  businesses: BusinessOption[];
};

export type ContractsPageData = {
  businesses: BusinessWithBalance[];
  contracts: Contract[];
};

export type ProductionPageData = {
  businesses: BusinessWithBalance[];
  selectedBusinessId: string;
  manufacturing: ManufacturingStatusView | null;
};

export type AppShellData = {
  playerCount: number;
  onlinePlayers: Array<{
    player_id: string;
    character_name: string;
    wealth: number;
  }>;
  notificationsCount: number;
};

export type AuthMeData = {
  character?: { first_name?: string | null; last_name?: string | null } | null;
};

export type ChatMessagesData = {
  messages: ChatMessage[];
};

type UpgradeDefinitionsResponse = {
  definitions: UpgradeDefinition[];
  error?: string;
};

type InventoryResponse = {
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  shippingQueue: ShippingQueueItem[];
  businessNamesById: Record<string, string>;
  cityNamesById: Record<string, string>;
  error?: string;
};

type EmployeesResponse = {
  employees: Employee[];
  summary: EmployeeSummary | null;
  error?: string;
};

type ContractsResponse = {
  contracts: Contract[];
  error?: string;
};

type ListingsResponse = {
  listings: MarketListing[];
  transactions?: MarketTransaction[];
  error?: string;
};

type StorefrontResponse = {
  storefront: MarketStorefrontSetting[];
  error?: string;
};

type ManufacturingResponse = {
  status: ManufacturingStatusView;
  error?: string;
};

export const queryKeys = {
  authMe: ["auth", "me"] as const,
  appShell: ["app-shell"] as const,
  chatMessages: ["chat", "messages"] as const,
  businessesPage: ["page", "businesses"] as const,
  bankingPage: ["page", "banking"] as const,
  inventoryPage: ["page", "inventory"] as const,
  marketPage: ["page", "market"] as const,
  employeesPage: ["page", "employees"] as const,
  contractsPage: ["page", "contracts"] as const,
  productionPage: ["page", "production"] as const,
  productionStatus: (businessId: string) => ["production", "manufacturing", businessId] as const,
  travelState: ["travel", "state"] as const,
} as const;

export async function fetchAuthMe() {
  return apiGet<AuthMeData>("/api/auth/me", { fallbackError: "Failed to load profile." });
}

export async function fetchAppShell() {
  const payload = await apiGet<AppShellData>("/api/app-shell", { fallbackError: "Failed to load app shell." });
  return {
    playerCount: payload.playerCount ?? 0,
    onlinePlayers: payload.onlinePlayers ?? [],
    notificationsCount: payload.notificationsCount ?? 0,
  };
}

export async function fetchChatMessages() {
  const payload = await apiGet<{ messages?: ChatMessage[]; error?: string }>("/api/chat", {
    fallbackError: "Failed to load chat.",
  });
  return { messages: payload.messages ?? [] };
}

export async function fetchTravelState() {
  return apiGet<TravelStateResponse>(apiRoutes.travel, { fallbackError: "Failed to fetch travel state." });
}

export async function fetchBusinessesPageData(): Promise<BusinessesPageData> {
  const [businessesJson, citiesJson, travelJson, definitionsJson] = await Promise.all([
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to fetch businesses." }),
    apiGet<CitiesResponse>(apiRoutes.cities, { fallbackError: "Failed to fetch cities." }),
    fetchTravelState(),
    apiGet<UpgradeDefinitionsResponse>(apiRoutes.upgrades.root, { fallbackError: "Failed to fetch upgrade definitions." }),
  ]);

  return {
    businesses: businessesJson.businesses ?? [],
    summary: businessesJson.summary ?? null,
    cities: citiesJson.cities ?? [],
    travelState: travelJson,
    upgradeDefinitions: definitionsJson.definitions ?? [],
  };
}

export async function fetchBankingPageData(): Promise<BankingPageData> {
  const [accountsJson, loanJson, txJson, businessesJson] = await Promise.all([
    apiGet<BankingAccountsResponse>(apiRoutes.banking.accounts, { fallbackError: "Failed to load accounts." }),
    apiGet<BankingLoanStateResponse>(apiRoutes.banking.loan, { fallbackError: "Failed to load loan status." }),
    apiGet<BankingTransactionsResponse>(apiRoutes.banking.transactions(30), {
      fallbackError: "Failed to load transaction history.",
    }),
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
  ]);

  return {
    accounts: accountsJson.accounts ?? [],
    loanData: loanJson,
    transactions: txJson.entries ?? [],
    businesses: businessesJson.businesses ?? [],
  };
}

export async function fetchInventoryPageData(): Promise<InventoryPageData> {
  const [inventoryJson, accountsJson, businessesJson, citiesJson] = await Promise.all([
    apiGet<InventoryResponse>(apiRoutes.inventory.root, { fallbackError: "Failed to load inventory." }),
    apiGet<BankingAccountsResponse>(apiRoutes.banking.accounts, { fallbackError: "Failed to load bank accounts." }),
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
    apiGet<CitiesResponse>(apiRoutes.cities, { fallbackError: "Failed to load cities." }),
  ]);

  const cityNamesById: Record<string, string> = { ...(inventoryJson.cityNamesById ?? {}) };
  for (const city of citiesJson.cities ?? []) {
    cityNamesById[city.id] = city.name;
  }

  return {
    personalInventory: inventoryJson.personalInventory ?? [],
    businessInventory: inventoryJson.businessInventory ?? [],
    shippingQueue: inventoryJson.shippingQueue ?? [],
    businessNamesById: inventoryJson.businessNamesById ?? {},
    cityNamesById,
    accounts: accountsJson.accounts ?? [],
    businesses: businessesJson.businesses ?? [],
  };
}

export async function fetchMarketPageData(): Promise<MarketPageData> {
  const [businessesJson, listingsJson, storefrontJson] = await Promise.all([
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
    apiGet<ListingsResponse>(apiRoutes.market.listings({ includeTransactions: true, transactionsLimit: 40 }), {
      fallbackError: "Failed to load market listings.",
    }),
    apiGet<StorefrontResponse>(apiRoutes.market.storefront, {
      fallbackError: "Failed to load storefront settings.",
    }),
  ]);

  return {
    businesses: businessesJson.businesses ?? [],
    listings: listingsJson.listings ?? [],
    transactions: listingsJson.transactions ?? [],
    storefront: storefrontJson.storefront ?? [],
  };
}

export async function fetchEmployeesPageData(): Promise<EmployeesPageData> {
  const [employeesJson, businessesJson] = await Promise.all([
    apiGet<EmployeesResponse>(apiRoutes.employees.root, { fallbackError: "Failed to fetch employees." }),
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to fetch businesses." }),
  ]);

  return {
    employees: employeesJson.employees ?? [],
    summary: employeesJson.summary ?? null,
    businesses: (businessesJson.businesses ?? []).map((business) => ({ id: business.id, name: business.name })),
  };
}

export async function fetchContractsPageData(): Promise<ContractsPageData> {
  const [businessesJson, contractsJson] = await Promise.all([
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
    apiGet<ContractsResponse>(apiRoutes.contracts.root, { fallbackError: "Failed to load contracts." }),
  ]);

  return {
    businesses: businessesJson.businesses ?? [],
    contracts: contractsJson.contracts ?? [],
  };
}

export async function fetchProductionStatus(businessId: string) {
  return apiGet<ManufacturingResponse>(`/api/production/manufacturing?businessId=${businessId}`, {
    fallbackError: "Failed to load manufacturing status.",
  });
}

export async function fetchProductionPageData(): Promise<ProductionPageData> {
  const businessesJson = await apiGet<BusinessesResponse>(apiRoutes.businesses.root, {
    fallbackError: "Failed to load businesses.",
  });
  const businesses = businessesJson.businesses ?? [];
  const manufacturingBusinesses = businesses.filter((business) =>
    ["sawmill", "metalworking_factory", "food_processing_plant", "winery_distillery", "carpentry_workshop"].includes(
      business.type
    )
  );
  const selectedBusinessId = manufacturingBusinesses[0]?.id ?? "";
  const manufacturing = selectedBusinessId ? (await fetchProductionStatus(selectedBusinessId)).status : null;

  return {
    businesses,
    selectedBusinessId,
    manufacturing,
  };
}

export const prefetchableRoutes = [
  "/dashboard",
  "/businesses",
  "/market",
  "/production",
  "/banking",
  "/contracts",
  "/inventory",
  "/employees",
] as const;
