// Security regression suite for the Supabase Advisor function-privilege
// hardening pass (Documents/Plans/SupabaseReport.md,
// supabase/migrations/20260819040000_100_function_execute_privilege_hardening.sql
// onward). Prevents the reported issue -- SECURITY DEFINER functions
// silently becoming executable by `anon`/`authenticated` -- from
// regressing.
//
// Two layers:
//  1. Static introspection against the documented allowlist
//     (test/db/rpc-allowlist.ts) via the service_role-only helper RPC
//     `_introspect_function_privileges()`. This is the primary guard: it
//     fails the moment any SECURITY DEFINER function's EXECUTE grants drift
//     from the intentional, checked-in allowlist, regardless of which
//     migration caused it.
//  2. Functional smoke tests exercising real anon/authenticated/service_role
//     clients against a representative sample of each classification, so a
//     grants regression is caught even if someone edits the allowlist to
//     match a bad migration instead of fixing the migration.
//
// Real integration tests against a local `supabase start` instance, same
// pattern as test/finance/*.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalAccounts } from "@/domains/banking/service";
import { LOCAL_SUPABASE_ANON_KEY, LOCAL_SUPABASE_URL } from "../finance/env";
import { createTestPlayer, playerClient, serviceRoleClient, type TestClient } from "../finance/helpers";
import {
  ANON_ALLOWED_FUNCTIONS,
  AUTHENTICATED_ALLOWED_FUNCTIONS,
  SERVER_ONLY_SECURITY_DEFINER_FUNCTIONS,
} from "./rpc-allowlist";

/**
 * A genuine anon-key client with no Authorization override, exercising the
 * pre-login role exactly as PostgREST sees an unauthenticated browser
 * request (the finance test helpers only export a service-role client and a
 * player-signed client).
 */
function anonClient(): TestClient {
  return createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  }) as TestClient;
}

type FunctionPrivilegeRow = {
  function_name: string;
  arg_types: string;
  is_security_definer: boolean;
  public_can_execute: boolean;
  anon_can_execute: boolean;
  authenticated_can_execute: boolean;
  service_role_can_execute: boolean;
};

describe("RPC / function EXECUTE privilege regression", () => {
  let service: TestClient;
  let privilegeRows: FunctionPrivilegeRow[];

  beforeAll(async () => {
    service = serviceRoleClient();
    const { data, error } = await service.rpc("_introspect_function_privileges");
    if (error) throw error;
    privilegeRows = data as FunctionPrivilegeRow[];
    expect(privilegeRows.length).toBeGreaterThan(0);
  });

  it("no undocumented SECURITY DEFINER function is executable by anon or PUBLIC", () => {
    const offenders = privilegeRows.filter(
      (row) =>
        row.is_security_definer &&
        (row.anon_can_execute || row.public_can_execute) &&
        !ANON_ALLOWED_FUNCTIONS.includes(row.function_name as (typeof ANON_ALLOWED_FUNCTIONS)[number])
    );

    expect(
      offenders.map((row) => row.function_name),
      `Found SECURITY DEFINER function(s) callable by anon/PUBLIC that are not on the ANON_ALLOWED_FUNCTIONS allowlist ` +
        `(test/db/rpc-allowlist.ts). If this is intentional, add the function to the allowlist AND to migration 100's ` +
        `"A. anon" grant section; otherwise revoke its anon/PUBLIC EXECUTE grant in a new forward migration.`
    ).toEqual([]);
  });

  it("no undocumented SECURITY DEFINER function is executable by authenticated", () => {
    const offenders = privilegeRows.filter(
      (row) =>
        row.is_security_definer &&
        row.authenticated_can_execute &&
        !AUTHENTICATED_ALLOWED_FUNCTIONS.includes(row.function_name as (typeof AUTHENTICATED_ALLOWED_FUNCTIONS)[number])
    );

    expect(
      offenders.map((row) => row.function_name),
      `Found SECURITY DEFINER function(s) callable by authenticated that are not on the AUTHENTICATED_ALLOWED_FUNCTIONS ` +
        `allowlist (test/db/rpc-allowlist.ts). Server-only/internal functions must stay restricted to service_role.`
    ).toEqual([]);
  });

  it("every server-only / internal SECURITY DEFINER function is unreachable by anon and authenticated", () => {
    const byName = new Map(privilegeRows.map((row) => [row.function_name, row]));

    for (const name of SERVER_ONLY_SECURITY_DEFINER_FUNCTIONS) {
      const row = byName.get(name);
      expect(row, `Expected function "${name}" to exist in the public schema`).toBeDefined();
      expect(row!.anon_can_execute, `"${name}" must not be anon-executable`).toBe(false);
      expect(row!.authenticated_can_execute, `"${name}" must not be authenticated-executable`).toBe(false);
      expect(row!.public_can_execute, `"${name}" must not be PUBLIC-executable`).toBe(false);
    }
  });

  it("every allowlisted anon function is actually anon-executable (grants are in place, not just absent elsewhere)", () => {
    const byName = new Map(privilegeRows.map((row) => [row.function_name, row]));

    for (const name of ANON_ALLOWED_FUNCTIONS) {
      const row = byName.get(name);
      expect(row, `Expected function "${name}" to exist in the public schema`).toBeDefined();
      expect(row!.anon_can_execute, `"${name}" is on the anon allowlist but is not actually anon-executable`).toBe(true);
    }
  });

  it("every allowlisted authenticated function is actually authenticated-executable", () => {
    const byName = new Map(privilegeRows.map((row) => [row.function_name, row]));

    for (const name of AUTHENTICATED_ALLOWED_FUNCTIONS) {
      const row = byName.get(name);
      expect(row, `Expected function "${name}" to exist in the public schema`).toBeDefined();
      expect(
        row!.authenticated_can_execute,
        `"${name}" is on the authenticated allowlist but is not actually authenticated-executable`
      ).toBe(true);
    }
  });
});

