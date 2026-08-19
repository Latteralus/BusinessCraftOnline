import { beforeAll, describe, expect, it } from "vitest";
import { fulfillContract } from "@/domains/contracts/service";
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
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 43: "Contract fulfillment that pays the business
// must create revenue. It must also relieve the exact inventory cost of
// goods delivered." Exercises the real fulfillContract domain function
// (src/domains/contracts/service.ts), which as of Phase E delegates the
// entire economic transaction to fulfill_contract_atomic (migration 106) --
// inventory relief, the cash credit, and every revenue/COGS/inventory
// financial event now happen in one database transaction instead of the
// four-plus separate, unlocked round trips this test originally covered at
// the Phase A baseline.
describe("contract fulfillment: fulfillContract", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;
  let contractId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "contract");
    businessId = await createTestBusiness(client, playerId, "carpentry_workshop", cityId, "Contract");

    await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: "chair",
      quality: 40,
      quantity: 30,
      reserved_quantity: 0,
      unit_cost: 4,
      total_cost: 120,
    });

    const { data: contractRow, error } = await client
      .from("contracts")
      .insert({
        owner_player_id: playerId,
        business_id: businessId,
        title: "Finance test chair contract",
        item_key: "chair",
        required_quantity: 30,
        unit_price: 10,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    contractId = (contractRow as { id: string }).id;
  });

  it("pays $300 revenue, recognizes $120 COGS, relieves inventory, and marks the contract fulfilled", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    const contract = await fulfillContract(client, playerId, { contractId });
    expect(contract.status).toBe("fulfilled");
    expect(contract.delivered_quantity).toBe(30);

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore + 300);

    const ledger = await getLedgerEntries(client, businessId);
    expect(ledger.find((e) => e.category === "contract_payout")).toMatchObject({ amount: 300, entry_type: "credit" });

    const events = await getFinancialEvents(client, businessId);
    expect(events.find((e) => e.account_code === "revenue" && e.reference_type === "contract")?.amount).toBe(300);
    expect(events.find((e) => e.account_code === "cogs" && e.reference_type === "contract")?.amount).toBe(120);
    expect(events.find((e) => e.account_code === "inventory" && e.reference_type === "contract")?.amount).toBe(120);

    const inventoryRows = await getBusinessInventoryRows(client, businessId, "chair");
    expect(inventoryRows).toHaveLength(0);

    // AccountingFixPlan Phase G: fulfill_contract_atomic now posts a
    // balanced journal entry (cash/revenue/cogs/inventory).
    const journal = await getJournalLines(client, businessId);
    expectJournalBalanced(journal);
    expect(journal.find((l) => l.account_code === "cash" && l.debit === 300)).toBeDefined();
    expect(journal.find((l) => l.account_code === "revenue" && l.credit === 300)).toBeDefined();
    expect(journal.find((l) => l.account_code === "cogs" && l.debit === 120)).toBeDefined();
    expect(journal.find((l) => l.account_code === "inventory" && l.credit === 120)).toBeDefined();
  });

  it("rejects fulfilling an already-fulfilled contract", async () => {
    await expect(fulfillContract(client, playerId, { contractId })).rejects.toThrow();
  });
});

// AccountingFixPlan item 43 / Phase E: proves fulfill_contract_atomic's
// insufficient-inventory path is a clean status transition, not a partial
// write -- no cash moves, no financial events are created, and no inventory
// is touched, even though the availability check and the (never-reached)
// consumption loop are separate steps inside the same function.
describe("contract fulfillment: insufficient inventory", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;
  let contractId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "contractshort");
    businessId = await createTestBusiness(client, playerId, "carpentry_workshop", cityId, "ContractShort");

    await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: "chair",
      quality: 40,
      quantity: 5,
      reserved_quantity: 0,
      unit_cost: 4,
      total_cost: 20,
    });

    const { data: contractRow, error } = await client
      .from("contracts")
      .insert({
        owner_player_id: playerId,
        business_id: businessId,
        title: "Finance test short chair contract",
        item_key: "chair",
        required_quantity: 30,
        unit_price: 10,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    contractId = (contractRow as { id: string }).id;
  });

  it("marks the contract in_progress and writes nothing else when inventory is short", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    await expect(fulfillContract(client, playerId, { contractId })).rejects.toThrow(
      "Not enough inventory to fulfill this contract."
    );

    const { data: contractRow, error } = await client
      .from("contracts")
      .select("status, delivered_quantity")
      .eq("id", contractId)
      .single();
    if (error) throw error;
    expect((contractRow as { status: string }).status).toBe("in_progress");
    expect((contractRow as { delivered_quantity: number }).delivered_quantity).toBe(0);

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore);

    const inventoryRows = await getBusinessInventoryRows(client, businessId, "chair");
    expect(inventoryRows).toHaveLength(1);
    expect(Number(inventoryRows[0].quantity)).toBe(5);
    expect(Number(inventoryRows[0].total_cost)).toBe(20);

    const events = await getFinancialEvents(client, businessId);
    expect(events).toHaveLength(0);

    const journal = await getJournalLines(client, businessId);
    expect(journal).toHaveLength(0);
  });
});
