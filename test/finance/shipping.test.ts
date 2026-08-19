import { beforeAll, describe, expect, it } from "vitest";
import { calculateShippingQuote } from "@/domains/cities-travel/topology";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { transferItems } from "@/domains/inventory/service";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getBusinessInventoryRows,
  getCityIds,
  getLedgerEntries,
  playerClient,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 45: "For inventory acquired by another business,
// freight-in should normally increase the buyer's inventory cost:
// Inventory acquisition cost = purchase price + attributable inbound
// freight." As of this Phase A baseline, execute_due_shipping_deliveries
// (migration 047) sets the delivered inventory's cost basis to
// declared_unit_price only -- the shipping fee is charged separately as a
// business_accounts `shipping_fee` debit (operating expense) on the
// destination business and never folds into the inventory's total_cost.
// That's the exact Phase F gap: freight is currently expensed, not
// capitalized.
describe("shipping: cross-city B2B transfer + delivery (execute_inventory_transfer + execute_due_shipping_deliveries)", () => {
  let client: TestClient;
  let ownerPlayerId: string;
  let sourceBusinessId: string;
  let destinationBusinessId: string;
  let sourceCityId: string;
  let destinationCityId: string;
  let shippingCost: number;
  let shippingQueueId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    const cityIds = await getCityIds(client);
    [sourceCityId, destinationCityId] = cityIds;

    ownerPlayerId = await createTestPlayer(client, "shiport");
    await ensurePersonalAccounts(client, ownerPlayerId);
    sourceBusinessId = await createTestBusiness(client, ownerPlayerId, "mine", sourceCityId, "ShipSource");
    destinationBusinessId = await createTestBusiness(client, ownerPlayerId, "metalworking_factory", destinationCityId, "ShipDest");
    await fundBusinessFromOwner(client, ownerPlayerId, destinationBusinessId, 5_000);

    await client.from("business_inventory").insert({
      owner_player_id: ownerPlayerId,
      business_id: sourceBusinessId,
      city_id: sourceCityId,
      item_key: "iron_ore",
      quality: 40,
      quantity: 50,
      reserved_quantity: 0,
      unit_cost: 3,
      total_cost: 150,
    });

    const { data: sourceCity } = await client.from("cities").select("*").eq("id", sourceCityId).single();
    const { data: destCity } = await client.from("cities").select("*").eq("id", destinationCityId).single();
    const quote = calculateShippingQuote(sourceCity as any, destCity as any, 10);
    shippingCost = quote.totalCost;
  });

  it("dispatch: charges purchase price + shipping fee separately, queues the shipment, does not deliver inventory yet", async () => {
    const destCashBefore = await getBusinessCashBalance(client, destinationBusinessId);

    const asOwner = await playerClient(ownerPlayerId);
    const outcome = await transferItems(asOwner, ownerPlayerId, {
      sourceType: "business",
      sourceBusinessId,
      sourceCityId,
      destinationType: "business",
      destinationBusinessId,
      destinationCityId,
      itemKey: "iron_ore",
      quantity: 10,
      quality: 40,
      unitPrice: 5,
    });
    expect(outcome.transferType).toBe("shipping");
    expect(outcome.shippingCost).toBe(shippingCost);
    expect(outcome.shippingQueueItem).not.toBeNull();
    shippingQueueId = outcome.shippingQueueItem!.id;

    const destCashAfter = await getBusinessCashBalance(client, destinationBusinessId);
    expect(destCashAfter).toBe(destCashBefore - 50 - shippingCost);

    const destLedger = await getLedgerEntries(client, destinationBusinessId);
    expect(destLedger.find((e) => e.category === "business_transfer_out")).toMatchObject({ amount: 50, entry_type: "debit" });
    expect(destLedger.find((e) => e.category === "shipping_fee")).toMatchObject({ amount: shippingCost, entry_type: "debit" });

    // No inventory has arrived at the destination yet -- it's in transit.
    const destRowsBeforeDelivery = await getBusinessInventoryRows(client, destinationBusinessId, "iron_ore");
    expect(destRowsBeforeDelivery).toHaveLength(0);

    const { data: queueRow } = await client.from("shipping_queue").select("status, declared_unit_price").eq("id", shippingQueueId).single();
    expect((queueRow as any).status).toBe("in_transit");
    expect(Number((queueRow as any).declared_unit_price)).toBe(5);
  });

  it("delivery: inventory arrives at the declared purchase price, WITHOUT the freight cost folded in (Phase F gap)", async () => {
    // Force the shipment to be due now instead of waiting out its real ETA.
    // arrives_at has a `>= dispatched_at` check constraint, so back-date it
    // to just after dispatch rather than to "now - 1s" (dispatched_at could
    // be later than that if this test runs within a second of dispatch).
    const { data: queueRowBefore } = await client.from("shipping_queue").select("dispatched_at").eq("id", shippingQueueId).single();
    const dueAt = (queueRowBefore as any).dispatched_at as string;
    const { error: updateError } = await client.from("shipping_queue").update({ arrives_at: dueAt }).eq("id", shippingQueueId);
    expect(updateError).toBeNull();

    const { data, error } = await client.rpc("execute_due_shipping_deliveries", { p_limit: 500 });
    expect(error).toBeNull();
    expect((data as any).deliveredBusiness).toBeGreaterThanOrEqual(1);

    const destRows = await getBusinessInventoryRows(client, destinationBusinessId, "iron_ore");
    expect(destRows).toHaveLength(1);
    expect(Number(destRows[0].quantity)).toBe(10);
    // Current (pre-Phase-F) behavior: cost basis is purchase price only.
    expect(Number(destRows[0].total_cost)).toBe(50);
  });

  // AccountingFixPlan item 45's target: total landed cost should be
  // purchase price + attributable inbound freight = $50 + shippingCost.
  it.fails("capitalizes inbound freight into the delivered inventory's cost basis", async () => {
    const destRows = await getBusinessInventoryRows(client, destinationBusinessId, "iron_ore");
    expect(Number(destRows[0].total_cost)).toBe(50 + shippingCost);
  });
});
