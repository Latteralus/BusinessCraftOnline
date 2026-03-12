import type { OnlinePlayerPreview } from "@/domains/auth-character";
import type { BusinessesResponse } from "@/domains/businesses";
import type {
  BankingAccountsResponse,
  BankingLoanStateResponse,
  BankingTransactionsResponse,
} from "@/domains/banking";
import type { CitiesResponse, TravelStateResponse } from "@/domains/cities-travel";
import type { Contract } from "@/domains/contracts";
import type { ChatMessage } from "@/domains/chat";
import type { Employee, EmployeeSummary } from "@/domains/employees";
import type { BusinessInventoryItem, PersonalInventoryItem, ShippingQueueItem } from "@/domains/inventory";
import type { MarketListing, MarketTransaction } from "@/domains/market";
import type { ManufacturingStatusView } from "@/domains/production";
import type { BusinessDetailsEntry } from "@/stores/game-store";
import type { FinancePeriod } from "@/config/finance";
import { apiGet } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import {
  buildBankingPageData,
  buildBusinessesPageData,
  buildContractsPageData,
  buildEmployeesPageData,
  buildInventoryPageData,
  buildMarketPageData,
  buildProductionPageData,
  type BankingPageData,
  type BusinessesPageData,
  type ContractsPageData,
  type EmployeesPageData,
  type InventoryPageData,
  type MarketPageData,
  type ProductionPageData,
} from "@/lib/page-data";

export type {
  BankingPageData,
  BusinessesPageData,
  ContractsPageData,
  EmployeesPageData,
  InventoryPageData,
  MarketPageData,
  ProductionPageData,
} from "@/lib/page-data";

export type BusinessDetailsStateData = BusinessDetailsEntry;

export type AppShellData = {
  playerCount: number;
  onlinePlayers: OnlinePlayerPreview[];
  notificationsCount: number;
  unreadChatCount: number;
};

export type AuthMeData = {
  character?: { first_name?: string | null; last_name?: string | null } | null;
};

export type ChatMessagesData = {
  messages: ChatMessage[];
  unreadCount: number;
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

type ManufacturingResponse = {
  status: ManufacturingStatusView;
  error?: string;
};

type BusinessDetailsStateResponse = {
  detail?: BusinessDetailsEntry;
  error?: string;
};

export async function fetchAppShell() {
  const payload = await apiGet<AppShellData>("/api/app-shell", { fallbackError: "Failed to load app shell." });
  return {
    playerCount: payload.playerCount ?? 0,
    onlinePlayers: payload.onlinePlayers ?? [],
    notificationsCount: payload.notificationsCount ?? 0,
    unreadChatCount: payload.unreadChatCount ?? 0,
  };
}

export async function fetchChatMessages() {
  const payload = await apiGet<{ messages?: ChatMessage[]; unreadCount?: number; error?: string }>("/api/chat", {
    fallbackError: "Failed to load chat.",
  });
  return {
    messages: payload.messages ?? [],
    unreadCount: payload.unreadCount ?? 0,
  };
}

export async function fetchTravelState() {
  return apiGet<TravelStateResponse>(apiRoutes.travel, { fallbackError: "Failed to fetch travel state." });
}

export async function fetchBusinessesPageData(): Promise<BusinessesPageData> {
  const [businessesJson, citiesJson, travelJson] = await Promise.all([
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to fetch businesses." }),
    apiGet<CitiesResponse>(apiRoutes.cities, { fallbackError: "Failed to fetch cities." }),
    fetchTravelState(),
  ]);

  return buildBusinessesPageData({
    businesses: businessesJson.businesses ?? [],
    cities: citiesJson.cities ?? [],
    travelState: travelJson,
  });
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

  return buildBankingPageData({
    accounts: accountsJson.accounts ?? [],
    loanData: loanJson,
    transactions: txJson.entries ?? [],
    businesses: businessesJson.businesses ?? [],
  });
}

export async function fetchInventoryPageData(): Promise<InventoryPageData> {
  const [inventoryJson, accountsJson, businessesJson, citiesJson] = await Promise.all([
    apiGet<InventoryResponse>(apiRoutes.inventory.root, { fallbackError: "Failed to load inventory." }),
    apiGet<BankingAccountsResponse>(apiRoutes.banking.accounts, { fallbackError: "Failed to load bank accounts." }),
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
    apiGet<CitiesResponse>(apiRoutes.cities, { fallbackError: "Failed to load cities." }),
  ]);

  return buildInventoryPageData({
    personalInventory: inventoryJson.personalInventory ?? [],
    businessInventory: inventoryJson.businessInventory ?? [],
    shippingQueue: inventoryJson.shippingQueue ?? [],
    accounts: accountsJson.accounts ?? [],
    businesses: businessesJson.businesses ?? [],
    cities: citiesJson.cities ?? [],
    businessNamesById: inventoryJson.businessNamesById ?? {},
    cityNamesById: inventoryJson.cityNamesById ?? {},
  });
}

export async function fetchMarketPageData(): Promise<MarketPageData> {
  const [businessesJson, listingsJson, inventoryJson, travelJson] = await Promise.all([
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
    apiGet<ListingsResponse>(apiRoutes.market.listings({ includeTransactions: true, transactionsLimit: 40, buyerType: "player" }), {
      fallbackError: "Failed to load market listings.",
    }),
    apiGet<InventoryResponse>(apiRoutes.inventory.root, { fallbackError: "Failed to load inventory." }),
    apiGet<TravelStateResponse>(apiRoutes.travel, { fallbackError: "Failed to load travel state." }),
  ]);

  return buildMarketPageData({
    businesses: businessesJson.businesses ?? [],
    listings: listingsJson.listings ?? [],
    transactions: listingsJson.transactions ?? [],
    personalInventory: inventoryJson.personalInventory ?? [],
    businessInventory: inventoryJson.businessInventory ?? [],
    currentCityId: travelJson.currentCity?.id ?? null,
  });
}

export async function fetchEmployeesPageData(): Promise<EmployeesPageData> {
  const [employeesJson, businessesJson] = await Promise.all([
    apiGet<EmployeesResponse>(apiRoutes.employees.root, { fallbackError: "Failed to fetch employees." }),
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to fetch businesses." }),
  ]);

  return buildEmployeesPageData({
    employees: employeesJson.employees ?? [],
    summary: employeesJson.summary ?? null,
    businesses: businessesJson.businesses ?? [],
  });
}

export async function fetchContractsPageData(): Promise<ContractsPageData> {
  const [businessesJson, contractsJson] = await Promise.all([
    apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to load businesses." }),
    apiGet<ContractsResponse>(apiRoutes.contracts.root, { fallbackError: "Failed to load contracts." }),
  ]);

  return buildContractsPageData({
    businesses: businessesJson.businesses ?? [],
    contracts: contractsJson.contracts ?? [],
  });
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
  const selectedBusinessId = buildProductionPageData({ businesses, manufacturing: null }).selectedBusinessId;
  const manufacturing = selectedBusinessId ? (await fetchProductionStatus(selectedBusinessId)).status : null;

  return buildProductionPageData({
    businesses,
    manufacturing,
  });
}

export async function fetchBusinessDetailsState(
  businessId: string,
  period: FinancePeriod = "1h"
): Promise<BusinessDetailsStateData> {
  const payload = await apiGet<BusinessDetailsStateResponse>(apiRoutes.businesses.state(businessId, period), {
    fallbackError: "Failed to load business state.",
  });

  if (!payload.detail) {
    throw new Error("Business state payload missing detail.");
  }

  return payload.detail;
}
