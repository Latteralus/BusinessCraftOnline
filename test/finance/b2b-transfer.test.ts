import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { transferItems } from "@/domains/inventory/service";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getBusinessInventoryRows,
  getCityIds,
  getFinancialEvents,
  getLedgerEntries,
  playerClient,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 44 (B2B inventory transactions must be fully
// atomic). execute_inventory_transfer requires the CALLER to own BOTH the
// source and destination business (auth.uid() is checked against both) --
// this is the vertical-integration path for one player moving inventory
// between two of their OWN businesses (e.g. a mine feeding a metalworking
// factory), priced at an internal transfer price, not a marketplace trade
// between two different players (that's execute_market_purchase, covered in
// inventory-purchase.test.ts).
//
// Calls the real domain function transferItems -- the RPC relieves the
// source's cost basis atomically, but as of this Phase A baseline the
// destination's cost-basis update and ALL business_financial_events for the
// trade are written afterward by this same TS function in separate,
// unlocked round trips (see src/domains/inventory/service.ts:295-403 and
// migration 087's header comment, which says this explicitly). This test
// asserts the correct end result for the simple, non-concurrent case (which
// today's code does get right) -- it is not a concurrency test, which would
// be needed to actually observe the race this non-atomicity creates.
describe("B2B inventory transfer (same city, same owner): transferItems", () => {
  let client: TestClient;
  let ownerPlayerId: string;
  let sellerBusinessId: string;
  let buyerBusinessId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);

    ownerPlayerId = await createTestPlayer(client, "b2bown");
    await ensurePersonalAccounts(client, ownerPlayerId);
    sellerBusinessId = await createTestBusiness(client, ownerPlayerId, "mine", cityId, "B2BSeller");
    buyerBusinessId = await createTestBusiness(client, ownerPlayerId, "metalworking_factory", cityId, "B2BBuyer");
    await fundBusinessFromOwner(client, ownerPlayerId, buyerBusinessId, 5_000);

    await client.from("business_inventory").insert({
      owner_player_id: ownerPlayerId,
      business_id: sellerBusinessId,
      city_id: cityId,
      item_key: "iron_ore",
      quality: 40,
      quantity: 50,
      reserved_quantity: 0,
      unit_cost: 3,
      total_cost: 150,
    });
  });

  it("relieves the seller's cost basis, charges the buyer, and gives the buyer the correct acquisition cost", async () => {
    const sellerCashBefore = await getBusinessCashBalance(client, sellerBusinessId);
    const buyerCashBefore = await getBusinessCashBalance(client, buyerBusinessId);

    const asOwner = await playerClient(ownerPlayerId);
    const outcome = await transferItems(asOwner, ownerPlayerId, {
      sourceType: "business",
      sourceBusinessId: sellerBusinessId,
      sourceCityId: cityId,
      destinationType: "business",
      destinationBusinessId: buyerBusinessId,
      destinationCityId: cityId,
      itemKey: "iron_ore",
      quantity: 20,
      quality: 40,
      unitPrice: 5,
    });
    expect(outcome.transferType).toBe("same_city");

    // Buyer paid 20 * $5 = $100.
    const buyerCashAfter = await getBusinessCashBalance(client, buyerBusinessId);
    expect(buyerCashAfter).toBe(buyerCashBefore - 100);
    const sellerCashAfter = await getBusinessCashBalance(client, sellerBusinessId);
    expect(sellerCashAfter).toBe(sellerCashBefore + 100);

    // Seller relieved 20 units at their $3/unit weighted-average cost = $60; 30 units/$90 remain.
    const sellerRows = await getBusinessInventoryRows(client, sellerBusinessId, "iron_ore");
    expect(sellerRows).toHaveLength(1);
    expect(Number(sellerRows[0].quantity)).toBe(30);
    expect(Number(sellerRows[0].total_cost)).toBe(90);

    // Buyer's acquisition cost basis is the price they paid ($5/unit), not the seller's cost.
    const buyerRows = await getBusinessInventoryRows(client, buyerBusinessId, "iron_ore");
    expect(buyerRows).toHaveLength(1);
    expect(Number(buyerRows[0].quantity)).toBe(20);
    expect(Number(buyerRows[0].unit_cost)).toBe(5);
    expect(Number(buyerRows[0].total_cost)).toBe(100);

    const sellerLedger = await getLedgerEntries(client, sellerBusinessId);
    expect(sellerLedger.find((e) => e.category === "business_transfer_in")).toMatchObject({ amount: 100, entry_type: "credit" });
    const buyerLedger = await getLedgerEntries(client, buyerBusinessId);
    expect(buyerLedger.find((e) => e.category === "business_transfer_out")).toMatchObject({ amount: 100, entry_type: "debit" });

    const sellerEvents = await getFinancialEvents(client, sellerBusinessId);
    expect(sellerEvents.find((e) => e.account_code === "revenue")?.amount).toBe(100);
    expect(sellerEvents.find((e) => e.account_code === "cogs")?.amount).toBe(60);

    const buyerEvents = await getFinancialEvents(client, buyerBusinessId);
    expect(buyerEvents.find((e) => e.account_code === "inventory" && e.reference_type === "inventory_transfer")?.amount).toBe(100);
  });

  it("rejects a transfer the destination business can't afford", async () => {
    const [cityId2] = await getCityIds(client);
    const poorBuyerId = await createTestBusiness(client, ownerPlayerId, "carpentry_workshop", cityId2, "PoorBuyer");
    const asOwner = await playerClient(ownerPlayerId);

    await expect(
      transferItems(asOwner, ownerPlayerId, {
        sourceType: "business",
        sourceBusinessId: sellerBusinessId,
        sourceCityId: cityId,
        destinationType: "business",
        destinationBusinessId: poorBuyerId,
        destinationCityId: cityId2,
        itemKey: "iron_ore",
        quantity: 5,
        quality: 40,
        unitPrice: 5,
      })
    ).rejects.toThrow();
  });
});
