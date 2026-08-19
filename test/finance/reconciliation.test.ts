import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { getBalanceSheet } from "@/domains/businesses/statements";
import { getAllBusinessesReconciliation, getBusinessReconciliation } from "@/domains/businesses/reconciliation";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getCityIds,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan Phase H (item 53): reconcile_business_accounting +
// getBusinessReconciliation. A clean, fully-covered business (no buy-order
// fills, no in-transit B2B shipments -- the two documented journal/Balance
// Sheet gaps) should reconcile clean across every check.
describe("business reconciliation report (AccountingFixPlan item 53)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "recon");
    await ensurePersonalAccounts(client, playerId);
    businessId = await createTestBusiness(client, playerId, "general_store", cityId, "Reconciliation");
    await fundBusinessFromOwner(client, playerId, businessId, 5_000);
  });

  it("reports a clean business as fully reconciled", async () => {
    const report = await getBusinessReconciliation(client, { id: businessId, player_id: playerId });

    expect(report.cash.ok).toBe(true);
    expect(report.cash.storedBalance).toBe(5_000);
    expect(report.cash.ledgerBalance).toBe(5_000);
    expect(report.journal.ok).toBe(true);
    expect(report.journal.unbalancedEntryCount).toBe(0);
    expect(report.balanceSheet.balanced).toBe(true);
    expect(report.cashFlow.reconciles).toBe(true);
    expect(report.ok).toBe(true);
    // Journal discrepancy is a documented, expected-nonzero-in-general number
    // (buy-order fills / in-transit landed cost never post to the journal),
    // never folded into `ok` -- but for this business (no such activity) it
    // should read exactly balanced too.
    expect(report.journal.discrepancy).toBe(0);
  });

  it("never repairs a discrepancy -- a deliberately corrupted stored cash_balance is reported, not fixed", async () => {
    const { error } = await client.from("businesses").update({ cash_balance: 999_999 }).eq("id", businessId);
    expect(error).toBeNull();

    const report = await getBusinessReconciliation(client, { id: businessId, player_id: playerId });
    expect(report.cash.ok).toBe(false);
    expect(report.cash.storedBalance).toBe(999_999);
    expect(report.cash.ledgerBalance).toBe(5_000);
    expect(report.cash.discrepancy).toBe(5_000 - 999_999);
    expect(report.ok).toBe(false);

    const reportAgain = await getBusinessReconciliation(client, { id: businessId, player_id: playerId });
    expect(reportAgain.cash.storedBalance).toBe(999_999); // still not silently repaired

    // Restore for any later test/run relying on a sane balance.
    await client.from("businesses").update({ cash_balance: 5_000 }).eq("id", businessId);
  });

  it("getAllBusinessesReconciliation includes this business and reflects its state", async () => {
    const summary = await getAllBusinessesReconciliation(client);
    const mine = summary.reports.find((report) => report.businessId === businessId);
    expect(mine).toBeDefined();
    expect(mine?.ok).toBe(true);
    expect(summary.businessCount).toBeGreaterThanOrEqual(1);
    expect(summary.okCount).toBeGreaterThanOrEqual(1);
  });
});

