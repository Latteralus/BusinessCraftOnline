import { beforeAll, describe, expect, it } from "vitest";
import { createTestBusiness, createTestPlayer, getCityIds, getJournalLines, serviceRoleClient, type TestClient } from "./helpers";

describe("double-entry journal schema (AccountingFixPlan Phase A)", () => {
  let client: TestClient;
  let businessId: string;

  beforeAll(async () => {
    client = serviceRoleClient();
    const [cityId] = await getCityIds(client);
    const playerId = await createTestPlayer(client, "journal");
    businessId = await createTestBusiness(client, playerId, "mine", cityId, "Journal");
  });

  it("accepts a balanced entry and rejects one line", async () => {
    const { error } = await client.rpc("post_business_journal_entry", {
      p_business_id: businessId,
      p_lines: [
        { account_code: "cash", debit: 100 },
        { account_code: "owner_capital", credit: 100 },
      ],
      p_reference_type: "test",
      p_description: "balanced entry",
    });
    expect(error).toBeNull();

    const lines = await getJournalLines(client, businessId);
    expect(lines).toHaveLength(2);
    const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
    expect(totalDebit).toBe(100);
    expect(totalCredit).toBe(100);
  });

  it("rejects an unbalanced entry at commit (deferred constraint trigger)", async () => {
    const { error } = await client.rpc("post_business_journal_entry", {
      p_business_id: businessId,
      p_lines: [
        { account_code: "cash", debit: 100 },
        { account_code: "owner_capital", credit: 50 },
      ],
      p_reference_type: "test",
      p_description: "unbalanced entry",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/unbalanced/i);
  });

  it("rejects a single-line entry", async () => {
    const { error } = await client.rpc("post_business_journal_entry", {
      p_business_id: businessId,
      p_lines: [{ account_code: "cash", debit: 100 }],
      p_description: "single line",
    });
    expect(error).not.toBeNull();
  });

  it("rejects a line with both debit and credit set", async () => {
    const { error } = await client.rpc("post_business_journal_entry", {
      p_business_id: businessId,
      p_lines: [
        { account_code: "cash", debit: 100, credit: 100 },
        { account_code: "owner_capital", credit: 100 },
      ],
      p_description: "double-sided line",
    });
    expect(error).not.toBeNull();
  });

  it("rejects an unknown account code", async () => {
    const { error } = await client.rpc("post_business_journal_entry", {
      p_business_id: businessId,
      p_lines: [
        { account_code: "not_a_real_account", debit: 100 },
        { account_code: "owner_capital", credit: 100 },
      ],
      p_description: "bogus account",
    });
    expect(error).not.toBeNull();
  });

  it("player select policy exposes only their own business's journal", async () => {
    const [cityId] = await getCityIds(client);
    const otherPlayerId = await createTestPlayer(client, "journal-other");
    const otherBusinessId = await createTestBusiness(client, otherPlayerId, "mine", cityId, "Other");

    const { playerClient } = await import("./helpers");
    const asOtherPlayer = await playerClient(otherPlayerId);

    const { data, error } = await asOtherPlayer.from("business_journal_entries").select("id").eq("business_id", businessId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // sanity: the other player's own (empty) business journal is still readable
    const { data: ownData, error: ownError } = await asOtherPlayer
      .from("business_journal_entries")
      .select("id")
      .eq("business_id", otherBusinessId);
    expect(ownError).toBeNull();
    expect(ownData).toHaveLength(0);
  });
});
