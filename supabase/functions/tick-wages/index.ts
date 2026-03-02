// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WAGE_CHARGE_INTERVAL_MS = 60 * 60 * 1000;

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function shouldCharge(lastChargedAt: string | null | undefined, nowMs: number): boolean {
  if (!lastChargedAt) return true;
  const lastMs = new Date(lastChargedAt).getTime();
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= WAGE_CHARGE_INTERVAL_MS;
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from("employee_assignments")
    .select("id, employee_id, business_id, wage_per_hour, last_wage_charged_at")
    .order("assigned_at", { ascending: true });

  if (assignmentsError) {
    return new Response(JSON.stringify({ ok: false, error: assignmentsError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let assignmentsChecked = 0;
  let wagesCharged = 0;
  let totalWages = 0;
  let unpaidTransitions = 0;
  let skippedByInterval = 0;
  let skippedByStatus = 0;
  let skippedByShift = 0;

  for (const assignment of assignmentRows ?? []) {
    assignmentsChecked += 1;

    if (!shouldCharge(assignment.last_wage_charged_at, nowMs)) {
      skippedByInterval += 1;
      continue;
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("id, player_id, first_name, last_name, status, shift_ends_at, unpaid_wage_due")
      .eq("id", assignment.employee_id)
      .maybeSingle();

    if (!employee || employee.status !== "assigned") {
      skippedByStatus += 1;
      continue;
    }

    const shiftEnded = !employee.shift_ends_at || new Date(employee.shift_ends_at).getTime() <= nowMs;
    if (shiftEnded) {
      skippedByShift += 1;
      continue;
    }

    const wageAmount = Number(toNumber(assignment.wage_per_hour).toFixed(2));
    if (wageAmount <= 0) {
      await supabase
        .from("employee_assignments")
        .update({ last_wage_charged_at: nowIso, updated_at: nowIso })
        .eq("id", assignment.id);
      continue;
    }

    const { data: balanceValue, error: balanceError } = await supabase.rpc("get_business_account_balance", {
      p_business_id: assignment.business_id,
    });

    if (balanceError) {
      continue;
    }

    const balance = toNumber(balanceValue);

    if (balance >= wageAmount) {
      const { error: debitError } = await supabase.from("business_accounts").insert({
        business_id: assignment.business_id,
        amount: wageAmount,
        entry_type: "debit",
        category: "wage_payment",
        reference_id: assignment.employee_id,
        description: `Wage payment: ${employee.first_name} ${employee.last_name}`,
      });

      if (debitError) continue;

      await supabase
        .from("employee_assignments")
        .update({ last_wage_charged_at: nowIso, updated_at: nowIso })
        .eq("id", assignment.id);

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
        shift_ends_at: null,
        updated_at: nowIso,
      })
      .eq("id", employee.id)
      .eq("player_id", employee.player_id);

    await supabase.from("employee_assignments").delete().eq("id", assignment.id);

    unpaidTransitions += 1;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      function: "tick-wages",
      assignmentsChecked,
      wagesCharged,
      totalWages: Number(totalWages.toFixed(2)),
      unpaidTransitions,
      skippedByInterval,
      skippedByStatus,
      skippedByShift,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});

