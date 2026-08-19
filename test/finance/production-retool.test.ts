import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { ensureExtractionSlots, getManufacturingStatus, retoolExtractionSlot, retoolManufacturingLine } from "@/domains/production";
import { getBalanceSheet, getIncomeStatement } from "@/domains/businesses/statements";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getCityIds,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan Phase H (item 60, final audit): line retooling used to
// charge cash with zero business_financial_events coverage and no shared
// transaction (retool_extraction_slot_atomic / retool_manufacturing_line_atomic,
// migration 110). This proves the fix: the cost now shows up as a real
// operating expense on the Income Statement, and an unaffordable retool
// leaves everything -- cash and line/slot state alike -- untouched.
describe("production line retooling is accounted for and atomic (AccountingFixPlan item 60)", () => {
  let client: TestClient;
  let playerId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "retool");
    await ensurePersonalAccounts(client, playerId);
  });

  it("extraction slot retool: charges the cost as an operating expense, not an untracked cash debit", async () => {
    const businessId = await createTestBusiness(client, playerId, "mine", cityId, "Retool Extraction");
    await fundBusinessFromOwner(client, playerId, businessId, 1_000);
    const [slot] = await ensureExtractionSlots(client, playerId, businessId);

    const cashBefore = await getBusinessCashBalance(client, businessId);
    expect(cashBefore).toBe(1_000);

    const updated = await retoolExtractionSlot(client, playerId, { slotId: slot.id, itemKey: "copper_ore" });
    expect(updated.status).toBe("retooling");
    expect(updated.pending_item_key).toBe("copper_ore");

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(1_000 - 450); // EXTRACTION_RETOOL_COST_BY_BUSINESS.mine

    const income = await getIncomeStatement(client, { id: businessId });
    expect(income.operatingExpenses.other).toBe(450);
    expect(income.netIncome).toBe(-450);

    const { data: events } = await client
      .from("business_financial_events")
      .select("account_code, amount, reference_type, reference_id")
      .eq("business_id", businessId)
      .eq("reference_type", "line_retool");
    expect(events?.length).toBe(1);
    expect((events as any[])[0].account_code).toBe("operating_expense");
    expect(Number((events as any[])[0].amount)).toBe(450);
    expect((events as any[])[0].reference_id).toBe(slot.id);

    const bs = await getBalanceSheet(client, { id: businessId, player_id: playerId });
    expect(bs.balanced).toBe(true);
  });

  it("extraction slot retool: an unaffordable retool leaves cash and the slot completely untouched", async () => {
    const businessId = await createTestBusiness(client, playerId, "mine", cityId, "Retool Extraction Poor");
    await fundBusinessFromOwner(client, playerId, businessId, 100); // less than the $450 cost
    const [slot] = await ensureExtractionSlots(client, playerId, businessId);

    await expect(retoolExtractionSlot(client, playerId, { slotId: slot.id, itemKey: "copper_ore" })).rejects.toThrow(
      /Insufficient business funds/
    );

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(100);

    const { data: slotRow } = await client.from("extraction_slots").select("status, pending_item_key").eq("id", slot.id).single();
    expect((slotRow as any).status).not.toBe("retooling");
    expect((slotRow as any).pending_item_key).toBeNull();

    const { data: events } = await client
      .from("business_financial_events")
      .select("id")
      .eq("business_id", businessId)
      .eq("reference_type", "line_retool");
    expect(events?.length).toBe(0);
  });

  it("manufacturing line retool: charges the cost as an operating expense in the same transaction as the retool", async () => {
    const businessId = await createTestBusiness(client, playerId, "sawmill", cityId, "Retool Manufacturing");
    await fundBusinessFromOwner(client, playerId, businessId, 1_000);
    const status = await getManufacturingStatus(client, playerId, businessId);
    const [line] = status.lines;

    const updated = await retoolManufacturingLine(client, playerId, { lineId: line.id, recipeKey: "sawmill_planks" });
    expect(updated.status).toBe("retooling");
    expect(updated.pending_recipe_key).toBe("sawmill_planks");

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(1_000 - 300); // MANUFACTURING_RETOOL_COST_BY_BUSINESS.sawmill

    const { data: events } = await client
      .from("business_financial_events")
      .select("account_code, amount, reference_type, reference_id")
      .eq("business_id", businessId)
      .eq("reference_type", "line_retool");
    expect(events?.length).toBe(1);
    expect((events as any[])[0].account_code).toBe("operating_expense");
    expect(Number((events as any[])[0].amount)).toBe(300);
    expect((events as any[])[0].reference_id).toBe(line.id);

    const { data: journalLines } = await client
      .from("business_journal_lines")
      .select("account_code, debit, credit, entry_id")
      .eq("business_id", businessId);
    const byEntry = new Map<string, { debit: number; credit: number }>();
    for (const row of (journalLines as any[]) ?? []) {
      const bucket = byEntry.get(row.entry_id) ?? { debit: 0, credit: 0 };
      bucket.debit += Number(row.debit);
      bucket.credit += Number(row.credit);
      byEntry.set(row.entry_id, bucket);
    }
    expect(byEntry.size).toBeGreaterThanOrEqual(1);
    for (const totals of byEntry.values()) {
      expect(totals.debit).toBe(totals.credit);
    }
  });
});
