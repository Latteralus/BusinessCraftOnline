import { ensureOwnedBusiness } from "@/domains/_shared/ownership";
import { createSupabaseServiceRoleClient } from "@/lib/supabase-service-role";
import type { QueryClient } from "@/lib/db/query-client";
import { toNumber } from "@/lib/core/number";
import {
  getActiveCityEvents,
  getCities,
  getCityEconomicState,
  getWorldEconomicState,
  type CityEvent,
} from "@/domains/cities-travel";
import { getStockpileStatus, projectCurrentStock } from "../../../shared/cities/stockpiles";
import type {
  AwardGovernmentContractInput,
  CityStockpile,
  DeliverGovernmentContractInput,
  GovernmentContract,
  GovernmentContractListFilter,
  GovernmentContractProvider,
  ProjectedCityStockpile,
} from "./types";

// Raw rows change at most every 5 minutes (tick-city-stockpiles' due sweep)
// or once/day (the government daily pass) -- a short warm-instance cache
// trades a small worst-case staleness window for avoiding a DB round trip on
// every read, same rationale as cities-travel's economic-state cache.
const STOCKPILES_CACHE_TTL_MS = 60 * 1000;
let stockpilesCache: { expiresAt: number; rows: CityStockpile[] } | null = null;

export async function getCityStockpiles(
  client: QueryClient,
  cityId?: string
): Promise<CityStockpile[]> {
  if (!stockpilesCache || stockpilesCache.expiresAt <= Date.now()) {
    const { data, error } = await client
      .from("city_stockpiles")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;
    stockpilesCache = {
      expiresAt: Date.now() + STOCKPILES_CACHE_TTL_MS,
      rows: (data as CityStockpile[]) ?? [],
    };
  }

  const rows = stockpilesCache.rows;
  return cityId ? rows.filter((row) => row.city_id === cityId) : rows;
}

function getActiveItemEventMultiplier(events: CityEvent[], itemKey: string): number {
  const modifierKey = `stockpile_${itemKey}`;
  return events.reduce((product, event) => {
    const value = event.modifiers[modifierKey];
    return typeof value === "number" ? product * value : product;
  }, 1);
}

// Composes cities-travel's public API (cities, city/world economic state,
// active city events) with the raw stockpile rows to project each
// stockpile's *current* effective stock at read time, without writing --
// mirrors materialize_city_stockpile_ids' SQL formula (migration 114) and
// shared/cities/stockpiles.ts's pure-TS version of the same math.
export async function getProjectedCityStockpiles(
  client: QueryClient,
  cityId?: string
): Promise<ProjectedCityStockpile[]> {
  const [stockpiles, cities, cityStates, worldState, cityEvents] = await Promise.all([
    getCityStockpiles(client, cityId),
    getCities(client),
    getCityEconomicState(client, cityId),
    getWorldEconomicState(client),
    getActiveCityEvents(client, cityId),
  ]);

  const cityById = new Map(cities.map((c) => [c.id, c]));
  const cityStateById = new Map(cityStates.map((s) => [s.city_id, s]));
  const eventsByCity = new Map<string, CityEvent[]>();
  for (const event of cityEvents) {
    const list = eventsByCity.get(event.city_id) ?? [];
    list.push(event);
    eventsByCity.set(event.city_id, list);
  }

  const nowIso = new Date().toISOString();

  return stockpiles.map((stockpile) => {
    const city = cityById.get(stockpile.city_id);
    const cityState = cityStateById.get(stockpile.city_id);
    const populationBaseline = city?.population_baseline ?? 0;
    const population = cityState?.population ?? populationBaseline;
    const populationScale = populationBaseline > 0 ? population / populationBaseline : 1;
    const activeItemEventMultiplier = getActiveItemEventMultiplier(
      eventsByCity.get(stockpile.city_id) ?? [],
      stockpile.item_key
    );

    const { currentStock } = projectCurrentStock({
      storedQuantity: stockpile.stored_quantity,
      lastMaterializedAtIso: stockpile.last_materialized_at,
      baseConsumptionPerHour: stockpile.base_consumption_per_hour,
      populationScale,
      cityMunicipalConsumptionIndex: cityState?.municipal_consumption_index ?? 1,
      worldMunicipalConsumptionIndex: worldState.municipal_consumption_index,
      activeItemEventMultiplier,
      nowIso,
    });

    return {
      ...stockpile,
      current_quantity: currentStock,
      status: getStockpileStatus(currentStock, stockpile.reorder_point, stockpile.critical_point),
    };
  });
}

// ---------------------------------------------------------------------------
// CityPlan Phase 4: government_contract_providers / government_contracts.
// See Documents/Plans/CityPlan.md ("Shared Government Contract Provider
// Model"). Mutation only via the security-definer RPCs from migration 119 --
// see DOMAIN.md's "Off Limits" section.
// ---------------------------------------------------------------------------

// Providers are effectively static (one per active city + one federal
// placeholder) -- same 5-minute-class warm-instance cache as cities-travel's
// getCities().
const PROVIDERS_CACHE_TTL_MS = 5 * 60 * 1000;
let providersCache: { expiresAt: number; rows: GovernmentContractProvider[] } | null = null;

