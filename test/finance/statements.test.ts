import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { computeAccumulatedDepreciation, getBalanceSheet, getCashFlowStatement, getIncomeStatement } from "@/domains/businesses/statements";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getCityIds,
  playerClient,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

async function hireTempEmployee(client: TestClient, playerId: string, businessId: string) {
  const asPlayer = await playerClient(playerId);
  const { data, error } = await asPlayer.rpc("hire_employee_atomic", {
    p_player_id: playerId,
    p_business_id: businessId,
    p_first_name: "Test",
    p_last_name: "Worker",
    p_employee_type: "temp",
  });
  if (error) throw error;
  return (data as any).employee as { id: string; wage_per_hour: number };
}

async function chargeEmployeeWage(client: TestClient, employeeId: string, wageAmount: number) {
  const { data, error } = await client.rpc("charge_employee_wage_atomic", {
    p_employee_id: employeeId,
    p_wage_amount: wageAmount,
    p_charge_anchor_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data as { branch: "paid" | "unpaid"; employee: { id: string } };
}

// AccountingFixPlan items 47-49 (real financial statements) and item 54's own
// worked example: owner funding -> inventory purchase -> a storefront sale ->
// an unpayable payroll accrual -> later settlement, asserting the Balance
// Sheet, Income Statement, and Cash Flow Statement (and the invariants item
// 55 calls for: Assets = Liabilities + Equity, beginning + net cash flow =
// ending cash) hold at every step, not just at the end.
describe("real financial statements (AccountingFixPlan items 47-49, 54, 55)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "stmts");
    await ensurePersonalAccounts(client, playerId);
    businessId = await createTestBusiness(client, playerId, "general_store", cityId, "Statements");
  });

  it("step 1: owner contributes $10,000 -> $10,000 cash, $10,000 equity, $0 revenue", async () => {
    await fundBusinessFromOwner(client, playerId, businessId, 10_000);

    const income = await getIncomeStatement(client, { id: businessId });
    expect(income.revenue).toBe(0);
    expect(income.netIncome).toBe(0);

    const bs = await getBalanceSheet(client, { id: businessId, player_id: playerId });
    expect(bs.assets.cash).toBe(10_000);
    expect(bs.assets.inventory).toBe(0);
    expect(bs.equity.ownerCapital).toBe(10_000);
    expect(bs.equity.total).toBe(10_000);
    expect(bs.liabilities.total).toBe(0);
    expect(bs.assets.total).toBe(10_000);
    expect(bs.balanced).toBe(true);
  });

  it("step 2: buys 100 units landed at $21/unit ($2,100 total) -- an asset swap, equity unchanged", async () => {
    await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: "flour",
      quality: 40,
      quantity: 100,
      reserved_quantity: 100,
      unit_cost: 21,
      total_cost: 2100,
    });
    await client
      .from("business_accounts")
      .insert({ business_id: businessId, amount: 2100, entry_type: "debit", category: "market_purchase", description: "Finance test: inventory purchase" });

    const bs = await getBalanceSheet(client, { id: businessId, player_id: playerId });
    expect(bs.assets.cash).toBe(7_900);
    expect(bs.assets.inventory).toBe(2_100);
    expect(bs.assets.total).toBe(10_000);
    expect(bs.equity.total).toBe(10_000);
    expect(bs.balanced).toBe(true);
  });

  it("step 3: sells 40 units at $35 -> $1,400 revenue, $840 COGS, $1,260 inventory remains", async () => {
    const { data: shelfRow } = await client
      .from("store_shelf_items")
      .insert({ owner_player_id: playerId, business_id: businessId, item_key: "flour", quality: 40, quantity: 40, unit_price: 35 })
      .select("id")
      .single();

    const { error } = await client.rpc("settle_store_inventory_sales_atomic", {
      p_sales: [
        {
          shelfItemId: (shelfRow as { id: string }).id,
          ownerPlayerId: playerId,
          businessId,
          itemKey: "flour",
          quality: 40,
          cityId,
          soldQty: 40,
          unitPrice: 35,
        },
      ],
    });
    expect(error).toBeNull();

    const income = await getIncomeStatement(client, { id: businessId });
    expect(income.revenue).toBe(1_400);
    expect(income.cogs).toBe(840);
    expect(income.grossProfit).toBe(560);
    expect(income.operatingExpenses.other).toBe(70); // 5% storefront fee
    expect(income.netIncome).toBe(490);

    const bs = await getBalanceSheet(client, { id: businessId, player_id: playerId });
    expect(bs.assets.inventory).toBe(1_260);
    expect(bs.assets.cash).toBe(9_230); // 7,900 + 1,400 - 70 fee
    expect(bs.equity.retainedEarnings).toBe(490);
    expect(bs.equity.total).toBe(10_490);
    expect(bs.assets.total).toBe(10_490);
    expect(bs.balanced).toBe(true);
  });

  it("step 4: payroll accrues $9,300 but can't be paid (cash is only $9,230) -- Wages Payable liability, no cash movement", async () => {
    const employee = await hireTempEmployee(client, playerId, businessId);
    const cashBefore = await getBusinessCashBalance(client, businessId);
    expect(cashBefore).toBe(9_230);

    const result = await chargeEmployeeWage(client, employee.id, 9_300);
    expect(result.branch).toBe("unpaid");

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore); // no cash moved

    const bs = await getBalanceSheet(client, { id: businessId, player_id: playerId });
    expect(bs.liabilities.wagesPayable).toBe(9_300);
    expect(bs.equity.retainedEarnings).toBe(round2(490 - 9_300));
    expect(bs.assets.total).toBe(bs.liabilities.total + bs.equity.total);
    expect(bs.balanced).toBe(true);

    function round2(n: number) {
      return Math.round((n + Number.EPSILON) * 100) / 100;
    }
  });

  it("step 5: owner contributes more cash and settles the wage without double-recognizing the expense", async () => {
    await fundBusinessFromOwner(client, playerId, businessId, 9_300);

    const asPlayer = await playerClient(playerId);
    const { data: employees } = await client.from("employees").select("id").eq("employer_business_id", businessId).eq("status", "unpaid");
    const employeeId = (employees as { id: string }[])[0].id;

    const { error } = await asPlayer.rpc("settle_employee_wages_atomic", { p_player_id: playerId, p_employee_id: employeeId });
    expect(error).toBeNull();

    const income = await getIncomeStatement(client, { id: businessId });
    // Net income unchanged by settlement -- the payroll expense was already
    // recognized at accrual (step 4); settling the liability is not a P&L event.
    expect(income.netIncome).toBe(-8_810);

    const bs = await getBalanceSheet(client, { id: businessId, player_id: playerId });
    expect(bs.liabilities.wagesPayable).toBe(0);
    expect(bs.assets.cash).toBe(9_230); // 9,230 + 9,300 contribution - 9,300 wage payment
    expect(bs.equity.ownerCapital).toBe(19_300);
    expect(bs.equity.retainedEarnings).toBe(-8_810);
    expect(bs.assets.total).toBe(10_490);
    expect(bs.equity.total).toBe(10_490);
    expect(bs.balanced).toBe(true);
  });

  it("cash flow statement: beginning + net == ending, and sections classify correctly", async () => {
    const cf = await getCashFlowStatement(client, { id: businessId });
    expect(cf.beginningCash).toBe(0);
    expect(cf.endingCash).toBe(9_230);
    expect(cf.reconciles).toBe(true);
    // Financing: $10,000 + $9,300 owner contributions = $19,300 in.
    expect(cf.financing).toBe(19_300);
    // Investing: no capital upgrades purchased in this scenario.
    expect(cf.investing).toBe(0);
    // Operating: -$2,100 inventory purchase + $1,400 sale - $70 fee - $9,300 wage settlement.
    expect(cf.operating).toBe(-10_070);
    expect(cf.netCashFlow).toBe(cf.operating + cf.investing + cf.financing);
  });
});

