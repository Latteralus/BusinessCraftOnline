import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import {
  createTestBusiness,
  createTestPlayer,
  fundBusinessFromOwner,
  getBusinessCashBalance,
  getCityIds,
  getLedgerEntries,
  serviceRoleClient,
  type TestClient,
} from "./helpers";

// AccountingFixPlan Phase A / item 51: "Add tests proving that depositing
// $100,000 into a new business gives $100,000 cash, $100,000 equity, and $0
// revenue/profit." Exercises the real transfer_between_personal_and_business
// RPC (src/domains/banking/service.ts's transferBetweenPersonalAndBusiness
// wraps it; this test calls the RPC directly via the same helper the app
// uses for setup, fundBusinessFromOwner).
describe("owner funds business (transfer_between_personal_and_business)", () => {
  let client: TestClient;
  let playerId: string;
  let businessId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    const [cityId] = await getCityIds(client);
    playerId = await createTestPlayer(client, "ownfnd");
    await ensurePersonalAccounts(client, playerId);
    businessId = await createTestBusiness(client, playerId, "mine", cityId, "OwnerFunding");
  });

  it("gives the business exactly the deposited cash, and only owner_equity-classified ledger entries", async () => {
    const before = await getBusinessCashBalance(client, businessId);
    expect(before).toBe(0);

    await fundBusinessFromOwner(client, playerId, businessId, 100_000);

    const after = await getBusinessCashBalance(client, businessId);
    expect(after).toBe(100_000);

    const entries = await getLedgerEntries(client, businessId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amount: 100_000, entry_type: "credit", category: "owner_transfer_in" });

    // No revenue/COGS/expense financial events should exist for a pure
    // capital contribution -- it must not be recognized as income.
    const { getFinancialEvents } = await import("./helpers");
    const financialEvents = await getFinancialEvents(client, businessId);
    expect(financialEvents).toHaveLength(0);
  });

  it("draws (business -> personal) reduce cash and post owner_transfer_out", async () => {
    const before = await getBusinessCashBalance(client, businessId);

    const { data: accounts } = await client.from("bank_accounts").select("id, account_type").eq("player_id", playerId);
    const checking = (accounts ?? []).find((a: any) => a.account_type === "checking") as { id: string };

    const { error } = await client.rpc("transfer_between_personal_and_business", {
      p_player_id: playerId,
      p_personal_account_id: checking.id,
      p_business_id: businessId,
      p_amount: 5_000,
      p_direction: "from_business",
      p_description: "Finance test: owner draw",
    });
    expect(error).toBeNull();

    const after = await getBusinessCashBalance(client, businessId);
    expect(after).toBe(before - 5_000);

    const entries = await getLedgerEntries(client, businessId);
    const draw = entries.find((e) => e.category === "owner_transfer_out");
    expect(draw).toMatchObject({ amount: 5_000, entry_type: "debit" });
  });

  it("rejects a draw larger than the business's cash balance", async () => {
    const balance = await getBusinessCashBalance(client, businessId);

    const { data: accounts } = await client.from("bank_accounts").select("id, account_type").eq("player_id", playerId);
    const checking = (accounts ?? []).find((a: any) => a.account_type === "checking") as { id: string };

    const { error } = await client.rpc("transfer_between_personal_and_business", {
      p_player_id: playerId,
      p_personal_account_id: checking.id,
      p_business_id: businessId,
      p_amount: balance + 1,
      p_direction: "from_business",
      p_description: "Finance test: overdraw attempt",
    });
    expect(error).not.toBeNull();
  });
});
