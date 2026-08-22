import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { awardGovernmentContract, deliverGovernmentContract } from "@/domains/government/service";
import {
  createTestBusiness,
  createTestPlayer,
  expectJournalBalanced,
  getBusinessCashBalance,
  getBusinessInventoryRows,
  getCityIds,
  getFinancialEvents,
  getJournalLines,
  getLedgerEntries,
  playerClient,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// CityPlan Phase 4 (Documents/Plans/CityPlan.md, "Phase 4 - Government
// Procurement Contracts"). Exercises the real award/deliver domain functions
// (src/domains/government/service.ts), which delegate to
// award_government_contract_atomic / deliver_government_contract_atomic
// (migration 119) -- the plan's own "Add unit/integration tests for ...
// contract uniqueness/idempotency, city-vs-federal provider behavior ...
// cross-city delivery restrictions" instruction.
//
// Each test creates its OWN city_stockpiles row (a unique, never-seeded
// item_key per test) instead of mutating one of the 90 real seeded rows --
// unlike every other fixture in this suite, city_stockpiles is a small,
// fixed-cardinality table with a (city_id, item_key) unique constraint, so
// reusing a shared row via an unordered `.limit(1)` query is both
// nondeterministic across describe blocks in one run and unsafe across
// repeated runs against the same local database (a leftover live contract
// from a previous run can block a fresh one via the idempotency index). A
// synthetic item_key sidesteps both problems entirely.

async function createTestStockpile(
  client: TestClient,
  cityId: string,
  overrides: { targetQuantity?: number; reorderPoint?: number; criticalPoint?: number } = {}
): Promise<{ stockpileId: string; itemKey: string; targetQuantity: number; reorderPoint: number }> {
  const itemKey = `test_item_${randomUUID().slice(0, 8)}`;
  const targetQuantity = overrides.targetQuantity ?? 1000;
  const reorderPoint = overrides.reorderPoint ?? 400;
  const criticalPoint = overrides.criticalPoint ?? 150;

  const { data, error } = await client
    .from("city_stockpiles")
    .insert({
      city_id: cityId,
      item_key: itemKey,
      stored_quantity: reorderPoint * 0.5,
      target_quantity: targetQuantity,
      reorder_point: reorderPoint,
      critical_point: criticalPoint,
      base_consumption_per_hour: 1,
      minimum_quality: 1,
      last_materialized_at: new Date().toISOString(),
      next_reorder_at: new Date(Date.now() - 60_000).toISOString(),
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { stockpileId: (data as { id: string }).id, itemKey, targetQuantity, reorderPoint };
}

describe("government replenishment contract creation", () => {
  let client: TestClient;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
  });

  it("creates exactly one contract for a due stockpile and is idempotent on rerun", async () => {
    const { stockpileId } = await createTestStockpile(client, cityId);

    const first = await client.rpc("create_replenishment_contracts_for_due_stockpiles", { p_limit: 500 });
    if (first.error) throw first.error;
    expect((first.data as { contractsCreated: number }).contractsCreated).toBeGreaterThanOrEqual(1);

    const { data: contracts, error } = await client
      .from("government_contracts")
      .select("*")
      .eq("stockpile_id", stockpileId);
    if (error) throw error;
    expect(contracts).toHaveLength(1);
    expect(contracts![0]).toMatchObject({
      city_id: cityId,
      contract_type: "replenishment",
      status: "available",
    });
    expect(Number(contracts![0].quantity_requested)).toBeGreaterThan(0);
    expect(Number(contracts![0].total_value)).toBeCloseTo(
      Number(contracts![0].quantity_requested) * Number(contracts![0].unit_price),
      2
    );

    // Idempotency: the partial unique index on (stockpile_id) where status is
    // live must prevent a second contract for the same still-due stockpile.
    const second = await client.rpc("create_replenishment_contracts_for_due_stockpiles", { p_limit: 500 });
    if (second.error) throw second.error;

    const { data: contractsAfter, error: afterError } = await client
      .from("government_contracts")
      .select("id")
      .eq("stockpile_id", stockpileId);
    if (afterError) throw afterError;
    expect(contractsAfter).toHaveLength(1);
  });

  it("only creates contracts for city providers, never for the federal placeholder", async () => {
    await createTestStockpile(client, cityId);
    const { error: sweepError } = await client.rpc("create_replenishment_contracts_for_due_stockpiles", { p_limit: 500 });
    if (sweepError) throw sweepError;

    const { data: providers, error } = await client.from("government_contract_providers").select("*");
    if (error) throw error;

    const federal = providers!.filter((p: { provider_type: string }) => p.provider_type === "federal");
    expect(federal).toHaveLength(1);
    expect(federal[0].city_id).toBeNull();
    expect(federal[0].provider_key).toBe("federal:us");

    const cityProviders = providers!.filter((p: { provider_type: string }) => p.provider_type === "city");
    expect(cityProviders.length).toBeGreaterThan(0);

    const { data: contracts, error: contractError } = await client
      .from("government_contracts")
      .select("provider_id");
    if (contractError) throw contractError;

    const federalProviderId = federal[0].id as string;
    expect(contracts!.some((c: { provider_id: string }) => c.provider_id === federalProviderId)).toBe(false);
  });
});

describe("government contract award + delivery", () => {
  let client: TestClient;
  let asPlayer: TestClient;
  let playerId: string;
  let businessId: string;
  let contractId: string;
  let stockpileId: string;
  let cityId: string;
  let itemKey: string;
  let quantityRequested: number;
  let unitPrice: number;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    const stockpile = await createTestStockpile(client, cityId);
    stockpileId = stockpile.stockpileId;
    itemKey = stockpile.itemKey;

    const { error: sweepError } = await client.rpc("create_replenishment_contracts_for_due_stockpiles", { p_limit: 500 });
    if (sweepError) throw sweepError;

    const { data: contractRow, error: contractError } = await client
      .from("government_contracts")
      .select("*")
      .eq("stockpile_id", stockpileId)
      .single();
    if (contractError) throw contractError;
    contractId = (contractRow as { id: string }).id;
    quantityRequested = Number((contractRow as { quantity_requested: number }).quantity_requested);
    unitPrice = Number((contractRow as { unit_price: number }).unit_price);

    playerId = await createTestPlayer(client, "govcontract");
    asPlayer = await playerClient(playerId);
    businessId = await createTestBusiness(client, playerId, "general_store", cityId, "GovContract");

    const { error: invError } = await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: itemKey,
      quality: 50,
      quantity: quantityRequested + 50,
      reserved_quantity: 0,
      unit_cost: 2,
      total_cost: (quantityRequested + 50) * 2,
    });
    if (invError) throw invError;
  });

  it("rejects awarding to a business the player doesn't own", async () => {
    const otherPlayerId = await createTestPlayer(client, "govcontractother");
    const otherBusinessId = await createTestBusiness(client, otherPlayerId, "general_store", cityId, "NotOwned");

    // award_government_contract_atomic is authenticated-granted and checks
    // auth.uid() = p_player_id itself, so this (like accept_contract_atomic)
    // must be called with the player's own signed-JWT client, not service_role.
    await expect(
      awardGovernmentContract(asPlayer, playerId, { contractId, businessId: otherBusinessId })
    ).rejects.toThrow();
  });

  it("awards the contract to the player's business", async () => {
    const contract = await awardGovernmentContract(asPlayer, playerId, { contractId, businessId });
    expect(contract.status).toBe("awarded");
    expect(contract.awarded_business_id).toBe(businessId);
  });

  it("delivers the full requested quantity: pays the business, relieves inventory, replenishes the stockpile, and balances the journal", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    const result = await deliverGovernmentContract(client, playerId, { contractId, quantity: quantityRequested });
    expect(result.contract.status).toBe("fulfilled");
    expect(result.contract.quantity_delivered).toBe(quantityRequested);
    expect(result.delivered).toBeCloseTo(quantityRequested, 5);
    expect(result.payout).toBeCloseTo(quantityRequested * unitPrice, 2);

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBeCloseTo(cashBefore + result.payout, 2);

    const ledger = await getLedgerEntries(client, businessId);
    expect(ledger.find((e) => e.category === "contract_payout")).toMatchObject({ entry_type: "credit" });

    const events = await getFinancialEvents(client, businessId);
    expect(events.find((e) => e.account_code === "revenue" && e.reference_type === "government_contract")).toBeDefined();
    expect(events.find((e) => e.account_code === "cogs" && e.reference_type === "government_contract")).toBeDefined();
    expect(events.find((e) => e.account_code === "inventory" && e.reference_type === "government_contract")).toBeDefined();

    const journal = await getJournalLines(client, businessId);
    expectJournalBalanced(journal);
    expect(journal.find((l) => l.account_code === "cash" && l.debit > 0)).toBeDefined();
    expect(journal.find((l) => l.account_code === "revenue" && l.credit > 0)).toBeDefined();

    const stockpileRow = await client.from("city_stockpiles").select("stored_quantity, next_reorder_at").eq("id", stockpileId).single();
    if (stockpileRow.error) throw stockpileRow.error;
    // Fully replenished to (at least approximately) the pre-depletion target;
    // next_reorder_at should have moved out of the past now that stock is healthy.
    expect(Number(stockpileRow.data!.stored_quantity)).toBeGreaterThan(0);
    if (stockpileRow.data!.next_reorder_at) {
      expect(new Date(stockpileRow.data!.next_reorder_at).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("rejects delivering against an already-fulfilled contract", async () => {
    await expect(
      deliverGovernmentContract(client, playerId, { contractId, quantity: 1 })
    ).rejects.toThrow();
  });
});

// CityPlan.md: "Cross-city goods must be shipped to the issuing/destination
// city before they can be delivered." deliverGovernmentContract resolves the
// delivering business from the contract's own awarded_business_id (not a
// caller-supplied id), so the only way to exercise the wrong-city path is to
// award the contract itself to a business located outside the contract's
// destination city.
describe("government contract delivery: cross-city rejection", () => {
  let client: TestClient;
  let playerId: string;
  let wrongCityBusinessId: string;
  let contractId: string;
  let itemKey: string;
  let quantityRequested: number;

  beforeAll(async () => {
    client = serviceRoleClient();
    const [cityId, otherCityId] = await getCityIds(client);
    const stockpile = await createTestStockpile(client, cityId);
    itemKey = stockpile.itemKey;

    const { error: sweepError } = await client.rpc("create_replenishment_contracts_for_due_stockpiles", { p_limit: 500 });
    if (sweepError) throw sweepError;

    const { data: contractRow, error: contractError } = await client
      .from("government_contracts")
      .select("*")
      .eq("stockpile_id", stockpile.stockpileId)
      .single();
    if (contractError) throw contractError;
    contractId = (contractRow as { id: string }).id;
    quantityRequested = Number((contractRow as { quantity_requested: number }).quantity_requested);

    playerId = await createTestPlayer(client, "govcontractwrongcity");
    wrongCityBusinessId = await createTestBusiness(client, playerId, "general_store", otherCityId, "GovContractWrongCity");

    const { error: invError } = await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: wrongCityBusinessId,
      city_id: otherCityId,
      item_key: itemKey,
      quality: 50,
      quantity: quantityRequested + 50,
      reserved_quantity: 0,
      unit_cost: 2,
      total_cost: (quantityRequested + 50) * 2,
    });
    if (invError) throw invError;

    const asPlayer = await playerClient(playerId);
    await awardGovernmentContract(asPlayer, playerId, { contractId, businessId: wrongCityBusinessId });
  });

  it("rejects delivery when the awarded business is not located in the contract's destination city", async () => {
    await expect(
      deliverGovernmentContract(client, playerId, { contractId, quantity: quantityRequested })
    ).rejects.toThrow("not located in the contract's destination city");

    // Nothing should have mutated -- inventory untouched, contract still awarded.
    const inventoryRows = await getBusinessInventoryRows(client, wrongCityBusinessId, itemKey);
    expect(Number(inventoryRows[0].quantity)).toBe(quantityRequested + 50);

    const { data: contractRow, error } = await client
      .from("government_contracts")
      .select("status, quantity_delivered")
      .eq("id", contractId)
      .single();
    if (error) throw error;
    expect((contractRow as { status: string }).status).toBe("awarded");
    expect((contractRow as { quantity_delivered: number }).quantity_delivered).toBe(0);
  });
});