// AccountingFixPlan Phase H (item 58): the two idempotent backfill functions,
// exercised directly against manually-inserted rows shaped like the
// pre-Phase-C / pre-Phase-F historical gaps they exist to repair (a fresh
// `supabase db reset` has no such rows of its own to backfill, so this is the
// only way to exercise the backfill logic itself, not just confirm it's a
// no-op on clean data).
describe("historical data backfill (AccountingFixPlan item 58)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;
  let cityId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "backfill");
    await ensurePersonalAccounts(client, playerId);
    businessId = await createTestBusiness(client, playerId, "general_store", cityId, "Backfill");
  });

  it("reconstructs total_cost for a legacy quantity>0/total_cost=NULL row from unit_cost, and zeroes it when unit_cost is also unknown", async () => {
    const { data: known, error: knownError } = await client
      .from("business_inventory")
      .insert({
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "flour",
        quality: 40,
        quantity: 50,
        unit_cost: 12,
        total_cost: null,
      })
      .select("id")
      .single();
    expect(knownError).toBeNull();

    const { data: unknown, error: unknownError } = await client
      .from("business_inventory")
      .insert({
        owner_player_id: playerId,
        business_id: businessId,
        city_id: cityId,
        item_key: "wood",
        quality: 40,
        quantity: 30,
        unit_cost: null,
        total_cost: null,
      })
      .select("id")
      .single();
    expect(unknownError).toBeNull();

    const { data: fixedCount, error: rpcError } = await client.rpc("backfill_reconstruct_inventory_cost_basis");
    expect(rpcError).toBeNull();
    expect(Number(fixedCount)).toBeGreaterThanOrEqual(2);

    const { data: rows } = await client
      .from("business_inventory")
      .select("id, unit_cost, total_cost")
      .in("id", [(known as { id: string }).id, (unknown as { id: string }).id]);
    const byId = Object.fromEntries((rows ?? []).map((row: any) => [row.id, row]));
    expect(Number(byId[(known as { id: string }).id].total_cost)).toBe(600); // 50 * 12
    expect(Number(byId[(unknown as { id: string }).id].unit_cost)).toBe(0);
    expect(Number(byId[(unknown as { id: string }).id].total_cost)).toBe(0);

    // Idempotent: a second run touches nothing more (every previously-null
    // row now has a non-null total_cost).
    const { data: secondRunCount } = await client.rpc("backfill_reconstruct_inventory_cost_basis");
    const { data: rowsAgain } = await client
      .from("business_inventory")
      .select("total_cost")
      .eq("id", (known as { id: string }).id)
      .single();
    expect(Number((rowsAgain as { total_cost: number }).total_cost)).toBe(600);
    expect(Number(secondRunCount)).toBe(0);
  });

  it("capitalizes a historical (pre-Phase-F) completed upgrade project with no fixed_assets event, and balances the sheet afterward", async () => {
    // A dedicated business, isolated from the previous test's leftover
    // inventory rows in this describe block's shared `businessId` -- this
    // test's assertions need a clean, fully-known asset base.
    const upgradeBusinessId = await createTestBusiness(client, playerId, "general_store", cityId, "Backfill Upgrade");
    await fundBusinessFromOwner(client, playerId, upgradeBusinessId, 5_000);

    const { data: project, error: projectError } = await client
      .from("business_upgrade_projects")
      .insert({
        business_id: upgradeBusinessId,
        upgrade_key: "worker_capacity",
        target_level: 1,
        project_status: "completed",
        quoted_cost: 2_000,
        started_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
        downtime_policy: "none",
      })
      .select("*")
      .single();
    expect(projectError).toBeNull();

    // Mirror what really happened historically: cash left the business, but
    // (pre-Phase-F) no fixed_assets financial event was ever written for it.
    await client
      .from("business_accounts")
      .insert({ business_id: upgradeBusinessId, amount: 2_000, entry_type: "debit", category: "upgrade_purchase", description: "Legacy upgrade purchase (no financial event)" });

    const beforeBackfill = await getBalanceSheet(client, { id: upgradeBusinessId, player_id: playerId });
    expect(beforeBackfill.assets.cash).toBe(3_000); // 5,000 - 2,000
    expect(beforeBackfill.assets.fixedAssetsNet).toBe(0); // no event yet -- the bug
    expect(beforeBackfill.balanced).toBe(false); // assets understated by exactly $2,000

    const { data: insertedCount, error: rpcError } = await client.rpc("backfill_capitalize_historical_upgrades");
    expect(rpcError).toBeNull();
    expect(Number(insertedCount)).toBeGreaterThanOrEqual(1);

    const { data: event } = await client
      .from("business_financial_events")
      .select("amount, account_code, reference_type, reference_id")
      .eq("business_id", upgradeBusinessId)
      .eq("account_code", "fixed_assets")
      .eq("reference_id", (project as { id: string }).id)
      .single();
    expect(event).toBeTruthy();
    expect(Number((event as { amount: number }).amount)).toBe(2_000);

    const afterBackfill = await getBalanceSheet(client, { id: upgradeBusinessId, player_id: playerId });
    expect(afterBackfill.assets.fixedAssetsGross).toBe(2_000);
    expect(afterBackfill.assets.total).toBe(5_000); // cash 3,000 + fixedAssetsNet ~2,000 (freshly acquired, ~$0 depreciated)
    expect(afterBackfill.balanced).toBe(true);

    // Idempotent: re-running does not double-insert the same project's event.
    const { data: secondRunCount } = await client.rpc("backfill_capitalize_historical_upgrades");
    const { data: eventsAfterSecondRun } = await client
      .from("business_financial_events")
      .select("id")
      .eq("business_id", upgradeBusinessId)
      .eq("account_code", "fixed_assets")
      .eq("reference_id", (project as { id: string }).id);
    expect(eventsAfterSecondRun?.length).toBe(1);
    // No other test in this suite creates an upgrade project bypassing
    // purchase_business_upgrade_atomic (which always writes its own
    // fixed_assets event in the same transaction), so this project is the
    // only uncovered one in the database and the second run has nothing left
    // to do.
    expect(Number(secondRunCount)).toBe(0);
  });
});
