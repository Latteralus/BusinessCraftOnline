import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCharacter, getPlayer } from "@/domains/auth-character";
import {
  calculateMaxLoanForBusinessLevel,
  getBankingSnapshot,
  getLoanSummary,
  getTransactionHistory,
} from "@/domains/banking";
import {
  getBusinessSummary,
  getBusinessesWithBalances,
  summarizeBusinessesWithBalances,
} from "@/domains/businesses";
import { canPurchaseBusiness, getActiveTravel, getCities, getCityById } from "@/domains/cities-travel";
import { getContracts } from "@/domains/contracts";
import { getEmployeeSummary, getPlayerEmployees } from "@/domains/employees";
import { getBusinessInventory, getPersonalInventory, getShippingQueue } from "@/domains/inventory";
import {
  getMarketListings,
  getMarketStorefrontSettings,
  getMarketTransactions,
} from "@/domains/market";
import { getManufacturingStatus } from "@/domains/production";
import { getUpgradeDefinitions } from "@/domains/upgrades";

export async function requireAuthedPageContext() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const character = await getCharacter(supabase, user.id).catch(() => null);
  if (!character) {
    redirect("/character-setup");
  }

  return { supabase, user, character };
}

export async function loadBusinessesPageData(userId: string) {
  const supabase = createSupabaseServerClient();
  const [businesses, cities, activeTravel, upgradeDefinitions, canBuyBusiness] = await Promise.all([
    getBusinessesWithBalances(supabase, userId).catch(() => []),
    getCities(supabase).catch(() => []),
    getActiveTravel(supabase, userId).catch(() => null),
    getUpgradeDefinitions(supabase).catch(() => []),
    canPurchaseBusiness(supabase, userId).catch(() => false),
  ]);

  const currentCity = activeTravel ? null : null;
  const character = await getCharacter(supabase, userId).catch(() => null);
  const resolvedCurrentCity =
    character?.current_city_id ? await getCityById(supabase, character.current_city_id).catch(() => null) : currentCity;

  return {
    businesses,
    summary: summarizeBusinessesWithBalances(businesses),
    cities,
    travelState: {
      currentCity: resolvedCurrentCity,
      activeTravel: activeTravel ? { id: activeTravel.id } : null,
      canPurchaseBusiness: canBuyBusiness,
    },
    upgradeDefinitions,
  };
}

export async function loadBankingPageData(userId: string, businessLevel: number) {
  const supabase = createSupabaseServerClient();
  const [snapshot, loanSummary, transactions, businesses] = await Promise.all([
    getBankingSnapshot(supabase, userId).catch(() => ({ accounts: [], activeLoan: null })),
    getLoanSummary(supabase, userId, businessLevel).catch(() => null),
    getTransactionHistory(supabase, userId, { limit: 30 }).catch(() => []),
    getBusinessesWithBalances(supabase, userId).catch(() => []),
  ]);

  return {
    accounts: snapshot.accounts ?? [],
    loanData: {
      summary: loanSummary,
      maxLoanAvailable: calculateMaxLoanForBusinessLevel(businessLevel),
    },
    transactions,
    businesses,
  };
}

export async function loadInventoryPageData(userId: string) {
  const supabase = createSupabaseServerClient();
  const [personalInventory, businessInventory, shippingQueue, accountsSnapshot, businesses, cities] =
    await Promise.all([
      getPersonalInventory(supabase, userId).catch(() => []),
      getBusinessInventory(supabase, userId).catch(() => []),
      getShippingQueue(supabase, userId).catch(() => []),
      getBankingSnapshot(supabase, userId).catch(() => ({ accounts: [] })),
      getBusinessesWithBalances(supabase, userId).catch(() => []),
      getCities(supabase).catch(() => []),
    ]);

  const businessNamesById: Record<string, string> = {};
  for (const business of businesses) {
    businessNamesById[business.id] = business.name;
  }

  const cityNamesById: Record<string, string> = {};
  for (const city of cities) {
    cityNamesById[city.id] = city.name;
  }

  return {
    personalInventory,
    businessInventory,
    shippingQueue,
    accounts: accountsSnapshot.accounts ?? [],
    businesses,
    businessNamesById,
    cityNamesById,
  };
}

export async function loadEmployeesPageData(userId: string) {
  const supabase = createSupabaseServerClient();
  const [employees, summary, businesses] = await Promise.all([
    getPlayerEmployees(supabase, userId).catch(() => []),
    getEmployeeSummary(supabase, userId).catch(() => null),
    getBusinessesWithBalances(supabase, userId).catch(() => []),
  ]);

  return {
    employees,
    summary,
    businesses: businesses.map((business) => ({ id: business.id, name: business.name })),
  };
}

export async function loadContractsPageData(userId: string) {
  const supabase = createSupabaseServerClient();
  const [businesses, contracts] = await Promise.all([
    getBusinessesWithBalances(supabase, userId).catch(() => []),
    getContracts(supabase, userId).catch(() => []),
  ]);

  return { businesses, contracts };
}

export async function loadProductionPageData(userId: string) {
  const supabase = createSupabaseServerClient();
  const businesses = await getBusinessesWithBalances(supabase, userId).catch(() => []);
  const manufacturingBusinesses = businesses.filter((business) =>
    [
      "sawmill",
      "metalworking_factory",
      "food_processing_plant",
      "winery_distillery",
      "carpentry_workshop",
    ].includes(business.type)
  );
  const selectedBusinessId = manufacturingBusinesses[0]?.id ?? "";
  const manufacturing = selectedBusinessId
    ? await getManufacturingStatus(supabase, userId, selectedBusinessId).catch(() => null)
    : null;

  return {
    businesses,
    selectedBusinessId,
    manufacturing,
  };
}

export async function loadMarketPageData(userId: string) {
  const supabase = createSupabaseServerClient();
  const [businesses, listings, transactions, storefront] = await Promise.all([
    getBusinessesWithBalances(supabase, userId).catch(() => []),
    getMarketListings(supabase, userId).catch(() => []),
    getMarketTransactions(supabase, userId, 40).catch(() => []),
    getMarketStorefrontSettings(supabase, userId).catch(() => []),
  ]);

  return { businesses, listings, transactions, storefront };
}

export async function loadDashboardAnalytics(userId: string) {
  const supabase = createSupabaseServerClient();
  const player = await getPlayer(supabase, userId).catch(() => null);

  const [businessSummary, employeeSummary, storefrontSettings] = await Promise.all([
    getBusinessSummary(supabase, userId).catch(() => null),
    getEmployeeSummary(supabase, userId).catch(() => null),
    getMarketStorefrontSettings(supabase, userId).catch(() => []),
  ]);

  return { player, businessSummary, employeeSummary, storefrontSettings };
}
