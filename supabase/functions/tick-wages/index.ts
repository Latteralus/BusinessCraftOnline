// @ts-nocheck
import { startTickRequest, toNumber, writeTickRunLog } from "../_shared/tick-runtime.ts";

const WAGE_CHARGE_INTERVAL_MINUTES = 15;
const WAGE_CHARGE_INTERVAL_MS = WAGE_CHARGE_INTERVAL_MINUTES * 60 * 1000;
const WAGE_CHARGE_INTERVAL_HOURS = WAGE_CHARGE_INTERVAL_MINUTES / 60;

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

    const { data: employeeRows, error: employeesError } = await supabase
      .from("employees")
      .select(
        "id, player_id, first_name, last_name, status, unpaid_wage_due, employer_business_id, wage_per_hour, last_wage_charged_at, created_at"
      )
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
      const wageAmount = Number((wagePerHour * chargeWindowCount * WAGE_CHARGE_INTERVAL_HOURS).toFixed(2));
      const chargeAnchorIso = getNextChargeAnchorIso(
        employee.last_wage_charged_at,
        employee.created_at,
        chargeWindowCount,
        nowIso
      );

      if (wagePerHour <= 0 || wageAmount <= 0) {
        await supabase
          .from("employees")
          .update({ last_wage_charged_at: chargeAnchorIso, updated_at: nowIso })
          .eq("id", employee.id);
        continue;
      }

      const { data: balanceValue, error: balanceError } = await supabase.rpc("get_business_account_balance", {
        p_business_id: employee.employer_business_id,
      });

      if (balanceError) continue;

      const balance = toNumber(balanceValue);

      if (balance >= wageAmount) {
        const { error: debitError } = await supabase.from("business_accounts").insert({
          business_id: employee.employer_business_id,
          amount: wageAmount,
          entry_type: "debit",
          category: "wage_payment",
          reference_id: employee.id,
          description: `Wage payment: ${employee.first_name} ${employee.last_name}`,
        });

        if (debitError) continue;

        await supabase
          .from("employees")
          .update({ last_wage_charged_at: chargeAnchorIso, updated_at: nowIso })
          .eq("id", employee.id);

        wagesCharged += 1;
        totalWages += wageAmount;
        totalHoursCharged += chargeWindowCount * WAGE_CHARGE_INTERVAL_HOURS;
        continue;
      }

      await supabase
        .from("employees")
        .update({
          status: "unpaid",
          unpaid_wage_due: Number((toNumber(employee.unpaid_wage_due) + wageAmount).toFixed(2)),
          unpaid_since: nowIso,
          last_unassigned_for_unpaid_at: nowIso,
          last_wage_charged_at: chargeAnchorIso,
          updated_at: nowIso,
        })
        .eq("id", employee.id)
        .eq("player_id", employee.player_id);

      await supabase.from("employee_assignments").delete().eq("employee_id", employee.id);
      await supabase
        .from("extraction_slots")
        .update({
          employee_id: null,
          status: "idle",
          updated_at: nowIso,
        })
        .eq("employee_id", employee.id);

      unpaidTransitions += 1;
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
