// @ts-nocheck
import { createServiceClientFromEnv, toNumber, writeTickRunLog } from "../_shared/tick-runtime.ts";

const WAGE_CHARGE_INTERVAL_MS = 60 * 60 * 1000;

function shouldCharge(lastChargedAt: string | null | undefined, nowMs: number): boolean {
  if (!lastChargedAt) return true;
  const lastMs = new Date(lastChargedAt).getTime();
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= WAGE_CHARGE_INTERVAL_MS;
}

Deno.serve(async () => {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  let supabase;

  try {
    supabase = createServiceClientFromEnv();

    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const { data: employeeRows, error: employeesError } = await supabase
      .from("employees")
      .select(
        "id, player_id, first_name, last_name, status, unpaid_wage_due, employer_business_id, wage_per_hour, last_wage_charged_at"
      )
      .order("created_at", { ascending: true });

    if (employeesError) throw employeesError;

    let employeesChecked = 0;
    let wagesCharged = 0;
    let totalWages = 0;
    let unpaidTransitions = 0;
    let skippedByInterval = 0;
    let skippedByStatus = 0;
    let skippedByEmployer = 0;

    for (const employee of employeeRows ?? []) {
      employeesChecked += 1;

      if (!shouldCharge(employee.last_wage_charged_at, nowMs)) {
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

      const wageAmount = Number(toNumber(employee.wage_per_hour).toFixed(2));
      if (wageAmount <= 0) {
        await supabase
          .from("employees")
          .update({ last_wage_charged_at: nowIso, updated_at: nowIso })
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
          .update({ last_wage_charged_at: nowIso, updated_at: nowIso })
          .eq("id", employee.id);

        wagesCharged += 1;
        totalWages += wageAmount;
        continue;
      }

      await supabase
        .from("employees")
        .update({
          status: "unpaid",
          unpaid_wage_due: Number((toNumber(employee.unpaid_wage_due) + wageAmount).toFixed(2)),
          unpaid_since: nowIso,
          last_unassigned_for_unpaid_at: nowIso,
          last_wage_charged_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", employee.id)
        .eq("player_id", employee.player_id);

      await supabase.from("employee_assignments").delete().eq("employee_id", employee.id);

      unpaidTransitions += 1;
    }

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-wages",
      employeesChecked,
      wagesCharged,
      totalWages: Number(totalWages.toFixed(2)),
      unpaidTransitions,
      skippedByInterval,
      skippedByStatus,
      skippedByEmployer,
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
      const logger = supabase ?? createServiceClientFromEnv();
      await writeTickRunLog(logger, {
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
  }
});