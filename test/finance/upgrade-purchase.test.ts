import { beforeAll, describe, expect, it } from "vitest";
import { purchaseUpgrade } from "@/domains/businesses/service";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getCityIds,
  getFinancialEvents,
  getLedgerEntries,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan item 46: "Stop treating every durable business upgrade
// as an immediate operating expense... Those should post Debit Fixed
// Assets / Credit Cash and appear under investing cash flow... project
// creation + cash payment + accounting must happen atomically."
describe("upgrade purchase (AccountingFixPlan item 46)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    const [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "upgpur");
    await ensurePersonalAccounts(client, playerId);
    businessId = await createTestBusiness(client, playerId, "mine", cityId, "Upgrade");
    await fundBusinessFromOwner(client, playerId, businessId, 10_000);
  });

  it("debits cash for the upgrade cost via upgrade_purchase", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    const result = await purchaseUpgrade(client, playerId, businessId, "extraction_efficiency");
    expect(result.debitedAmount).toBeGreaterThan(0);

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore - result.debitedAmount);

    const ledger = await getLedgerEntries(client, businessId);
    const upgradeEntry = ledger.find((e) => e.category === "upgrade_purchase");
    expect(upgradeEntry).toMatchObject({ amount: result.debitedAmount, entry_type: "debit" });
  });

  // Current (pre-Phase-F) behavior: purchasing a durable upgrade produces no
  // business_financial_events row at all -- it's purely a cash-ledger debit,
  // same treatment as a one-time consumable expense. There is no
  // fixed_assets balance-sheet line anywhere in the schema yet.
  it("currently records no financial event for the purchase (no capex/opex distinction exists yet)", async () => {
    const events = await getFinancialEvents(client, businessId);
    expect(events).toHaveLength(0);
  });

  // AccountingFixPlan item 46's target: a durable upgrade should capitalize
  // (Debit Fixed Assets / Credit Cash), not just decrement cash with no
  // balance-sheet trace. Flip this to a normal it() once Phase F wires
  // purchaseUpgrade to post a fixed_assets financial event / journal entry.
  it.fails("capitalizes the purchase into a fixed_assets balance rather than only debiting cash", async () => {
    const events = await getFinancialEvents(client, businessId);
    const capexEvent = events.find((e) => e.account_code === "fixed_assets");
    expect(capexEvent, "expected a fixed_assets-classified financial event for the durable upgrade purchase").toBeDefined();
  });
});
