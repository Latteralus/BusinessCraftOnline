import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
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

// AccountingFixPlan item 43: player-to-player / B2B market purchase via
// execute_market_purchase (migration 088 -- fully atomic as of that
// migration). Seller starts with 100 units of iron_ore at a known weighted-
// average cost ($6/unit, $600 total), lists at $8/unit, buyer buys all 100.
describe("inventory purchase: business buys from another business's market listing", () => {
  let client: TestClient;
  let sellerPlayerId: string;
  let sellerBusinessId: string;
  let buyerPlayerId: string;
  let buyerBusinessId: string;
  let cityId: string;
  let sourceInventoryId: string;
  let listingId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);

    sellerPlayerId = await createTestPlayer(client, "invsell");
    await ensurePersonalAccounts(client, sellerPlayerId);
    sellerBusinessId = await createTestBusiness(client, sellerPlayerId, "mine", cityId, "Seller");

    buyerPlayerId = await createTestPlayer(client, "invbuy");
    await ensurePersonalAccounts(client, buyerPlayerId);
    buyerBusinessId = await createTestBusiness(client, buyerPlayerId, "metalworking_factory", cityId, "Buyer");
    await fundBusinessFromOwner(client, buyerPlayerId, buyerBusinessId, 5_000);

    const { data: invRow, error: invError } = await client
      .from("business_inventory")
      .insert({
        owner_player_id: sellerPlayerId,
        business_id: sellerBusinessId,
        city_id: cityId,
        item_key: "iron_ore",
        quality: 40,
        quantity: 100,
        reserved_quantity: 100,
        unit_cost: 6,
        total_cost: 600,
      })
      .select("id")
      .single();
    if (invError) throw invError;
    sourceInventoryId = (invRow as { id: string }).id;

    const { data: listingRow, error: listingError } = await client
      .from("market_listings")
      .insert({
        owner_player_id: sellerPlayerId,
        source_business_id: sellerBusinessId,
        source_inventory_id: sourceInventoryId,
        source_type: "business",
        city_id: cityId,
        item_key: "iron_ore",
        quality: 40,
        quantity: 100,
        reserved_quantity: 100,
        unit_price: 8,
        status: "active",
      })
      .select("id")
      .single();
    if (listingError) throw listingError;
    listingId = (listingRow as { id: string }).id;
  });

  it("moves exactly $800 cash, relieves the seller's $600 cost basis, and gives the buyer $800 inventory cost basis", async () => {
    const sellerCashBefore = await getBusinessCashBalance(client, sellerBusinessId);
    const buyerCashBefore = await getBusinessCashBalance(client, buyerBusinessId);

    const asBuyer = await playerClient(buyerPlayerId);
    const { error } = await asBuyer.rpc("execute_market_purchase", {
      p_listing_id: listingId,
      p_quantity: 100,
      p_buyer_business_id: buyerBusinessId,
    });
    expect(error).toBeNull();

    const buyerCashAfter = await getBusinessCashBalance(client, buyerBusinessId);
    expect(buyerCashAfter).toBe(buyerCashBefore - 800);

    const sellerCashAfter = await getBusinessCashBalance(client, sellerBusinessId);
    // +$800 revenue, -$24 fee (3% of 800) = net +$776
    expect(sellerCashAfter).toBe(sellerCashBefore + 800 - 24);

    const buyerRows = await getBusinessInventoryRows(client, buyerBusinessId, "iron_ore");
    expect(buyerRows).toHaveLength(1);
    expect(Number(buyerRows[0].quantity)).toBe(100);
    expect(Number(buyerRows[0].unit_cost)).toBe(8);
    expect(Number(buyerRows[0].total_cost)).toBe(800);

    const sellerRows = await getBusinessInventoryRows(client, sellerBusinessId, "iron_ore");
    expect(sellerRows).toHaveLength(0); // fully sold, row deleted

    const sellerLedger = await getLedgerEntries(client, sellerBusinessId);
    expect(sellerLedger.find((e) => e.category === "market_sale")).toMatchObject({ amount: 800, entry_type: "credit" });
    expect(sellerLedger.find((e) => e.category === "market_fee")).toMatchObject({ amount: 24, entry_type: "debit" });

    const buyerLedger = await getLedgerEntries(client, buyerBusinessId);
    expect(buyerLedger.find((e) => e.category === "market_purchase")).toMatchObject({ amount: 800, entry_type: "debit" });

    const sellerEvents = await getFinancialEvents(client, sellerBusinessId);
    expect(sellerEvents.find((e) => e.account_code === "revenue")?.amount).toBe(800);
    expect(sellerEvents.find((e) => e.account_code === "cogs")?.amount).toBe(600);
    expect(sellerEvents.find((e) => e.account_code === "inventory")?.amount).toBe(600);
    expect(sellerEvents.find((e) => e.account_code === "operating_expense")?.amount).toBe(24);

    const buyerEvents = await getFinancialEvents(client, buyerBusinessId);
    expect(buyerEvents.find((e) => e.account_code === "inventory")?.amount).toBe(800);
  });

  it("rejects buying your own listing", async () => {
    const { data: ownListing } = await client
      .from("market_listings")
      .insert({
        owner_player_id: sellerPlayerId,
        source_business_id: sellerBusinessId,
        source_type: "business",
        city_id: cityId,
        item_key: "coal",
        quality: 40,
        quantity: 10,
        unit_price: 4,
        status: "active",
      })
      .select("id")
      .single();

    const asSeller = await playerClient(sellerPlayerId);
    const { error } = await asSeller.rpc("execute_market_purchase", {
      p_listing_id: (ownListing as { id: string }).id,
      p_quantity: 10,
      p_buyer_business_id: sellerBusinessId,
    });
    expect(error).not.toBeNull();
  });
});
