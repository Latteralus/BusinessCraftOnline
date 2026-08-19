import { beforeAll, describe, expect, it } from "vitest";
import { consumeBusinessInventoryCost } from "@/domains/businesses/financial-events";
import {
  createTestBusiness,
  createTestPlayer,
  getBusinessInventoryRows,
  getCityIds,
  getTotalInventoryCost,
  round2,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan items 40 & 41: inventory cost relief must be
// proportional weighted-average, and manufacturing's finished-goods cost
// must equal the exact consumed weighted-average cost of its inputs, with
// "no input cost remains duplicated after it has been transferred into
// finished goods."
//
// This drives the exact primitives tick-manufacturing/index.ts uses per the
// AccountingFixPlan research: consumeBusinessInventoryCost (also exported as
// consumeInventoryRowsCost, used for each consumed raw-material row) to
// relieve inputs, then add_business_inventory_quantity with
// p_unit_cost = totalInputCost / outputQty to create the finished good. This
// is not a full run of the tick-manufacturing edge function (Deno-only,
// stochastic-free but progress-accumulator-driven) -- it's the shared cost
// math the tick, and any future Phase C helper, must get right.
describe("manufacturing cost relief (2 iron_ore + 1 coal -> 1 iron_bar)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "mfgcost");
    businessId = await createTestBusiness(client, playerId, "metalworking_factory", cityId, "Manufacturing");

    await client.from("business_inventory").insert([
      {
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "iron_ore",
        quality: 40,
        quantity: 10,
        reserved_quantity: 0,
        unit_cost: 5,
        total_cost: 50,
      },
      {
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "coal",
        quality: 40,
        quantity: 5,
        reserved_quantity: 0,
        unit_cost: 3,
        total_cost: 15,
      },
    ]);
  });

  it("relieves exactly the consumed proportion of each input's cost, and finished-goods cost equals the sum consumed", async () => {
    const totalInventoryCostBefore = await getTotalInventoryCost(client, businessId);
    expect(totalInventoryCostBefore).toBe(65); // 50 + 15

    const ironOreConsumption = await consumeBusinessInventoryCost(client, playerId, businessId, "iron_ore", 2);
    expect(ironOreConsumption).toMatchObject({ totalCost: 10, quantityConsumed: 2, estimated: false });

    const coalConsumption = await consumeBusinessInventoryCost(client, playerId, businessId, "coal", 1);
    expect(coalConsumption).toMatchObject({ totalCost: 3, quantityConsumed: 1, estimated: false });

    const totalInputCost = round2(ironOreConsumption.totalCost + coalConsumption.totalCost);
    expect(totalInputCost).toBe(13);

    // Raw materials left 75% relieved proportionally, not all-or-nothing.
    const ironOreRows = await getBusinessInventoryRows(client, businessId, "iron_ore");
    expect(Number(ironOreRows[0].quantity)).toBe(8);
    expect(Number(ironOreRows[0].total_cost)).toBe(40);
    const coalRows = await getBusinessInventoryRows(client, businessId, "coal");
    expect(Number(coalRows[0].quantity)).toBe(4);
    expect(Number(coalRows[0].total_cost)).toBe(12);

    const outputQty = 1;
    const outputUnitCost = round2(totalInputCost / outputQty);
    const { error } = await client.rpc("add_business_inventory_quantity", {
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_item_key: "iron_bar",
      p_quality: 40,
      p_quantity: outputQty,
      p_unit_cost: outputUnitCost,
    });
    expect(error).toBeNull();

    const outputRows = await getBusinessInventoryRows(client, businessId, "iron_bar");
    expect(outputRows).toHaveLength(1);
    expect(Number(outputRows[0].total_cost)).toBe(13);

    // The critical invariant: total inventory valuation is unchanged by
    // production -- cost only moved from raw materials into finished goods,
    // none was created or destroyed.
    const totalInventoryCostAfter = await getTotalInventoryCost(client, businessId);
    expect(totalInventoryCostAfter).toBe(totalInventoryCostBefore);
  });
});

