import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCharacter, getOnlinePlayerPreviews, getPlayer } from "@/domains/auth-character";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import {
  type BankingLoanState,
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
import {
  type TravelState,
  canPurchaseBusiness,
  getActiveTravel,
  getCities,
  getCityById,
} from "@/domains/cities-travel";
import { getContracts } from "@/domains/contracts";
import { getEmployeeSummary, getPlayerEmployees } from "@/domains/employees";
import { getBusinessInventory, getPersonalInventory, getShippingQueue } from "@/domains/inventory";
import { getMarketListings, getMarketStorefrontSettings, getMarketTransactions } from "@/domains/market";
import { getManufacturingStatus } from "@/domains/production";
import { cache } from "react";

const getAuthedPageContext = cache(async () => {
  const supabase = await createSupabaseServerClient();
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
});

export async function requireAuthedPageContext() {
  return getAuthedPageContext();
}

const getBusinessesWithBalancesCached = cache(async (supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) =>
  getBusinessesWithBalances(supabase, userId).catch(() => [])
);

const getCitiesCached = cache(async (supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) =>
  getCities(supabase).catch(() => [])
);

const getBankingSnapshotCached = cache(async (supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) =>
  getBankingSnapshot(supabase, userId).catch(() => ({ accounts: [], activeLoan: null }))
);

const getStorefrontSettingsCached = cache(async (supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) =>
  getMarketStorefrontSettings(supabase, userId).catch(() => [])
);

export type AuthenticatedShellInitialData = {
  identity: {
    playerId: string;
    initials: string;
    firstName: string;
    lastName: string;
  };
  appShell: {
    playerCount: number;
    onlinePlayers: OnlinePlayerPreview[];
    notificationsCount: number;
  };
};

export async function loadAuthenticatedShellInitialData(): Promise<AuthenticatedShellInitialData> {
  const { supabase, user, character } = await requireAuthedPageContext();
  const [onlinePlayers, storefrontSettings] = await Promise.all([
    getOnlinePlayerPreviews(supabase, 300).catch(() => []),
    getStorefrontSettingsCached(supabase, user.id),
  ]);

  return {
    identity: {
      playerId: user.id,
      initials: `${character.first_name[0] ?? ""}${character.last_name[0] ?? ""}` || "··",
      firstName: character.first_name,
      lastName: character.last_name,
    },
    appShell: {
      playerCount: onlinePlayers.length,
      onlinePlayers,
      notificationsCount: storefrontSettings.filter((row: { is_ad_enabled: boolean }) => row.is_ad_enabled).length,
    },
  };
}

export async function loadBusinessesPageData() {
  const { supabase, user, character } = await requireAuthedPageContext();
  const [businesses, cities, activeTravel, canBuyBusiness, resolvedCurrentCity] = await Promise.all([
    getBusinessesWithBalancesCached(supabase, user.id),
    getCitiesCached(supabase),
    getActiveTravel(supabase, user.id).catch(() => null),
    canPurchaseBusiness(supabase, user.id).catch(() => false),
    character.current_city_id ? getCityById(supabase, character.current_city_id).catch(() => null) : Promise.resolve(null),
  ]);

  const travelState: TravelState = {
    currentCity: resolvedCurrentCity,
    activeTravel,
    canPurchaseBusiness: canBuyBusiness,
  };

  return {
    businesses,
    summary: summarizeBusinessesWithBalances(businesses),
    cities,
    travelState,
  };
}

export async function loadBankingPageData() {
  const { supabase, user, character } = await requireAuthedPageContext();
  const [snapshot, loanSummary, transactions, businesses] = await Promise.all([
    getBankingSnapshotCached(supabase, user.id),
    getLoanSummary(supabase, user.id, character.business_level).catch(() => null),
    getTransactionHistory(supabase, user.id, { limit: 30 }).catch(() => []),
    getBusinessesWithBalancesCached(supabase, user.id),
  ]);
  const loanData: BankingLoanState = {
    summary: loanSummary,
    maxLoanAvailable: calculateMaxLoanForBusinessLevel(character.business_level),
  };

  return {
    accounts: snapshot.accounts ?? [],
    loanData,
    transactions,
    businesses,
  };
}

export async function loadInventoryPageData() {
  const { supabase, user } = await requireAuthedPageContext();
  const [personalInventory, businessInventory, shippingQueue, accountsSnapshot, businesses, cities] =
    await Promise.all([
      getPersonalInventory(supabase, user.id).catch(() => []),
      getBusinessInventory(supabase, user.id).catch(() => []),
      getShippingQueue(supabase, user.id).catch(() => []),
      getBankingSnapshotCached(supabase, user.id),
      getBusinessesWithBalancesCached(supabase, user.id),
      getCitiesCached(supabase),
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

export async function loadEmployeesPageData() {
  const { supabase, user } = await requireAuthedPageContext();
  const [employees, summary, businesses] = await Promise.all([
    getPlayerEmployees(supabase, user.id).catch(() => []),
    getEmployeeSummary(supabase, user.id).catch(() => null),
    getBusinessesWithBalancesCached(supabase, user.id),
  ]);

  return {
    employees,
    summary,
    businesses: businesses.map((business) => ({ id: business.id, name: business.name })),
  };
}

export async function loadContractsPageData() {
  const { supabase, user } = await requireAuthedPageContext();
  const [businesses, contracts] = await Promise.all([
    getBusinessesWithBalancesCached(supabase, user.id),
    getContracts(supabase, user.id).catch(() => []),
  ]);

  return { businesses, contracts };
}

export async function loadProductionPageData() {
  const { supabase, user } = await requireAuthedPageContext();
  const businesses = await getBusinessesWithBalancesCached(supabase, user.id);
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
    ? await getManufacturingStatus(supabase, user.id, selectedBusinessId).catch(() => null)
    : null;

  return {
    businesses,
    selectedBusinessId,
    manufacturing,
  };
}

export async function loadMarketPageData() {
  const { supabase, user, character } = await requireAuthedPageContext();
  const [businesses, listings, transactions, personalInventory, businessInventory] = await Promise.all([
    getBusinessesWithBalancesCached(supabase, user.id),
    getMarketListings(supabase, user.id).catch(() => []),
    getMarketTransactions(supabase, user.id, 40, { buyerType: "player" }).catch(() => []),
    getPersonalInventory(supabase, user.id).catch(() => []),
    getBusinessInventory(supabase, user.id).catch(() => []),
  ]);

  return {
    businesses,
    listings,
    transactions,
    personalInventory,
    businessInventory,
    currentCityId: character.current_city_id ?? null,
  };
}

export async function loadDashboardAnalytics(userId: string) {
  const supabase = await createSupabaseServerClient();
  const player = await getPlayer(supabase, userId).catch(() => null);

  const [businessSummary, employeeSummary, storefrontSettings] = await Promise.all([
    getBusinessSummary(supabase, userId).catch(() => null),
    getEmployeeSummary(supabase, userId).catch(() => null),
    getMarketStorefrontSettings(supabase, userId).catch(() => []),
  ]);

  return { player, businessSummary, employeeSummary, storefrontSettings };
}