export async function getGovernmentContractProviders(
  client: QueryClient,
  filter: { cityId?: string; providerType?: GovernmentContractProvider["provider_type"] } = {}
): Promise<GovernmentContractProvider[]> {
  if (!providersCache || providersCache.expiresAt <= Date.now()) {
    const { data, error } = await client
      .from("government_contract_providers")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;
    providersCache = {
      expiresAt: Date.now() + PROVIDERS_CACHE_TTL_MS,
      rows: (data as GovernmentContractProvider[]) ?? [],
    };
  }

  return providersCache.rows.filter(
    (row) =>
      (filter.cityId === undefined || row.city_id === filter.cityId) &&
      (filter.providerType === undefined || row.provider_type === filter.providerType)
  );
}

function normalizeGovernmentContract(row: GovernmentContract): GovernmentContract {
  return {
    ...row,
    quantity_requested: toNumber(row.quantity_requested),
    quantity_delivered: toNumber(row.quantity_delivered),
    unit_price: toNumber(row.unit_price),
    total_value: toNumber(row.total_value),
  };
}

// Bounded default, same reasoning as contracts.ts's CONTRACTS_DEFAULT_LIMIT
// (audit finding M1) -- covers both public "available contracts" browsing
// (status filter) and general listing.
const GOVERNMENT_CONTRACTS_DEFAULT_LIMIT = 500;

export async function getGovernmentContracts(
  client: QueryClient,
  filter: GovernmentContractListFilter = {}
): Promise<GovernmentContract[]> {
  let query = client
    .from("government_contracts")
    .select("*")
    .order("posted_at", { ascending: false })
    .limit(filter.limit ?? GOVERNMENT_CONTRACTS_DEFAULT_LIMIT);

  if (filter.cityId) query = query.eq("city_id", filter.cityId);
  if (filter.providerId) query = query.eq("provider_id", filter.providerId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.businessId) query = query.eq("awarded_business_id", filter.businessId);

  const { data, error } = await query;
  if (error) throw error;

  return ((data as GovernmentContract[]) ?? []).map(normalizeGovernmentContract);
}

export async function getGovernmentContractById(
  client: QueryClient,
  contractId: string
): Promise<GovernmentContract | null> {
  const { data, error } = await client
    .from("government_contracts")
    .select("*")
    .eq("id", contractId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return normalizeGovernmentContract(data as GovernmentContract);
}

// award_government_contract_atomic (migration 119) is authenticated-granted
// (like accept_contract_atomic) and checks auth.uid() = p_player_id itself --
// pure status transition + ownership check, no cash/inventory movement, so
// it's called with the caller's own session client rather than service-role.
export async function awardGovernmentContract(
  client: QueryClient,
  playerId: string,
  input: AwardGovernmentContractInput
): Promise<GovernmentContract> {
  const { data, error } = await client.rpc("award_government_contract_atomic", {
    p_player_id: playerId,
    p_business_id: input.businessId,
    p_contract_id: input.contractId,
  });

  if (error) throw error;

  const result = data as { ok: boolean; contract: GovernmentContract } | null;
  if (!result?.ok) throw new Error("Failed to award contract.");

  return normalizeGovernmentContract(result.contract);
}

// deliver_government_contract_atomic (migration 119) relieves inventory at
// >= the contract's minimum_quality, replenishes the destination
// city_stockpile, credits the payout, and writes financial events all in one
// transaction -- restricted to service_role like fulfill_contract_atomic
// (src/domains/contracts/service.ts's fulfillContract), so it's called with
// the service-role client rather than the caller's client.
export async function deliverGovernmentContract(
  client: QueryClient,
  playerId: string,
  input: DeliverGovernmentContractInput
): Promise<{ contract: GovernmentContract; delivered: number; payout: number }> {
  const contract = await getGovernmentContractById(client, input.contractId);
  if (!contract) throw new Error("Contract not found.");

  if (!contract.awarded_business_id) {
    throw new Error("Contract has not been awarded.");
  }

  await ensureOwnedBusiness(client, playerId, contract.awarded_business_id);

  const { data, error } = await createSupabaseServiceRoleClient().rpc("deliver_government_contract_atomic", {
    p_player_id: playerId,
    p_contract_id: input.contractId,
    p_quantity: input.quantity,
  });
  if (error) throw error;

  const result = data as
    | { ok: true; contract: GovernmentContract; delivered: number; payout: number }
    | { ok: false; reason: string }
    | null;

  if (!result?.ok) {
    const reason = result && "reason" in result ? result.reason : "unknown";
    if (reason === "wrong_city") {
      throw new Error("This business is not located in the contract's destination city.");
    }
    throw new Error("Not enough qualifying inventory to deliver against this contract.");
  }

  return {
    contract: normalizeGovernmentContract(result.contract),
    delivered: toNumber(result.delivered),
    payout: toNumber(result.payout),
  };
}
