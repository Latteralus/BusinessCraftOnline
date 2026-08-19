import { beforeAll, describe, expect, it } from "vitest";
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

// AccountingFixPlan item 43: open-market NPC sale via
// settle_market_listing_npc_sale_atomic (used by tick-npc-market-purchases).
// Distinct fee rate from storefront sales: 3% (MARKET_TRANSACTION_FEE), not
// the 5% NPC_STOREFRONT_FEE -- "the seller's economics shouldn't change just
// because the buyer happened to be an NPC" (changelog 2026-08-15).
describe("open-market sale: NPC purchase via settle_market_listing_npc_sale_atomic", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;
  let listingId: string;
  let sourceInventoryId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "opnmkt");
    businessId = await createTestBusiness(client, playerId, "winery_distillery", cityId, "OpenMarket");

    const { data: invRow } = await client
      .from("business_inventory")
      .insert({
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "red_wine",
        quality: 40,
        quantity: 20,
        reserved_quantity: 20,
        unit_cost: 5,
        total_cost: 100,
      })
      .select("id")
      .single();
    sourceInventoryId = (invRow as { id: string }).id;

    const { data: listingRow } = await client
      .from("market_listings")
      .insert({
        owner_player_id: playerId,
        source_business_id: businessId,
        source_inventory_id: sourceInventoryId,
        source_type: "business",
        city_id: cityId,
        item_key: "red_wine",
        quality: 40,
        quantity: 20,
        reserved_quantity: 20,
        unit_price: 8,
        status: "active",
      })
      .select("id")
      .single();
    listingId = (listingRow as { id: string }).id;
  });

  it("recognizes $160 revenue, $100 COGS, and a 3% (not 5%) fee", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    const { data, error } = await client.rpc("settle_market_listing_npc_sale_atomic", {
      p_listing_id: listingId,
      p_sold_qty: 20,
      p_baseline_unit_cost: 0,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ gross: 160, fee: 4.8, net: 155.2 });

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore + 160 - 4.8);

    const ledger = await getLedgerEntries(client, businessId);
    expect(ledger.find((e) => e.category === "market_sale")).toMatchObject({ amount: 160, entry_type: "credit" });
    expect(ledger.find((e) => e.category === "market_fee")).toMatchObject({ amount: 4.8, entry_type: "debit" });

    const events = await getFinancialEvents(client, businessId);
    expect(events.find((e) => e.account_code === "revenue")?.amount).toBe(160);
    expect(events.find((e) => e.account_code === "cogs")?.amount).toBe(100);

    const inventoryRows = await getBusinessInventoryRows(client, businessId, "red_wine");
    expect(inventoryRows).toHaveLength(0);
  });
});
