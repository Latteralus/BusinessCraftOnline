// Shared fixtures/assertions for the finance regression suite. Tests hit a
// real local Postgres/PostgREST instance (`supabase start`) and call the
// same RPCs and domain-service functions production code calls -- this is
// integration testing, not mocking, per AccountingFixPlan Phase A ("Do not
// leave important financial-event writes in TypeScript after an economic
// SQL transaction has already committed" can only be caught by exercising
// the real transaction boundary).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { signCustomJwt } from "@/lib/auth-jwt";
import { LOCAL_SUPABASE_ANON_KEY, LOCAL_SUPABASE_SERVICE_ROLE_KEY, LOCAL_SUPABASE_URL } from "./env";

export type TestClient = SupabaseClient<any, "public", "public", any, any>;

/** Bypasses RLS entirely -- used for fixture setup/teardown and for RPCs that don't rely on auth.uid() internally (most of them; see helpers below for the ones that do). */
export function serviceRoleClient(): TestClient {
  return createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }) as TestClient;
}

/**
 * A client authenticated as a specific player, exactly like the app's real
 * request-scoped server client (src/lib/supabase-server.ts): a custom JWT
 * with `sub: playerId` signed with SUPABASE_JWT_SECRET, sent as the
 * Authorization bearer token, so Postgres's `auth.uid()` resolves to that
 * player inside RLS policies and any RPC that reads auth.uid() directly
 * (e.g. execute_market_purchase).
 */
export async function playerClient(playerId: string): Promise<TestClient> {
  const token = await signCustomJwt(playerId);
  return createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as TestClient;
}

let cachedCityIds: string[] | null = null;

export async function getCityIds(client: TestClient): Promise<string[]> {
  if (cachedCityIds) return cachedCityIds;
  const { data, error } = await client.from("cities").select("id").order("name").limit(2);
  if (error) throw error;
  const ids = (data ?? []).map((row: { id: string }) => row.id);
  if (ids.length < 2) throw new Error("Expected at least 2 seeded cities for finance tests.");
  cachedCityIds = ids;
  return ids;
}

export async function createTestPlayer(client: TestClient, label: string): Promise<string> {
  // players.username is checked to 3-24 chars, so keep this short regardless of label length.
  const username = `f${label.replace(/[^a-z0-9]/gi, "").slice(0, 6)}${randomUUID().slice(0, 8)}`;
  const { data, error } = await client
    .from("players")
    .insert({ username, password_hash: "test-fixture-not-a-real-hash" })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function createTestBusiness(
  client: TestClient,
  playerId: string,
  type: string,
  cityId: string,
  label: string
): Promise<string> {
  const { data, error } = await client
    .from("businesses")
    .insert({ player_id: playerId, name: `Finance Test ${label} ${randomUUID().slice(0, 6)}`, type, city_id: cityId })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Debit business_accounts.owner_transfer_in via the real RPC, exactly like a player depositing personal cash into a business they own. */
export async function fundBusinessFromOwner(
  client: TestClient,
  playerId: string,
  businessId: string,
  amount: number
): Promise<void> {
  const { data: accounts, error: accountsError } = await client
    .from("bank_accounts")
    .select("id, account_type")
    .eq("player_id", playerId);
  if (accountsError) throw accountsError;
  const checking = (accounts ?? []).find((row: { account_type: string }) => row.account_type === "checking");
  if (!checking) throw new Error(`Player ${playerId} has no checking account -- call ensurePersonalAccounts first.`);

  const { error } = await client.rpc("transfer_between_personal_and_business", {
    p_player_id: playerId,
    p_personal_account_id: (checking as { id: string }).id,
    p_business_id: businessId,
    p_amount: amount,
    p_direction: "to_business",
    p_description: "Finance test: owner funding",
  });
  if (error) throw error;
}

export async function getBusinessCashBalance(client: TestClient, businessId: string): Promise<number> {
  const { data, error } = await client.rpc("get_business_account_balance", { p_business_id: businessId });
  if (error) throw error;
  return Number(data);
}

export async function getBusinessInventoryRows(
  client: TestClient,
  businessId: string,
  itemKey?: string
): Promise<Array<{ id: string; item_key: string; quality: number; quantity: number; unit_cost: number | null; total_cost: number | null }>> {
  let query = client.from("business_inventory").select("*").eq("business_id", businessId);
  if (itemKey) query = query.eq("item_key", itemKey);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as any;
}

export async function getTotalInventoryCost(client: TestClient, businessId: string): Promise<number> {
  const rows = await getBusinessInventoryRows(client, businessId);
  return round2(rows.reduce((sum, row) => sum + Number(row.total_cost ?? 0), 0));
}

export async function getLedgerEntries(
  client: TestClient,
  businessId: string
): Promise<Array<{ amount: number; entry_type: "credit" | "debit"; category: string; reference_id: string | null }>> {
  const { data, error } = await client
    .from("business_accounts")
    .select("amount, entry_type, category, reference_id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, amount: Number(row.amount) }));
}

export async function getFinancialEvents(
  client: TestClient,
  businessId: string
): Promise<Array<{ account_code: string; amount: number; reference_type: string | null; reference_id: string | null; item_key: string | null; quantity: number | null }>> {
  const { data, error } = await client
    .from("business_financial_events")
    .select("account_code, amount, reference_type, reference_id, item_key, quantity")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, amount: Number(row.amount) }));
}

export async function getJournalLines(
  client: TestClient,
  businessId: string
): Promise<Array<{ account_code: string; debit: number; credit: number; entry_id: string }>> {
  const { data, error } = await client
    .from("business_journal_lines")
    .select("account_code, debit, credit, entry_id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, debit: Number(row.debit), credit: Number(row.credit) }));
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
