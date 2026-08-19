import { beforeAll, describe, expect, it } from "vitest";
import { INVENTORY_BASELINE_UNIT_COSTS } from "@/config/finance";
import { createTestBusiness, createTestPlayer, getBusinessInventoryRows, getCityIds, serviceRoleClient, type TestClient } from "./helpers";

// AccountingFixPlan item 42: "Remove the synthetic rule that assigns
// produced goods a cost based on something like a percentage of the NPC
// selling-price ceiling. A product's accounting cost must not depend on
// what NPCs might pay for it... For genuinely free natural-resource
// production where the game has no consumable production cost, zero
// material cost is more accounting-correct than inventing a market-derived
// cost."
//
// Per the AccountingFixPlan research, supabase/functions/tick-extraction's
// output-creation call currently passes
// p_unit_cost = NPC_PRICE_CEILINGS[outputItem] * 0.55 (the same formula as
// INVENTORY_BASELINE_UNIT_COSTS in src/config/finance.ts) regardless of
// whether the extraction actually consumed anything. This test reproduces
// that exact call for a mine (which, per shared/economy.ts, consumes no
// input material at all -- only farms consume water) and demonstrates the
// resulting cost basis is derived from the sale-price model, which Phase D
// must fix.
describe("extraction cost basis (AccountingFixPlan item 42)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "extrcost");
    businessId = await createTestBusiness(client, playerId, "mine", cityId, "Extraction");
  });

  it("current behavior: a mine with zero consumed inputs still gets a nonzero, NPC-ceiling-derived cost basis", async () => {
    const baselineUnitCost = INVENTORY_BASELINE_UNIT_COSTS.iron_ore;
    expect(baselineUnitCost).toBeGreaterThan(0);

    const { error } = await client.rpc("add_business_inventory_quantity", {
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_item_key: "iron_ore",
      p_quality: 40,
      p_quantity: 60,
      p_unit_cost: baselineUnitCost,
    });
    expect(error).toBeNull();

    const rows = await getBusinessInventoryRows(client, businessId, "iron_ore");
    expect(Number(rows[0].unit_cost)).toBe(baselineUnitCost);
    expect(Number(rows[0].total_cost)).toBe(baselineUnitCost * 60);
  });

  // AccountingFixPlan item 42's target: a mine consumed no material inputs
  // (no water, no seeds, nothing tracked in business_inventory was
  // relieved), so its output's accounting cost basis should be $0 --
  // independent of NPC_PRICE_CEILINGS entirely. Flip to it() once Phase D
  // stops passing a market-derived p_unit_cost for extraction with no
  // actual consumables.
  it.fails("output cost basis is independent of NPC selling price when nothing was consumed", async () => {
    const rows = await getBusinessInventoryRows(client, businessId, "iron_ore");
    // Any value tied to INVENTORY_BASELINE_UNIT_COSTS (which is derived from
    // NPC_PRICE_CEILINGS) fails this -- the target is 0 when no consumables
    // were tracked as relieved for this production.
    expect(Number(rows[0].unit_cost)).toBe(0);
  });
});
