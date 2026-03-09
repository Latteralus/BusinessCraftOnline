import {
  BUSINESS_UPGRADE_KEYS_BY_TYPE,
  STARTUP_COSTS,
  type BusinessEntityType,
  type BusinessType,
  type BusinessUpgradeKey,
} from "@/config/businesses";
import { canPurchaseBusiness } from "@/domains/cities-travel";
import { getUpgradePreviewForBusiness } from "@/domains/upgrades";
import { round2, toNumber } from "@/lib/core/number";
import { addHoursToNowIso, nowIso } from "@/lib/core/time";
import type {
  Business,
  BusinessAccountEntry,
  BusinessDetail,
  BusinessSummary,
  BusinessUpgrade,
  BusinessWithBalance,
  CreateBusinessInput,
  PurchaseUpgradeResult,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function normalizeBusiness(row: Business): Business {
  return {
    ...row,
    value: toNumber(row.value),
  };
}

function normalizeUpgrade(row: BusinessUpgrade): BusinessUpgrade {
  return {
    ...row,
    level: Number(row.level),
  };
}

function normalizeAccountEntry(row: BusinessAccountEntry): BusinessAccountEntry {
  return {
    ...row,
    amount: toNumber(row.amount),
  };
}

export async function getPlayerBusinesses(
  client: QueryClient,
  playerId: string,
  filters?: { type?: BusinessType; cityId?: string }
): Promise<Business[]> {
  let query = client
    .from("businesses")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });

  if (filters?.type) {
    query = query.eq("type", filters.type);
  }

  if (filters?.cityId) {
    query = query.eq("city_id", filters.cityId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data as Business[]) ?? []).map(normalizeBusiness);
}

