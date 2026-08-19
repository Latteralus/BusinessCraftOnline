import { beforeAll, describe, expect, it } from "vitest";
import { fulfillContract } from "@/domains/contracts/service";
import {
  createTestBusiness,
  createTestPlayer,
  getBusinessCashBalance,
  getBusinessInventoryRows,
  getCityIds,
  getFinancialEvents,
  getLedgerEntries,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 43: "Contract fulfillment that pays the business
// must create revenue. It must also relieve the exact inventory cost of
// goods delivered." Exercises the real fulfillContract domain function
// (src/domains/contracts/service.ts), which is a sequential, multi-round-
// trip, unlocked orchestration as of this Phase A baseline (not a single
// atomic RPC like the settlement functions) -- see the AccountingFixPlan
// research notes for the concurrency risk that creates. This test covers
// the correctness of a single, non-concurrent fulfillment.
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
  });

  it("rejects fulfilling an already-fulfilled contract", async () => {
    await expect(fulfillContract(client, playerId, { contractId })).rejects.toThrow();
  });
});
