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
  getJournalLines,
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
// Phase B moved the wage-charge branch logic that used to live inline in
// supabase/functions/tick-wages/index.ts into a single atomic RPC,
// charge_employee_wage_atomic (migration 098), which the tick now calls.
// This suite calls that same RPC directly instead of re-implementing the
// tick's per-employee branch, so it's testing the real production code path,
// not a port of it.
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

async function chargeEmployeeWage(client: TestClient, employeeId: string, wageAmount: number) {
  const { data, error } = await client.rpc("charge_employee_wage_atomic", {
    p_employee_id: employeeId,
    p_wage_amount: wageAmount,
    p_charge_anchor_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data as { branch: "paid" | "unpaid"; employee: { id: string; status: string; unpaid_wage_due: number } };
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

  it("payroll paid: sufficient cash debits Payroll Expense/credits Cash, and posts a balanced journal entry", async () => {
    await fundBusinessFromOwner(client, playerId, businessId, 1_000);
    const employee = await hireTempEmployee(client, playerId, businessId);

    const before = await getBusinessCashBalance(client, businessId);
    const result = await chargeEmployeeWage(client, employee.id, 10);
    expect(result.branch).toBe("paid");

    const after = await getBusinessCashBalance(client, businessId);
    expect(after).toBe(before - 10);

    const entries = await getLedgerEntries(client, businessId);
    const wageEntry = entries.find((e) => e.category === "wage_payment" && e.reference_id === employee.id);
    expect(wageEntry).toMatchObject({ amount: 10, entry_type: "debit" });

    const financialEvents = await getFinancialEvents(client, businessId);
    const payrollEvent = financialEvents.find((e) => e.account_code === "payroll_expense" && e.reference_id === employee.id);
    expect(payrollEvent).toMatchObject({ amount: 10 });

    const journalLines = await getJournalLines(client, businessId);
    const wageJournalLines = journalLines.filter(
      (l) => (l.account_code === "payroll_expense" || l.account_code === "cash") && l.debit + l.credit === 10
    );
    const payrollDebit = wageJournalLines.find((l) => l.account_code === "payroll_expense");
    const cashCredit = wageJournalLines.find((l) => l.account_code === "cash");
    expect(payrollDebit).toMatchObject({ debit: 10, credit: 0 });
    expect(cashCredit).toMatchObject({ debit: 0, credit: 10 });
    expect(payrollDebit!.entry_id).toBe(cashCredit!.entry_id);
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

    it("recognizes a payroll expense at accrual time (Debit Payroll Expense / Credit Wages Payable), even though cash wasn't paid", async () => {
      const result = await chargeEmployeeWage(client, employee.id, 10);
      expect(result.branch).toBe("unpaid");
      expect(result.employee.status).toBe("unpaid");
      expect(Number(result.employee.unpaid_wage_due)).toBe(10);

      // No cash moved, so business_accounts must stay untouched for this event.
      const entries = await getLedgerEntries(client, poorBusinessId);
      expect(entries.find((e) => e.reference_id === employee.id)).toBeUndefined();

      const financialEvents = await getFinancialEvents(client, poorBusinessId);
      const accrualEvent = financialEvents.find((e) => e.account_code === "payroll_expense" && e.reference_id === employee.id);
      expect(accrualEvent, "expected a payroll_expense financial event for the unpaid wage accrual").toMatchObject({ amount: 10 });

      const journalLines = await getJournalLines(client, poorBusinessId);
      const accrualLines = journalLines.filter(
        (l) => (l.account_code === "payroll_expense" || l.account_code === "wages_payable") && l.debit + l.credit === 10
      );
      const payrollDebit = accrualLines.find((l) => l.account_code === "payroll_expense");
      const wagesPayableCredit = accrualLines.find((l) => l.account_code === "wages_payable");
      expect(payrollDebit).toMatchObject({ debit: 10, credit: 0 });
      expect(wagesPayableCredit).toMatchObject({ debit: 0, credit: 10 });
      expect(payrollDebit!.entry_id).toBe(wagesPayableCredit!.entry_id);
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

      // Exactly one wage-related cash debit total across the employee's whole
      // lifecycle (the settlement) -- proves settlement doesn't also
      // re-charge a "wage_payment" entry on top of itself.
      const wagePaymentEntries = entries.filter((e) => e.category === "wage_payment" && e.reference_id === employee.id);
      expect(wagePaymentEntries).toHaveLength(0);

      // Exactly one payroll_expense financial event across the whole
      // lifecycle (from the earlier accrual) -- proves settlement doesn't
      // recognize the expense a second time when the liability is paid.
      const financialEvents = await getFinancialEvents(client, poorBusinessId);
      const payrollExpenseEvents = financialEvents.filter((e) => e.account_code === "payroll_expense" && e.reference_id === employee.id);
      expect(payrollExpenseEvents).toHaveLength(1);

      const journalLines = await getJournalLines(client, poorBusinessId);
      const settlementLines = journalLines.filter(
        (l) => (l.account_code === "wages_payable" || l.account_code === "cash") && l.debit + l.credit === 10
      );
      const wagesPayableDebit = settlementLines.find((l) => l.account_code === "wages_payable" && l.debit === 10);
      const cashCredit = settlementLines.find((l) => l.account_code === "cash" && l.credit === 10);
      expect(wagesPayableDebit).toBeDefined();
      expect(cashCredit).toBeDefined();
      expect(wagesPayableDebit!.entry_id).toBe(cashCredit!.entry_id);

      // Accounting invariant: every journal entry for this business balances.
      const byEntry = new Map<string, { debit: number; credit: number }>();
      for (const line of journalLines) {
        const totals = byEntry.get(line.entry_id) ?? { debit: 0, credit: 0 };
        totals.debit += line.debit;
        totals.credit += line.credit;
        byEntry.set(line.entry_id, totals);
      }
      for (const totals of byEntry.values()) {
        expect(totals.debit).toBeCloseTo(totals.credit, 2);
      }
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
