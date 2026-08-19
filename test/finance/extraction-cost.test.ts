import { beforeAll, describe, expect, it } from "vitest";
import {
  createTestBusiness,
  createTestPlayer,
  getBusinessInventoryRows,
  getCityIds,
  round2,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 42: "Remove the synthetic rule that assigns
// produced goods a cost based on something like a percentage of the NPC
// selling-price ceiling. A product's accounting cost must not depend on
// what NPCs might pay for it... For genuinely free natural-resource
// production where the game has no consumable production cost, zero
// material cost is more accounting-correct than inventing a market-derived
// cost."
//
// Phase D replaced tick-extraction's inline NPC_PRICE_CEILINGS * 0.55 cost
// assignment (and the un-cost-tracked water consumption behind it) with the
// atomic RPC run_extraction_slot_production: it relieves a farm's water at
// its real weighted-average cost (never a price-derived guess) and gives
// the produced batch a cost basis equal to exactly what was consumed -- $0
// for a mine, which per shared/economy.ts consumes no tracked input at all.
// This is not a full run of the tick-extraction edge function (Deno-only) --
// it drives the same RPC the tick calls, exactly like manufacturing-cost.test.ts
// does for run_manufacturing_line_production.
describe("extraction cost basis (AccountingFixPlan item 42)", () => {
  let client: TestClient;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
  });

  async function createSlot(businessId: string, slotNumber = 1) {
    const { data, error } = await client
      .from("extraction_slots")
      .insert({ business_id: businessId, slot_number: slotNumber, status: "active" })
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  it("a mine with no consumed input gets a $0 cost basis, independent of NPC selling price", async () => {
    const playerId = await createTestPlayer(client, "minecost");
    const businessId = await createTestBusiness(client, playerId, "mine", cityId, "Extraction");
    const slotId = await createSlot(businessId);

    const { data, error } = await client.rpc("run_extraction_slot_production", {
      p_slot_id: slotId,
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_water_required: 0,
      p_next_input_progress: 0,
      p_output_item_key: "iron_ore",
      p_output_quality: 40,
      p_output_units: 60,
      p_next_output_progress: 0.25,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outputUnitCost: 0 });

    const rows = await getBusinessInventoryRows(client, businessId, "iron_ore");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].unit_cost)).toBe(0);
    expect(Number(rows[0].total_cost)).toBe(0);
    expect(Number(rows[0].quantity)).toBe(60);

    const { data: slotAfter } = await client
      .from("extraction_slots")
      .select("input_progress, output_progress, pending_production_cost")
      .eq("id", slotId)
      .single();
    expect(Number((slotAfter as any).output_progress)).toBe(0.25);
    expect(Number((slotAfter as any).pending_production_cost)).toBe(0);
  });

  it("a farm's output cost basis equals the exact weighted-average cost of water actually consumed", async () => {
    const playerId = await createTestPlayer(client, "farmcost");
    const businessId = await createTestBusiness(client, playerId, "farm", cityId, "Extraction");
    const slotId = await createSlot(businessId);

    await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: "water",
      quality: 40,
      quantity: 20,
      reserved_quantity: 0,
      unit_cost: 2,
      total_cost: 40,
    });

    const { data, error } = await client.rpc("run_extraction_slot_production", {
      p_slot_id: slotId,
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_water_required: 5,
      p_next_input_progress: 0,
      p_output_item_key: "wheat",
      p_output_quality: 40,
      p_output_units: 2,
      p_next_output_progress: 0,
    });
    expect(error).toBeNull();
    // 5 units of water @ $2 = $10 relieved, split across 2 produced units = $5/unit.
    expect((data as any).outputUnitCost).toBe(5);
    expect((data as any).waterRelieved).toBe(10);

    const waterRows = await getBusinessInventoryRows(client, businessId, "water");
    expect(waterRows).toHaveLength(1);
    expect(Number(waterRows[0].quantity)).toBe(15);
    expect(Number(waterRows[0].total_cost)).toBe(30);

    const wheatRows = await getBusinessInventoryRows(client, businessId, "wheat");
    expect(wheatRows).toHaveLength(1);
    expect(Number(wheatRows[0].quantity)).toBe(2);
    expect(Number(wheatRows[0].unit_cost)).toBe(5);
    expect(Number(wheatRows[0].total_cost)).toBe(10);

    // The invariant: total inventory valuation is unchanged by production --
    // cost only moved from water into the harvested wheat.
    const totalAfter = round2(
      Number(waterRows[0].total_cost) + Number(wheatRows[0].total_cost)
    );
    expect(totalAfter).toBe(40);
  });

  it("insufficient water rolls back atomically and leaves nothing partially consumed", async () => {
    const playerId = await createTestPlayer(client, "farmshort");
    const businessId = await createTestBusiness(client, playerId, "farm", cityId, "Extraction");
    const slotId = await createSlot(businessId);

    await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: "water",
      quality: 40,
      quantity: 3,
      reserved_quantity: 0,
      unit_cost: 2,
      total_cost: 6,
    });

    const { error } = await client.rpc("run_extraction_slot_production", {
      p_slot_id: slotId,
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_water_required: 5,
      p_next_input_progress: 0,
      p_output_item_key: "wheat",
      p_output_quality: 40,
      p_output_units: 1,
      p_next_output_progress: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("insufficient_input:water");

    const waterRows = await getBusinessInventoryRows(client, businessId, "water");
    expect(Number(waterRows[0].quantity)).toBe(3);
    expect(Number(waterRows[0].total_cost)).toBe(6);

    const wheatRows = await getBusinessInventoryRows(client, businessId, "wheat");
    expect(wheatRows).toHaveLength(0);
  });
});