describe("straight-line depreciation (AccountingFixPlan items 46/47)", () => {
  it("depreciates a fixed asset evenly over its useful life, capped at cost", () => {
    const acquiredAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const rows = [{ cost: 6_000, acquiredAt }]; // 60-month useful life -> $100/month

    // 0 months elapsed: no depreciation yet.
    expect(computeAccumulatedDepreciation(rows, acquiredAt)).toBe(0);

    // 30 days (1 month) elapsed: ~$100.
    const after1Month = new Date("2026-01-31T00:00:00.000Z").toISOString();
    expect(computeAccumulatedDepreciation(rows, after1Month)).toBe(100);

    // 300 days (10 months) elapsed: ~$1,000.
    const after10Months = new Date("2026-10-28T00:00:00.000Z").toISOString();
    expect(computeAccumulatedDepreciation(rows, after10Months)).toBe(1_000);

    // Far beyond the useful life: capped at the original cost, never negative net book value.
    const wayLater = new Date("2040-01-01T00:00:00.000Z").toISOString();
    expect(computeAccumulatedDepreciation(rows, wayLater)).toBe(6_000);
  });

  it("a $0-cost row contributes no depreciation", () => {
    const rows = [{ cost: 0, acquiredAt: new Date("2026-01-01T00:00:00.000Z").toISOString() }];
    expect(computeAccumulatedDepreciation(rows, new Date("2030-01-01T00:00:00.000Z").toISOString())).toBe(0);
  });
});
