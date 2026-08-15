import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCharacter, getPlayer } from "@/domains/auth-character";
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
import { getMarketBuyOrders, getMarketListings, getMarketStorefrontSettings, getMarketTransactions } from "@/domains/market";
import { getManufacturingStatus } from "@/domains/production";
import { withTiming } from "@/lib/server-timing";
import {
  buildBankingPageData,
  buildBusinessesPageData,
  buildContractsPageData,
  buildEmployeesPageData,
  buildInventoryPageData,
  buildMarketPageData,
  buildProductionPageData,
} from "@/lib/page-data";
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
    unreadChatCount: number;
    unreadMailCount: number;
  };
};

export async function loadAuthenticatedShellInitialData(): Promise<AuthenticatedShellInitialData> {
  const { supabase, user, character } = await requireAuthedPageContext();

  return {
    identity: {
      playerId: user.id,
      initials: `${character.first_name[0] ?? ""}${character.last_name[0] ?? ""}` || "··",
      firstName: character.first_name,
      lastName: character.last_name,
    },
    appShell: {
      playerCount: 0,
      onlinePlayers: [],
      notificationsCount: 0,
      unreadChatCount: 0,
      unreadMailCount: 0,
    },
  };
}

export async function loadBusinessesPageData() {
  return withTiming("page-loader", "/businesses", async (timing) => {
    const { supabase, user, character } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const [businesses, cities, activeTravel, canBuyBusiness, resolvedCurrentCity] = await Promise.all([
      timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id)),
      timing.measure("cities", () => getCitiesCached(supabase)),
      timing.measure("active-travel", () => getActiveTravel(supabase, user.id).catch(() => null)),
      timing.measure("can-purchase-business", () => canPurchaseBusiness(supabase, user.id).catch(() => false)),
      character.current_city_id
        ? timing.measure("current-city", () => getCityById(supabase, character.current_city_id!).catch(() => null))
        : Promise.resolve(null),
    ]);

    const travelState: TravelState = {
      currentCity: resolvedCurrentCity,
      activeTravel,
      canPurchaseBusiness: canBuyBusiness,
    };

    return buildBusinessesPageData({ businesses, cities, travelState });
  });
}

export async function loadBankingPageData() {
  return withTiming("page-loader", "/banking", async (timing) => {
    const { supabase, user, character } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const [snapshot, loanSummary, transactions, businesses] = await Promise.all([
      timing.measure("banking-snapshot", () => getBankingSnapshotCached(supabase, user.id)),
      timing.measure("loan-summary", () => getLoanSummary(supabase, user.id, character.business_level).catch(() => null)),
      timing.measure("transaction-history", () => getTransactionHistory(supabase, user.id, { limit: 30 }).catch(() => [])),
      timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id)),
    ]);
    const loanData: BankingLoanState = {
      summary: loanSummary,
      maxLoanAvailable: calculateMaxLoanForBusinessLevel(character.business_level),
    };

    return buildBankingPageData({
      accounts: snapshot.accounts ?? [],
      loanData,
      transactions,
      businesses,
    });
  });
}

export async function loadInventoryPageData() {
  return withTiming("page-loader", "/inventory", async (timing) => {
    const { supabase, user } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const [personalInventory, businessInventory, shippingQueue, accountsSnapshot, businesses, cities] =
      await Promise.all([
        timing.measure("personal-inventory", () => getPersonalInventory(supabase, user.id).catch(() => [])),
        timing.measure("business-inventory", () => getBusinessInventory(supabase, user.id).catch(() => [])),
        timing.measure("shipping-queue", () => getShippingQueue(supabase, user.id).catch(() => [])),
        timing.measure("banking-snapshot", () => getBankingSnapshotCached(supabase, user.id)),
        timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id)),
        timing.measure("cities", () => getCitiesCached(supabase)),
      ]);

    return buildInventoryPageData({
      personalInventory,
      businessInventory,
      shippingQueue,
      accounts: accountsSnapshot.accounts ?? [],
      businesses,
      cities,
    });
  });
}

export async function loadEmployeesPageData() {
  return withTiming("page-loader", "/employees", async (timing) => {
    const { supabase, user } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const [employees, summary, businesses] = await Promise.all([
      timing.measure("employees", () => getPlayerEmployees(supabase, user.id).catch(() => [])),
      timing.measure("employee-summary", () => getEmployeeSummary(supabase, user.id).catch(() => null)),
      timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id)),
    ]);

    return buildEmployeesPageData({
      employees,
      summary,
      businesses,
    });
  });
}

export async function loadContractsPageData() {
  return withTiming("page-loader", "/contracts", async (timing) => {
    const { supabase, user } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const [businesses, contracts] = await Promise.all([
      timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id)),
      timing.measure("contracts", () => getContracts(supabase, user.id).catch(() => [])),
    ]);

    return buildContractsPageData({ businesses, contracts });
  });
}

export async function loadProductionPageData() {
  return withTiming("page-loader", "/production", async (timing) => {
    const { supabase, user } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const businesses = await timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id));
    const selectedBusinessId = buildProductionPageData({ businesses, manufacturing: null }).selectedBusinessId;
    const manufacturing = selectedBusinessId
      ? await timing.measure("manufacturing-status", () => getManufacturingStatus(supabase, user.id, selectedBusinessId).catch(() => null))
      : null;

    return buildProductionPageData({
      businesses,
      selectedBusinessId,
      manufacturing,
    });
  });
}

export async function loadMarketPageData() {
  return withTiming("page-loader", "/market", async (timing) => {
    const { supabase, user, character } = await timing.measure("auth-context", () => requireAuthedPageContext());
    const marketLimit = 50;
    const [businesses, listingsWithLookahead, transactions, personalInventory, businessInventory, buyOrders] = await Promise.all([
      timing.measure("businesses-with-balances", () => getBusinessesWithBalancesCached(supabase, user.id)),
      timing.measure("market-listings", () => getMarketListings(supabase, user.id, { status: "active", limit: marketLimit + 1, offset: 0 }).catch(() => [])),
      timing.measure("market-transactions", () => getMarketTransactions(supabase, user.id, 40, { buyerType: "player" }).catch(() => [])),
      timing.measure("personal-inventory", () => getPersonalInventory(supabase, user.id).catch(() => [])),
      timing.measure("business-inventory", () => getBusinessInventory(supabase, user.id).catch(() => [])),
      timing.measure("market-buy-orders", () => getMarketBuyOrders(supabase, user.id, { status: "active", limit: marketLimit }).catch(() => [])),
    ]);
    const listings = listingsWithLookahead.slice(0, marketLimit);

    return buildMarketPageData({
      businesses,
      listings,
      transactions,
      personalInventory,
      businessInventory,
      buyOrders,
      currentCityId: character.current_city_id ?? null,
      page: {
        limit: marketLimit,
        offset: 0,
        hasMore: listingsWithLookahead.length > marketLimit,
      },
    });
  });
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
