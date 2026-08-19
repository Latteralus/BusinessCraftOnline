import { beforeAll, describe, expect, it } from "vitest";
import { purchaseUpgrade } from "@/domains/businesses/service";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import {
  createTestBusiness,
  createTestPlayer,
  expectJournalBalanced,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getCityIds,
  getFinancialEvents,
  getJournalLines,
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

  it("debits cash for the upgrade cost via upgrade_purchase, atomically with project creation", async () => {
    const cashBefore = await getBusinessCashBalance(client, businessId);

    const result = await purchaseUpgrade(client, playerId, businessId, "extraction_efficiency");
    expect(result.debitedAmount).toBeGreaterThan(0);
    expect(result.project.project_status).toBe("installing");

    const cashAfter = await getBusinessCashBalance(client, businessId);
    expect(cashAfter).toBe(cashBefore - result.debitedAmount);

    const ledger = await getLedgerEntries(client, businessId);
    const upgradeEntry = ledger.find((e) => e.category === "upgrade_purchase");
    expect(upgradeEntry).toMatchObject({ amount: result.debitedAmount, entry_type: "debit" });

    // AccountingFixPlan Phase G: purchase_business_upgrade_atomic now posts
    // a balanced journal entry (Debit Fixed Assets / Credit Cash).
    const journal = await getJournalLines(client, businessId);
    expectJournalBalanced(journal);
    expect(journal.find((l) => l.account_code === "fixed_assets" && l.debit === result.debitedAmount)).toBeDefined();
    expect(journal.find((l) => l.account_code === "cash" && l.credit === result.debitedAmount)).toBeDefined();
  });

  // AccountingFixPlan item 46's target: a durable upgrade capitalizes
  // (Debit Fixed Assets / Credit Cash) rather than just decrementing cash
  // with no balance-sheet trace. Every upgrade in this game's catalog
  // (src/config/business-upgrades.ts) is a permanent, leveled improvement --
  // there's no "consumable" carve-out to apply here.
  it("capitalizes the purchase into a fixed_assets balance rather than only debiting cash", async () => {
    const events = await getFinancialEvents(client, businessId);
    const capexEvent = events.find((e) => e.account_code === "fixed_assets");
    expect(capexEvent, "expected a fixed_assets-classified financial event for the durable upgrade purchase").toBeDefined();
  });

  it("rejects a second purchase while a capital project is already active", async () => {
    await expect(purchaseUpgrade(client, playerId, businessId, "worker_capacity")).rejects.toThrow(
      /already has an active capital project/
    );
  });
});