export async function getBusinessById(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<Business | null> {
  const { data, error } = await client
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return normalizeBusiness(data as Business);
}

export async function getBusinessUpgrades(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<BusinessUpgrade[]> {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");

  const { data, error } = await client
    .from("business_upgrades")
    .select("*")
    .eq("business_id", businessId)
    .order("upgrade_key", { ascending: true });

  if (error) throw error;
  return ((data as BusinessUpgrade[]) ?? []).map(normalizeUpgrade);
}

export async function getBusinessBalance(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<number> {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");

  return getBusinessBalanceById(client, businessId);
}

async function getBusinessBalanceById(
  client: QueryClient,
  businessId: string
): Promise<number> {
  const { data, error } = await client.rpc("get_business_account_balance", {
    p_business_id: businessId,
  });

  if (error) throw error;
  return round2(toNumber(data));
}

export async function getBusinessesWithBalances(
  client: QueryClient,
  playerId: string,
  filters?: { type?: BusinessType; cityId?: string }
): Promise<BusinessWithBalance[]> {
  const businesses = await getPlayerBusinesses(client, playerId, filters);

  const withBalances = await Promise.all(
    businesses.map(async (business) => ({
      ...business,
      balance: await getBusinessBalanceById(client, business.id),
    }))
  );

  return withBalances;
}

export async function getBusinessDetail(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<BusinessDetail | null> {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) return null;

  const [balance, upgrades] = await Promise.all([
    getBusinessBalance(client, playerId, businessId),
    getBusinessUpgrades(client, playerId, businessId),
  ]);

  return {
    ...business,
    balance,
    upgrades,
  };
}

export async function createBusiness(
  client: QueryClient,
  playerId: string,
  currentCityId: string,
  input: CreateBusinessInput
): Promise<BusinessDetail> {
  if (currentCityId !== input.cityId) {
    throw new Error("You must be physically present in the target city to create a business.");
  }

  const purchaseAllowed = await canPurchaseBusiness(client, playerId);
  if (!purchaseAllowed) {
    throw new Error("Cannot create business while traveling.");
  }

  const startupCost = STARTUP_COSTS[input.type];
  const entityType: BusinessEntityType = input.entityType ?? "sole_proprietorship";

  const { data, error } = await client
    .from("businesses")
    .insert({
      player_id: playerId,
      name: input.name,
      type: input.type,
      city_id: input.cityId,
      entity_type: entityType,
      value: startupCost,
    })
    .select("*")
    .single();

  if (error) throw error;

  const business = normalizeBusiness(data as Business);

  const { error: openingCreditError } = await client.from("business_accounts").insert({
    business_id: business.id,
    amount: startupCost,
    entry_type: "credit",
    category: "opening_capital",
    description: `Opening capital benchmark for ${business.name}`,
  });

  if (openingCreditError) throw openingCreditError;

  const { error: startupDebitError } = await client.from("business_accounts").insert({
    business_id: business.id,
    amount: startupCost,
    entry_type: "debit",
    category: "startup_purchase",
    description: `Startup purchase cost for ${business.type}`,
  });

  if (startupDebitError) throw startupDebitError;

  return {
    ...business,
    balance: 0,
    upgrades: [],
  };
}

export async function addBusinessAccountEntry(
  client: QueryClient,
  playerId: string,
  businessId: string,
  entry: {
    amount: number;
    entryType: "credit" | "debit";
    category: string;
    description: string;
    referenceId?: string;
  }
): Promise<BusinessAccountEntry> {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");

  const { data, error } = await client
    .from("business_accounts")
    .insert({
      business_id: businessId,
      amount: entry.amount,
      entry_type: entry.entryType,
      category: entry.category,
      description: entry.description,
      reference_id: entry.referenceId ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeAccountEntry(data as BusinessAccountEntry);
}

export async function purchaseUpgrade(
  client: QueryClient,
  playerId: string,
  businessId: string,
  upgradeKey: BusinessUpgradeKey
): Promise<PurchaseUpgradeResult> {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");

  const allowedUpgrades = BUSINESS_UPGRADE_KEYS_BY_TYPE[business.type];
  if (!allowedUpgrades.includes(upgradeKey)) {
    throw new Error(`Upgrade '${upgradeKey}' is not available for business type '${business.type}'.`);
  }

  const existingUpgrades = await getBusinessUpgrades(client, playerId, businessId);
  const existing = existingUpgrades.find((row) => row.upgrade_key === upgradeKey) ?? null;
  const currentLevel = existing?.level ?? 0;
  const nextLevel = currentLevel + 1;

  const preview = await getUpgradePreviewForBusiness(client, business.type, {
    upgradeKey,
    currentLevel,
  });
  const upgradeCost = preview.nextCost;
  const currentBalance = await getBusinessBalance(client, playerId, businessId);

  if (currentBalance < upgradeCost) {
    throw new Error(
      `Insufficient business funds. Upgrade cost is $${upgradeCost.toFixed(2)} and balance is $${currentBalance.toFixed(2)}.`
    );
  }

  let upgradedRow: BusinessUpgrade;

  if (existing) {
    const { data, error } = await client
      .from("business_upgrades")
      .update({ level: nextLevel, purchased_at: nowIso(), updated_at: nowIso() })
      .eq("id", existing.id)
      .eq("business_id", businessId)
      .select("*")
      .single();

    if (error) throw error;
    upgradedRow = normalizeUpgrade(data as BusinessUpgrade);
  } else {
    const { data, error } = await client
      .from("business_upgrades")
      .insert({
        business_id: businessId,
        upgrade_key: upgradeKey,
        level: 1,
      })
      .select("*")
      .single();

    if (error) throw error;
    upgradedRow = normalizeUpgrade(data as BusinessUpgrade);
  }

  await addBusinessAccountEntry(client, playerId, businessId, {
    amount: upgradeCost,
    entryType: "debit",
    category: "upgrade_purchase",
    description: `Upgrade purchase: ${upgradeKey} Lv.${nextLevel}`,
    referenceId: upgradedRow.id,
  });

  const resultingBalance = await getBusinessBalance(client, playerId, businessId);

  return {
    businessId,
    upgrade: upgradedRow,
    debitedAmount: round2(upgradeCost),
    resultingBalance,
  };
}

export async function getBusinessFinanceSummary(
  client: QueryClient,
  playerId: string,
  businessId: string
) {
  const balance = await getBusinessBalance(client, playerId, businessId);

  const yesterday = addHoursToNowIso(-24);

  const [marketListingsRes, recentTransactionsRes] = await Promise.all([
    client
      .from("market_listings")
      .select("quantity, unit_price")
      .eq("source_business_id", businessId)
      .eq("status", "active"),
    client
      .from("market_transactions")
      .select("quantity, net_total")
      .eq("seller_business_id", businessId)
      .gte("created_at", yesterday)
  ]);

  let totalValueOnMarket = 0;
  if (marketListingsRes.data) {
    for (const listing of marketListingsRes.data) {
      totalValueOnMarket += Number(listing.quantity) * Number(listing.unit_price);
    }
  }

  let itemsSold24h = 0;
  let revenue24h = 0;
  if (recentTransactionsRes.data) {
    for (const tx of recentTransactionsRes.data) {
      itemsSold24h += Number(tx.quantity);
      revenue24h += Number(tx.net_total);
    }
  }

  return {
    balance,
    totalValueOnMarket,
    itemsSold24h,
    revenue24h
  };
}
export async function getBusinessSummary(
  client: QueryClient,
  playerId: string
): Promise<BusinessSummary> {
  const businesses = await getBusinessesWithBalances(client, playerId);
  return summarizeBusinessesWithBalances(businesses);
}

export function summarizeBusinessesWithBalances(
  businesses: BusinessWithBalance[]
): BusinessSummary {
  const totalBusinessBalance = businesses.reduce((sum, business) => sum + business.balance, 0);

  const producingTypesOwned = new Set(
    businesses
      .map((business) => business.type)
      .filter((type) => !["general_store", "specialty_store"].includes(type))
  ).size;

  const topBusiness =
    businesses.length > 0
      ? [...businesses].sort((a, b) => b.balance - a.balance || b.value - a.value)[0]
      : null;

  return {
    totalBusinesses: businesses.length,
    totalBusinessBalance: round2(totalBusinessBalance),
    producingTypesOwned,
    topBusiness,
  };
}
