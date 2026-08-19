// @ts-nocheck
import { startTickRequest, toNumber, writeTickRunLog } from "../_shared/tick-runtime.ts";
import { WAGE_TICK_HOURS, WAGE_TICK_MINUTES, calculatePayrollCharge } from "../_shared/payroll.ts";

const WAGE_CHARGE_INTERVAL_MINUTES = WAGE_TICK_MINUTES;
const WAGE_CHARGE_INTERVAL_MS = WAGE_CHARGE_INTERVAL_MINUTES * 60 * 1000;
const WAGE_CHARGE_INTERVAL_HOURS = WAGE_TICK_HOURS;

function readTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getChargeWindowCount(
  lastChargedAt: string | null | undefined,
  createdAt: string | null | undefined,
  nowMs: number
): number {
  const anchorMs = readTimestampMs(lastChargedAt) ?? readTimestampMs(createdAt);
  if (anchorMs === null) return 1;
  return Math.max(0, Math.floor((nowMs - anchorMs) / WAGE_CHARGE_INTERVAL_MS));
}

function getNextChargeAnchorIso(
  lastChargedAt: string | null | undefined,
  createdAt: string | null | undefined,
  windowsCharged: number,
  fallbackIso: string
): string {
  if (windowsCharged <= 0) return fallbackIso;

  const anchorMs = readTimestampMs(lastChargedAt) ?? readTimestampMs(createdAt);
  if (anchorMs === null) return fallbackIso;

  return new Date(anchorMs + windowsCharged * WAGE_CHARGE_INTERVAL_MS).toISOString();
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-wages");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    // Fired employees can never be charged again (no transition back out of
    // "fired"), so excluding them keeps this scan bounded by the current
    // workforce instead of every employee ever hired across the game's life.
    const { data: employeeRows, error: employeesError } = await supabase
      .from("employees")
      .select(
        "id, player_id, first_name, last_name, status, unpaid_wage_due, employer_business_id, wage_per_hour, last_wage_charged_at, created_at"
      )
      .neq("status", "fired")
      .order("created_at", { ascending: true });

    if (employeesError) throw employeesError;

    const { data: assignmentRows, error: assignmentError } = await supabase
      .from("employee_assignments")
      .select("employee_id");

    if (assignmentError) throw assignmentError;

    const assignedEmployeeIds = new Set((assignmentRows ?? []).map((row) => String(row.employee_id)));

    let employeesChecked = 0;
    let wagesCharged = 0;
    let totalWages = 0;
    let totalHoursCharged = 0;
    let unpaidTransitions = 0;
    let skippedByInterval = 0;
    let skippedByStatus = 0;
    let skippedByEmployer = 0;
    let skippedByAssignment = 0;

    for (const employee of employeeRows ?? []) {
      employeesChecked += 1;

      const chargeWindowCount = getChargeWindowCount(
        employee.last_wage_charged_at,
        employee.created_at,
        nowMs
      );
      if (chargeWindowCount <= 0) {
        skippedByInterval += 1;
        continue;
      }
      const chargeAnchorIso = getNextChargeAnchorIso(
        employee.last_wage_charged_at,
        employee.created_at,
        chargeWindowCount,
        nowIso
      );

      if (!employee || employee.status === "fired" || employee.status === "unpaid") {
        skippedByStatus += 1;
        continue;
      }

      if (!employee.employer_business_id) {
        skippedByEmployer += 1;
        continue;
      }

      if (!assignedEmployeeIds.has(String(employee.id))) {
        skippedByAssignment += 1;
        await supabase
          .from("employees")
          .update({ last_wage_charged_at: chargeAnchorIso, updated_at: nowIso })
          .eq("id", employee.id);
        continue;
      }

      const wagePerHour = Number(toNumber(employee.wage_per_hour).toFixed(2));
      const wageAmount = calculatePayrollCharge(wagePerHour, chargeWindowCount);

      if (wagePerHour <= 0 || wageAmount <= 0) {
        await supabase
          .from("employees")
          .update({ last_wage_charged_at: chargeAnchorIso, updated_at: nowIso })
          .eq("id", employee.id);
        continue;
      }

      // Delegates to a single atomic RPC (AccountingFixPlan Phase B) so the
      // cash debit / payroll_expense recognition / wages_payable accrual and
      // the employee status change all commit together -- previously this
      // branch wrote a plain business_accounts row (paid) or a multi-step,
      // non-atomic employees/employee_assignments/extraction_slots sequence
      // (unpaid) with zero accounting entries either way.
      const { data: chargeResult, error: chargeError } = await supabase.rpc("charge_employee_wage_atomic", {
        p_employee_id: employee.id,
        p_wage_amount: wageAmount,
        p_charge_anchor_at: chargeAnchorIso,
      });

      if (chargeError) continue;

      const branch = (chargeResult as { branch?: string } | null)?.branch;

      if (branch === "paid") {
        wagesCharged += 1;
        totalWages += wageAmount;
        totalHoursCharged += chargeWindowCount * WAGE_CHARGE_INTERVAL_HOURS;
      } else if (branch === "unpaid") {
        unpaidTransitions += 1;
      }
    }

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-wages",
      employeesChecked,
      wagesCharged,
      totalHoursCharged,
      totalWages: Number(totalWages.toFixed(2)),
      unpaidTransitions,
      skippedByInterval,
      skippedByStatus,
      skippedByEmployer,
      skippedByAssignment,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-wages",
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: employeesChecked,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-wages failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-wages",
        status: "error",
        startedAtIso,
        finishedAtIso,
        durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
        processedCount: 0,
        metrics: {},
        errorMessage: message,
      });
    } catch {
      // Ignore secondary log failures in error path.
    }

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await release();
  }
});
