import type { BankAccountWithBalance, BankingLoanState, TransactionEntry } from "@/domains/banking";
import type { BusinessSummary, BusinessWithBalance } from "@/domains/businesses";
import { summarizeBusinessesWithBalances } from "@/domains/businesses";
import type { City, TravelState } from "@/domains/cities-travel";
import type { Contract } from "@/domains/contracts";
import type { Employee, EmployeeSummary } from "@/domains/employees";
import type { BusinessInventoryItem, PersonalInventoryItem, ShippingQueueItem } from "@/domains/inventory";
import type { MarketListing, MarketTransaction } from "@/domains/market";
import type { ManufacturingStatusView } from "@/domains/production";

type BusinessOption = {
  id: string;
  name: string;
};

export type BusinessesPageData = {
  businesses: BusinessWithBalance[];
  summary: BusinessSummary | null;
  cities: City[];
  travelState: TravelState;
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
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  currentCityId: string | null;
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

const MANUFACTURING_BUSINESS_TYPES = new Set([
  "sawmill",
  "metalworking_factory",
  "food_processing_plant",
  "winery_distillery",
  "carpentry_workshop",
]);

export function buildBusinessesPageData(input: {
  businesses: BusinessWithBalance[];
  cities: City[];
  travelState: TravelState;
}): BusinessesPageData {
  return {
    businesses: input.businesses,
    summary: summarizeBusinessesWithBalances(input.businesses),
    cities: input.cities,
    travelState: input.travelState,
  };
}

export function buildBankingPageData(input: {
  accounts: BankAccountWithBalance[];
  loanData: BankingLoanState;
  transactions: TransactionEntry[];
  businesses: BusinessWithBalance[];
}): BankingPageData {
  return input;
}

export function buildInventoryPageData(input: {
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  shippingQueue: ShippingQueueItem[];
  accounts: BankAccountWithBalance[];
  businesses: BusinessWithBalance[];
  cities: City[];
  businessNamesById?: Record<string, string>;
  cityNamesById?: Record<string, string>;
}): InventoryPageData {
  const businessNamesById = { ...(input.businessNamesById ?? {}) };
  for (const business of input.businesses) {
    businessNamesById[business.id] = business.name;
  }

  const cityNamesById = { ...(input.cityNamesById ?? {}) };
  for (const city of input.cities) {
    cityNamesById[city.id] = city.name;
  }

  return {
    personalInventory: input.personalInventory,
    businessInventory: input.businessInventory,
    shippingQueue: input.shippingQueue,
    accounts: input.accounts,
    businesses: input.businesses,
    businessNamesById,
    cityNamesById,
  };
}

export function buildMarketPageData(input: {
  businesses: BusinessWithBalance[];
  listings: MarketListing[];
  transactions: MarketTransaction[];
  personalInventory: PersonalInventoryItem[];
  businessInventory: BusinessInventoryItem[];
  currentCityId: string | null;
}): MarketPageData {
  return input;
}

export function buildEmployeesPageData(input: {
  employees: Employee[];
  summary: EmployeeSummary | null;
  businesses: BusinessWithBalance[];
}): EmployeesPageData {
  return {
    employees: input.employees,
    summary: input.summary,
    businesses: input.businesses.map((business) => ({ id: business.id, name: business.name })),
  };
}

export function buildContractsPageData(input: {
  businesses: BusinessWithBalance[];
  contracts: Contract[];
}): ContractsPageData {
  return input;
}

export function selectDefaultProductionBusinessId(businesses: BusinessWithBalance[]): string {
  return businesses.find((business) => MANUFACTURING_BUSINESS_TYPES.has(business.type))?.id ?? "";
}

export function buildProductionPageData(input: {
  businesses: BusinessWithBalance[];
  manufacturing: ManufacturingStatusView | null;
  selectedBusinessId?: string;
}): ProductionPageData {
  return {
    businesses: input.businesses,
    selectedBusinessId: input.selectedBusinessId ?? selectDefaultProductionBusinessId(input.businesses),
    manufacturing: input.manufacturing,
  };
}
