import { beforeAll, describe, expect, it } from "vitest";
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

// AccountingFixPlan item 43: storefront (NPC) sale via
// settle_store_inventory_sales_atomic (the batched RPC tick-npc-purchases
// actually calls). 40 units of flour at unit_cost $4 ($160 total_cost) on
// the shelf at $10/unit; an NPC buys all 40.
describe("storefront sale: NPC purchase via settle_store_inventory_sales_atomic", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;
  let shelfItemId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "store");
    businessId = await createTestBusiness(client, playerId, "general_store", cityId, "Store");

    await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: "flour",
      quality: 40,
      quantity: 40,
      reserved_quantity: 40,
      unit_cost: 4,
      total_cost: 160,
    });

    const { data: shelfRow, error } = await client
      .from("store_shelf_items")
      .insert({ owner_player_id: playerId, business_id: businessId, item_key: "flour", quality: 40, quantity: 40, unit_price: 10 })
      .select("id")
      .single();
    if (error) throw error;
    shelfItemId = (shelfRow as { id: string }).id;
  });

  it("recognizes $400 revenue, $160 COGS, a 5% storefront fee, and relieves inventory/shelf to zero", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    const { data, error } = await client.rpc("settle_store_inventory_sales_atomic", {
      p_sales: [
        {
          shelfItemId,
          ownerPlayerId: playerId,
          businessId,
          itemKey: "flour",
          quality: 40,
          cityId,
          businessName: "Test Store",
          soldQty: 40,
          unitPrice: 10,
        },
      ],
    });
    expect(error).toBeNull();
    expect((data as any[])[0]).toMatchObject({ ok: true, soldQty: 40, gross: 400, fee: 20, net: 380 });

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore + 400 - 20);

    const ledger = await getLedgerEntries(client, businessId);
    expect(ledger.find((e) => e.category === "npc_sale")).toMatchObject({ amount: 400, entry_type: "credit" });
    expect(ledger.find((e) => e.category === "market_fee")).toMatchObject({ amount: 20, entry_type: "debit" });

    const events = await getFinancialEvents(client, businessId);
    expect(events.find((e) => e.account_code === "revenue")?.amount).toBe(400);
    expect(events.find((e) => e.account_code === "cogs")?.amount).toBe(160);
    expect(events.find((e) => e.account_code === "inventory")?.amount).toBe(160);
    expect(events.find((e) => e.account_code === "operating_expense")?.amount).toBe(20);

    const inventoryRows = await getBusinessInventoryRows(client, businessId, "flour");
    expect(inventoryRows).toHaveLength(0);

    const { data: shelfAfter } = await client.from("store_shelf_items").select("id").eq("id", shelfItemId);
    expect(shelfAfter).toHaveLength(0);

    // AccountingFixPlan Phase G: settle_store_inventory_sales_atomic now also
    // posts a balanced journal entry (cash/revenue/cogs/inventory/market_fees).
    const journal = await getJournalLines(client, businessId);
    expectJournalBalanced(journal);
    expect(journal.find((l) => l.account_code === "cash" && l.debit === 400)).toBeDefined();
    expect(journal.find((l) => l.account_code === "revenue" && l.credit === 400)).toBeDefined();
    expect(journal.find((l) => l.account_code === "cogs" && l.debit === 160)).toBeDefined();
    expect(journal.find((l) => l.account_code === "inventory" && l.credit === 160)).toBeDefined();
    expect(journal.find((l) => l.account_code === "market_fees" && l.debit === 20)).toBeDefined();
    expect(journal.find((l) => l.account_code === "cash" && l.credit === 20)).toBeDefined();
  });

  it("clamps a sale to available backing inventory instead of aborting the whole batch (ok:false)", async () => {
    const { data } = await client.rpc("settle_store_inventory_sales_atomic", {
      p_sales: [
        {
          shelfItemId: "00000000-0000-0000-0000-000000000000",
          ownerPlayerId: playerId,
          businessId,
          itemKey: "flour",
          quality: 40,
          cityId,
          soldQty: 5,
          unitPrice: 10,
        },
      ],
    });
    expect((data as any[])[0]).toMatchObject({ ok: false, soldQty: 0 });
  });
});
