import { beforeAll, describe, expect, it } from "vitest";
import { calculatePayrollCharge, WAGE_TICK_HOURS } from "../../shared/employees/payroll";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getCityIds,
  getFinancialEvents,
  getLedgerEntries,
  playerClient,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 39 ("Fix payroll first"): "When wages become
// earned, recognize the expense immediately. If there is enough cash: Debit
// Payroll Expense / Credit Cash. If there is not enough cash: Debit Payroll
// Expense / Credit Wages Payable... When unpaid wages are later settled:
// Debit Wages Payable / Credit Cash. Do not recognize payroll expense again
// when the liability is paid."
//
// This suite drives the exact wage-charge branch logic currently in
// supabase/functions/tick-wages/index.ts (mirrored inline below rather than
// invoked over HTTP, since it's a Deno edge function with no Node runtime
// here -- see runCurrentWageChargeLogic, which is a line-for-line port of
// that function's per-employee branch as of migration 095/commit f6a14fd).
// The point isn't to test my port of the tick; it's to test the real RPCs
// and tables that port calls (business_accounts insert, employees update,
// get_business_account_balance), which are exactly what the Deno function
// touches too.
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
  const employee = (data as any).employee as { id: string; wage_per_hour: number };

  // Mark them assigned -- tick-wages only charges assigned employees.
  const { error: assignError } = await client.from("employee_assignments").insert({
    employee_id: employee.id,
    business_id: businessId,
    role: "production",
    wage_per_hour: employee.wage_per_hour,
  });
  if (assignError) throw assignError;

  return employee;
}

/** Mirrors tick-wages/index.ts's single-employee branch for exactly one charge window. Returns what actually happened, not what should happen. */
async function runCurrentWageChargeLogic(client: TestClient, employeeId: string, businessId: string) {
  const { data: employeeRow, error } = await client
    .from("employees")
    .select("id, first_name, last_name, wage_per_hour, unpaid_wage_due")
    .eq("id", employeeId)
    .single();
  if (error) throw error;
  const employee = employeeRow as { id: string; first_name: string; last_name: string; wage_per_hour: number; unpaid_wage_due: number };

  const wageAmount = calculatePayrollCharge(Number(employee.wage_per_hour), 1);
  const balance = await getBusinessCashBalance(client, businessId);

  if (balance >= wageAmount) {
    const { error: insertError } = await client.from("business_accounts").insert({
      business_id: businessId,
      amount: wageAmount,
      entry_type: "debit",
      category: "wage_payment",
      reference_id: employee.id,
      description: `Wage payment: ${employee.first_name} ${employee.last_name}`,
    });
    if (insertError) throw insertError;
    return { branch: "paid" as const, wageAmount };
  }

  const { error: updateError } = await client
    .from("employees")
    .update({
      status: "unpaid",
      unpaid_wage_due: Number(employee.unpaid_wage_due) + wageAmount,
      unpaid_since: new Date().toISOString(),
    })
    .eq("id", employee.id);
  if (updateError) throw updateError;
  return { branch: "unpaid" as const, wageAmount };
}

