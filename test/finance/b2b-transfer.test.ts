import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { transferItems } from "@/domains/inventory/service";
import {
  createTestBusiness,
  createTestPlayer,
  expectJournalBalanced,
  fundBusinessFromOwner,
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

// AccountingFixPlan item 44 (B2B inventory transactions must be fully
// atomic). execute_inventory_transfer requires the CALLER to own BOTH the
// source and destination business (auth.uid() is checked against both) --
// this is the vertical-integration path for one player moving inventory
// between two of their OWN businesses (e.g. a mine feeding a metalworking
// factory), priced at an internal transfer price, not a marketplace trade
// between two different players (that's execute_market_purchase, covered in
// inventory-purchase.test.ts).
//
// Calls the real domain function transferItems. As of Phase E
// (migration 106), execute_inventory_transfer itself does the entire
// economic transaction in one transaction: source relief, the destination's
// weighted-average acquisition cost basis, cash movement, and every
// revenue/COGS/inventory financial event -- transferItems no longer performs
// any accounting after the RPC call.
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

    // AccountingFixPlan Phase G: execute_inventory_transfer's same-city B2B
    // branch now posts a balanced journal entry for both sides.
    const sellerJournal = await getJournalLines(client, sellerBusinessId);
    expectJournalBalanced(sellerJournal);
    expect(sellerJournal.find((l) => l.account_code === "cash" && l.debit === 100)).toBeDefined();
    expect(sellerJournal.find((l) => l.account_code === "revenue" && l.credit === 100)).toBeDefined();
    expect(sellerJournal.find((l) => l.account_code === "cogs" && l.debit === 60)).toBeDefined();
    expect(sellerJournal.find((l) => l.account_code === "inventory" && l.credit === 60)).toBeDefined();

    const buyerJournal = await getJournalLines(client, buyerBusinessId);
    expectJournalBalanced(buyerJournal);
    expect(buyerJournal.find((l) => l.account_code === "inventory" && l.debit === 100)).toBeDefined();
    expect(buyerJournal.find((l) => l.account_code === "cash" && l.credit === 100)).toBeDefined();
  });

  it("rejects a transfer the destination business can't afford, leaving the seller's inventory untouched", async () => {
    const [cityId2] = await getCityIds(client);
    const poorBuyerId = await createTestBusiness(client, ownerPlayerId, "carpentry_workshop", cityId2, "PoorBuyer");
    const asOwner = await playerClient(ownerPlayerId);

    const sellerRowsBefore = await getBusinessInventoryRows(client, sellerBusinessId, "iron_ore");

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

    // The affordability check runs before any inventory relief -- the
    // seller's row must be byte-for-byte unchanged, proving the rejection
    // happened before the transaction touched anything, not mid-write.
    const sellerRowsAfter = await getBusinessInventoryRows(client, sellerBusinessId, "iron_ore");
    expect(sellerRowsAfter).toEqual(sellerRowsBefore);
  });
});

// A cross-city B2B transfer: cash moves and revenue/COGS are recognized at
// dispatch (matching the pre-existing recognition timing -- item 43/44 don't
// mandate changing when revenue is recognized, only that whatever is
// recognized is atomic and correct), but the destination's inventory-in
// event and cost basis intentionally do NOT appear yet -- the goods are
// still in shipping_queue. Landed cost at arrival is AccountingFixPlan item
// 45 / Phase F, not this phase.
describe("B2B inventory transfer (cross-city): revenue/COGS recognized at dispatch", () => {
  let client: TestClient;
  let ownerPlayerId: string;
  let sellerBusinessId: string;
  let buyerBusinessId: string;
  let cityA: string;
  let cityB: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    const cityIds = await getCityIds(client);
    [cityA, cityB] = cityIds;

    ownerPlayerId = await createTestPlayer(client, "b2bship");
    await ensurePersonalAccounts(client, ownerPlayerId);
    sellerBusinessId = await createTestBusiness(client, ownerPlayerId, "mine", cityA, "B2BShipSeller");
    buyerBusinessId = await createTestBusiness(client, ownerPlayerId, "metalworking_factory", cityB, "B2BShipBuyer");
    await fundBusinessFromOwner(client, ownerPlayerId, buyerBusinessId, 5_000);

    await client.from("business_inventory").insert({
      owner_player_id: ownerPlayerId,
      business_id: sellerBusinessId,
      city_id: cityA,
      item_key: "iron_ore",
      quality: 40,
      quantity: 50,
      reserved_quantity: 0,
      unit_cost: 3,
      total_cost: 150,
    });
  });

  it("recognizes seller revenue/COGS immediately but defers the buyer's inventory event until arrival", async () => {
    const sellerCashBefore = await getBusinessCashBalance(client, sellerBusinessId);

    const asOwner = await playerClient(ownerPlayerId);
    const outcome = await transferItems(asOwner, ownerPlayerId, {
      sourceType: "business",
      sourceBusinessId: sellerBusinessId,
      sourceCityId: cityA,
      destinationType: "business",
      destinationBusinessId: buyerBusinessId,
      destinationCityId: cityB,
      itemKey: "iron_ore",
      quantity: 10,
      quality: 40,
      unitPrice: 5,
    });
    expect(outcome.transferType).toBe("shipping");

    const sellerCashAfter = await getBusinessCashBalance(client, sellerBusinessId);
    expect(sellerCashAfter).toBe(sellerCashBefore + 50);

    const sellerRows = await getBusinessInventoryRows(client, sellerBusinessId, "iron_ore");
    expect(Number(sellerRows[0].quantity)).toBe(40);
    expect(Number(sellerRows[0].total_cost)).toBe(120);

    const sellerEvents = await getFinancialEvents(client, sellerBusinessId);
    expect(sellerEvents.find((e) => e.account_code === "revenue")?.amount).toBe(50);
    expect(sellerEvents.find((e) => e.account_code === "cogs")?.amount).toBe(30);

    // Goods haven't arrived -- the buyer has no inventory row and no
    // inventory-transfer financial event yet.
    const buyerRows = await getBusinessInventoryRows(client, buyerBusinessId, "iron_ore");
    expect(buyerRows).toHaveLength(0);
    const buyerEvents = await getFinancialEvents(client, buyerBusinessId);
    expect(buyerEvents.filter((e) => e.reference_type === "inventory_transfer")).toHaveLength(0);

    // AccountingFixPlan Phase G: the source posts a balanced journal entry
    // at dispatch; the destination gets none yet (goods still in transit --
    // see migration 108's header comment for why that leg isn't journaled).
    const sellerJournal = await getJournalLines(client, sellerBusinessId);
    expectJournalBalanced(sellerJournal);
    expect(sellerJournal.find((l) => l.account_code === "cash" && l.debit === 50)).toBeDefined();
    expect(sellerJournal.find((l) => l.account_code === "revenue" && l.credit === 50)).toBeDefined();
    expect(sellerJournal.find((l) => l.account_code === "cogs" && l.debit === 30)).toBeDefined();

    const buyerJournal = await getJournalLines(client, buyerBusinessId);
    expect(buyerJournal).toHaveLength(0);
  });
});