// AccountingFixPlan Phase D: tick-manufacturing now delegates the actual
// input-relief + output-creation step to the atomic RPC
// run_manufacturing_line_production instead of a plain unlocked
// SELECT-then-loop-of-.update()/.delete() calls (per the Phase A audit, the
// least atomic path in the codebase). This exercises that RPC directly,
// mirroring what the tick calls per manufacturing_lines job.
describe("run_manufacturing_line_production (AccountingFixPlan Phase D)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;
  let lineId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "mfgrpc");
    businessId = await createTestBusiness(client, playerId, "metalworking_factory", cityId, "Manufacturing");

    const { data: line, error: lineError } = await client
      .from("manufacturing_lines")
      .insert({ business_id: businessId, line_number: 1, status: "active" })
      .select("id")
      .single();
    if (lineError) throw lineError;
    lineId = (line as { id: string }).id;

    await client.from("business_inventory").insert([
      {
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "iron_ore",
        quality: 40,
        quantity: 10,
        reserved_quantity: 0,
        unit_cost: 5,
        total_cost: 50,
      },
      {
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "coal",
        quality: 40,
        quantity: 5,
        reserved_quantity: 0,
        unit_cost: 3,
        total_cost: 15,
      },
    ]);
  });

  it("atomically relieves inputs and creates finished goods with the exact consumed cost", async () => {
    const { data, error } = await client.rpc("run_manufacturing_line_production", {
      p_line_id: lineId,
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_inputs: [
        { itemKey: "iron_ore", quantity: 2 },
        { itemKey: "coal", quantity: 1 },
      ],
      p_output_item_key: "iron_bar",
      p_output_quality: 40,
      p_output_units: 1,
      p_next_input_progress: { iron_ore: 0, coal: 0 },
      p_next_output_progress: 0.5,
    });
    expect(error).toBeNull();
    expect((data as any).consumedCost).toBe(13);
    expect((data as any).outputUnitCost).toBe(13);

    const ironOreRows = await getBusinessInventoryRows(client, businessId, "iron_ore");
    expect(Number(ironOreRows[0].quantity)).toBe(8);
    expect(Number(ironOreRows[0].total_cost)).toBe(40);
    const coalRows = await getBusinessInventoryRows(client, businessId, "coal");
    expect(Number(coalRows[0].quantity)).toBe(4);
    expect(Number(coalRows[0].total_cost)).toBe(12);
    const ironBarRows = await getBusinessInventoryRows(client, businessId, "iron_bar");
    expect(ironBarRows).toHaveLength(1);
    expect(Number(ironBarRows[0].total_cost)).toBe(13);

    const { data: lineAfter } = await client
      .from("manufacturing_lines")
      .select("input_progress, output_progress, worker_assigned, pending_production_cost")
      .eq("id", lineId)
      .single();
    expect((lineAfter as any).worker_assigned).toBe(true);
    expect(Number((lineAfter as any).output_progress)).toBe(0.5);
    expect(Number((lineAfter as any).pending_production_cost)).toBe(0);
  });

  it("rolls back every already-relieved input when one input is short (all-or-nothing)", async () => {
    const { error } = await client.rpc("run_manufacturing_line_production", {
      p_line_id: lineId,
      p_owner_player_id: playerId,
      p_business_id: businessId,
      p_city_id: cityId,
      p_inputs: [
        { itemKey: "iron_ore", quantity: 2 },
        { itemKey: "coal", quantity: 999 },
      ],
      p_output_item_key: "iron_bar",
      p_output_quality: 40,
      p_output_units: 1,
      p_next_input_progress: { iron_ore: 0, coal: 0 },
      p_next_output_progress: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("insufficient_input:coal");

    // iron_ore must be untouched even though it was relieved first, inside
    // the same call, before the coal shortfall was discovered.
    const ironOreRows = await getBusinessInventoryRows(client, businessId, "iron_ore");
    expect(Number(ironOreRows[0].quantity)).toBe(8);
    expect(Number(ironOreRows[0].total_cost)).toBe(40);
  });
});