describe("payroll (AccountingFixPlan item 39)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    const [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "payroll");
    await ensurePersonalAccounts(client, playerId);
    businessId = await createTestBusiness(client, playerId, "mine", cityId, "Payroll");
  });

  it("temp wage rate is $40/hr, so one 15-minute tick charges exactly $10.00", () => {
    expect(WAGE_TICK_HOURS).toBe(0.25);
    expect(calculatePayrollCharge(40, 1)).toBe(10);
  });

  it("payroll paid: sufficient cash charges wage_payment and debits exactly the tick amount", async () => {
    await fundBusinessFromOwner(client, playerId, businessId, 1_000);
    const employee = await hireTempEmployee(client, playerId, businessId);

    const before = await getBusinessCashBalance(client, businessId);
    const result = await runCurrentWageChargeLogic(client, employee.id, businessId);
    expect(result.branch).toBe("paid");
    expect(result.wageAmount).toBe(10);

    const after = await getBusinessCashBalance(client, businessId);
    expect(after).toBe(before - 10);

    const entries = await getLedgerEntries(client, businessId);
    const wageEntry = entries.find((e) => e.category === "wage_payment" && e.reference_id === employee.id);
    expect(wageEntry).toMatchObject({ amount: 10, entry_type: "debit" });
  });

  describe("payroll accrued but unpaid", () => {
    let employee: { id: string; wage_per_hour: number };
    let poorBusinessId: string;

    beforeAll(async () => {
      const [cityId] = await getCityIds(client);
      poorBusinessId = await createTestBusiness(client, playerId, "mine", cityId, "PayrollUnpaid");
      // Deliberately leave the business with $0 cash so the wage charge can't be paid.
      employee = await hireTempEmployee(client, playerId, poorBusinessId);
    });

    it("moves the employee to unpaid status with the correct amount owed", async () => {
      const result = await runCurrentWageChargeLogic(client, employee.id, poorBusinessId);
      expect(result.branch).toBe("unpaid");

      const { data } = await client.from("employees").select("status, unpaid_wage_due").eq("id", employee.id).single();
      expect((data as any).status).toBe("unpaid");
      expect(Number((data as any).unpaid_wage_due)).toBe(10);
    });

    // AccountingFixPlan item 39: earned-but-unpaid wages must still be
    // recognized as an expense the moment they're earned (Debit Payroll
    // Expense / Credit Wages Payable), not deferred until cash actually
    // moves. tick-wages currently writes nothing at all to
    // business_accounts or business_financial_events when it can't pay --
    // the liability accrues invisibly to every report. This is exactly the
    // bug Phase B fixes; it.fails() so this test flips to a normal
    // (passing) assertion once that phase lands, instead of silently
    // staying green on unfixed behavior.
    it.fails("recognizes a payroll expense at accrual time even though cash wasn't paid", async () => {
      const financialEvents = await getFinancialEvents(client, poorBusinessId);
      const accrualEvent = financialEvents.find((e) => e.account_code === "operating_expense" || e.account_code === "cogs");
      expect(accrualEvent, "expected some expense-recognizing financial event for the unpaid wage accrual").toBeDefined();
    });

    it("later settlement pays the liability without double-charging the expense", async () => {
      await fundBusinessFromOwner(client, playerId, poorBusinessId, 1_000);
      const cashBeforeSettlement = await getBusinessCashBalance(client, poorBusinessId);

      const asPlayer = await playerClient(playerId);
      const { data, error } = await asPlayer.rpc("settle_employee_wages_atomic", {
        p_player_id: playerId,
        p_employee_id: employee.id,
      });
      expect(error).toBeNull();
      expect((data as any).employee.status).toBe("available");
      expect(Number((data as any).employee.unpaid_wage_due)).toBe(0);

      const cashAfterSettlement = await getBusinessCashBalance(client, poorBusinessId);
      expect(cashAfterSettlement).toBe(cashBeforeSettlement - 10);

      const entries = await getLedgerEntries(client, poorBusinessId);
      const settlementEntries = entries.filter((e) => e.category === "employee_wage_settlement" && e.reference_id === employee.id);
      expect(settlementEntries).toHaveLength(1);
      expect(settlementEntries[0]).toMatchObject({ amount: 10, entry_type: "debit" });

      // Exactly one wage-related debit total across the employee's whole
      // lifecycle (the settlement) -- proves settlement doesn't also
      // re-charge a "wage_payment" entry on top of itself.
      const wagePaymentEntries = entries.filter((e) => e.category === "wage_payment" && e.reference_id === employee.id);
      expect(wagePaymentEntries).toHaveLength(0);
    });

    it("rejects settling wages that are already paid", async () => {
      const asPlayer = await playerClient(playerId);
      const { error } = await asPlayer.rpc("settle_employee_wages_atomic", {
        p_player_id: playerId,
        p_employee_id: employee.id,
      });
      expect(error).not.toBeNull();
    });
  });
});