describe("RPC permission functional smoke tests", () => {
  let service: TestClient;
  let anon: TestClient;
  let playerA: string;
  let playerB: string;
  let clientA: TestClient;

  beforeAll(async () => {
    service = serviceRoleClient();
    anon = anonClient();

    playerA = await createTestPlayer(service, "rpcpermA");
    playerB = await createTestPlayer(service, "rpcpermB");
    await ensurePersonalAccounts(service, playerA);
    await ensurePersonalAccounts(service, playerB);
    clientA = await playerClient(playerA);
  });

  it("anon cannot execute internal financial mutation helpers", async () => {
    const { data: accounts } = await service.from("bank_accounts").select("id").eq("player_id", playerA).limit(1);
    const accountId = (accounts ?? [])[0]?.id as string | undefined;
    expect(accountId).toBeDefined();

    const { error } = await anon.rpc("append_personal_transaction", {
      p_player_id: playerA,
      p_account_id: accountId,
      p_amount: 1_000_000,
      p_direction: "credit",
      p_transaction_type: "manual_adjustment",
      p_description: "should be rejected",
      p_reference_id: null,
    });

    expect(error, "anon must not be able to call append_personal_transaction directly").not.toBeNull();
  });

  it("anon cannot execute tick helpers", async () => {
    const { error } = await anon.rpc("acquire_tick_lock", {
      p_tick_name: `test-anon-should-fail-${randomUUID()}`,
      p_lock_seconds: 5,
    });

    expect(error, "anon must not be able to call acquire_tick_lock").not.toBeNull();
  });

  it("anon cannot perform arbitrary inventory/account balance mutations", async () => {
    const { error } = await anon.rpc("add_business_inventory_quantity", {
      p_owner_player_id: playerA,
      p_business_id: randomUUID(),
      p_city_id: randomUUID(),
      p_item_key: "water",
      p_quality: 50,
      p_quantity: 1000,
      p_unit_cost: 0,
    });

    expect(error, "anon must not be able to call add_business_inventory_quantity").not.toBeNull();
  });

  it("authenticated player can execute legitimate player-facing RPCs", async () => {
    const { data, error } = await clientA.rpc("get_player_account_balances", { p_player_id: playerA });
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("authenticated player cannot execute service-role accounting/tick helpers", async () => {
    const { data: accounts } = await service.from("bank_accounts").select("id").eq("player_id", playerA).limit(1);
    const accountId = (accounts ?? [])[0]?.id as string | undefined;

    const { error: ledgerError } = await clientA.rpc("append_personal_transaction", {
      p_player_id: playerA,
      p_account_id: accountId,
      p_amount: 1_000_000,
      p_direction: "credit",
      p_transaction_type: "manual_adjustment",
      p_description: "should be rejected",
      p_reference_id: null,
    });
    expect(ledgerError, "authenticated must not be able to call append_personal_transaction directly").not.toBeNull();

    const { error: lockError } = await clientA.rpc("acquire_tick_lock", {
      p_tick_name: `test-authenticated-should-fail-${randomUUID()}`,
      p_lock_seconds: 5,
    });
    expect(lockError, "authenticated must not be able to call acquire_tick_lock").not.toBeNull();
  });

  it("authenticated player cannot mutate other players' protected state", async () => {
    const { data: bAccounts } = await service.from("bank_accounts").select("id").eq("player_id", playerB).limit(1);
    const playerBAccountId = (bAccounts ?? [])[0]?.id as string | undefined;
    expect(playerBAccountId).toBeDefined();

    // clientA is authenticated as playerA; transfer_between_own_accounts
    // requires both accounts to belong to p_player_id, so passing playerB's
    // account as the destination must be rejected by the function's own
    // ownership check even though clientA has EXECUTE on the RPC itself.
    const { error } = await clientA.rpc("transfer_between_own_accounts", {
      p_player_id: playerA,
      p_from_account_id: playerBAccountId,
      p_to_account_id: playerBAccountId,
      p_amount: 1,
      p_description: "should be rejected",
    });

    expect(error, "a player must not be able to operate on another player's bank account via this RPC").not.toBeNull();
  });

  it("service role can perform the server-authoritative operations it requires", async () => {
    const tickName = `test-service-role-round-trip-${randomUUID()}`;
    const { data: token, error: acquireError } = await service.rpc("acquire_tick_lock", {
      p_tick_name: tickName,
      p_lock_seconds: 30,
    });
    expect(acquireError).toBeNull();
    expect(token).toBeDefined();

    const { data: released, error: releaseError } = await service.rpc("release_tick_lock", {
      p_tick_name: tickName,
      p_lock_token: token,
    });
    expect(releaseError).toBeNull();
    expect(released).toBe(true);
  });
});