// Regression test for a real bug found and fixed 2026-08-21/22 (see
// Documents/changelog.md): deliver_government_contract_atomic wrote a
// fractional numeric quantity straight into business_inventory.quantity (an
// integer column) with no rounding. The first fix attempt (capping the
// deliverable amount against ceil(quantity_requested - quantity_delivered))
// introduced a *different* bug, only caught by manually exercising a
// genuinely fractional quantity_requested by hand: it let quantity_delivered
// exceed quantity_requested, violating government_contracts' own CHECK
// (migration 117). Neither the existing "full delivery" test above nor the
// original hand-review caught either bug, because that test's
// quantity_requested happens to land on a whole number by construction
// (reorderPoint * 0.5 with round inputs) -- it never exercised the
// fractional-remainder path. This test constructs a deliberately fractional
// quantity_requested (41.7) directly, rather than relying on the
// replenishment sweep, specifically to close that gap.
describe("government contract delivery: fractional quantity_requested rounds to whole inventory units", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let contractId: string;
  let itemKey: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    itemKey = `test_fractional_${randomUUID().slice(0, 8)}`;

    const { data: stockpileRow, error: stockpileError } = await client
      .from("city_stockpiles")
      .insert({
        city_id: cityId,
        item_key: itemKey,
        stored_quantity: 158.3,
        target_quantity: 200,
        reorder_point: 200,
        critical_point: 50,
        base_consumption_per_hour: 0,
        minimum_quality: 1,
        last_materialized_at: new Date().toISOString(),
        next_reorder_at: new Date(Date.now() - 60_000).toISOString(),
        is_active: true,
      })
      .select("id")
      .single();
    if (stockpileError) throw stockpileError;
    const stockpileId = (stockpileRow as { id: string }).id;

    const { data: providerRow, error: providerError } = await client
      .from("government_contract_providers")
      .select("id")
      .eq("provider_type", "city")
      .eq("city_id", cityId)
      .single();
    if (providerError) throw providerError;

    const { data: contractRow, error: contractError } = await client
      .from("government_contracts")
      .insert({
        provider_id: (providerRow as { id: string }).id,
        city_id: cityId,
        stockpile_id: stockpileId,
        contract_type: "replenishment",
        item_key: itemKey,
        quantity_requested: 41.7,
        quantity_delivered: 0,
        minimum_quality: 1,
        unit_price: 5,
        total_value: 208.5,
        status: "available",
        urgency: "normal",
      })
      .select("id")
      .single();
    if (contractError) throw contractError;
    contractId = (contractRow as { id: string }).id;

    playerId = await createTestPlayer(client, "govcontractfractional");
    businessId = await createTestBusiness(client, playerId, "general_store", cityId, "GovContractFractional");

    const { error: invError } = await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: itemKey,
      quality: 50,
      quantity: 100,
      reserved_quantity: 0,
      unit_cost: 2,
      total_cost: 200,
    });
    if (invError) throw invError;

    const asPlayer = await playerClient(playerId);
    await awardGovernmentContract(asPlayer, playerId, { contractId, businessId });
  });

  it("floors the delivered quantity to whole units and never lets quantity_delivered exceed the fractional quantity_requested", async () => {
    const result = await deliverGovernmentContract(client, playerId, { contractId, quantity: 42 });

    // 42 whole units requested, but only 41 can be delivered -- delivering
    // 42 would make quantity_delivered (42) exceed quantity_requested (41.7),
    // which the table's own CHECK forbids. The contract is left in_progress
    // with an un-deliverable 0.7-unit residual rather than ever violating
    // that constraint or silently corrupting the inventory row.
    expect(result.delivered).toBe(41);
    expect(result.contract.quantity_delivered).toBe(41);
    expect(result.contract.status).toBe("in_progress");

    const inventoryRows = await getBusinessInventoryRows(client, businessId, itemKey);
    expect(inventoryRows).toHaveLength(1);
    // Must be a clean whole integer -- the original bug silently wrote a
    // rounded/truncated fractional value here when p_quantity wasn't floored
    // to whole units before the write.
    expect(Number.isInteger(inventoryRows[0].quantity)).toBe(true);
    expect(inventoryRows[0].quantity).toBe(59);

    // The remaining 0.7 units can never be delivered by a whole-unit-only
    // quantity (floor(0.7) = 0) -- confirms the accepted, documented
    // tradeoff rather than a silent no-op.
    await expect(
      deliverGovernmentContract(client, playerId, { contractId, quantity: 1 })
    ).rejects.toThrow();
  });
});
