import { ensureOwnedBusiness } from "@/domains/_shared/ownership";
import { createSupabaseServiceRoleClient } from "@/lib/supabase-service-role";
import type { QueryClient } from "@/lib/db/query-client";
import { toNumber } from "@/lib/core/number";
import type {
  AcceptContractInput,
  CancelContractInput,
  Contract,
  ContractListFilter,
  CreateContractInput,
  FulfillContractInput,
} from "./types";
import {
  CONTRACT_DEFAULT_EXPIRY_HOURS,
  isClosedContractStatus,
  isFulfillableContractStatus,
} from "./types";

function normalizeContract(row: Contract): Contract {
  return {
    ...row,
    required_quantity: Number(row.required_quantity),
    delivered_quantity: Number(row.delivered_quantity),
    unit_price: toNumber(row.unit_price),
  };
}

async function getContractOrThrow(client: QueryClient, playerId: string, contractId: string): Promise<Contract> {
  const { data, error } = await client
    .from("contracts")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("id", contractId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Contract not found.");
  return normalizeContract(data as Contract);
}

// Bounded default so one player's full contract history (all statuses,
// forever) can't become an unbounded result set. Resolves audit finding M1.
const CONTRACTS_DEFAULT_LIMIT = 500;

export async function getContracts(
  client: QueryClient,
  playerId: string,
  filter: ContractListFilter = {}
): Promise<Contract[]> {
  let query = client
    .from("contracts")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? CONTRACTS_DEFAULT_LIMIT);

  if (filter.businessId) {
    query = query.eq("business_id", filter.businessId);
  }

  if (filter.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data as Contract[]) ?? []).map(normalizeContract);
}

export async function getContractById(
  client: QueryClient,
  playerId: string,
  contractId: string
): Promise<Contract | null> {
  const { data, error } = await client
    .from("contracts")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("id", contractId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return normalizeContract(data as Contract);
}

export async function createContract(
  client: QueryClient,
  playerId: string,
  input: CreateContractInput
): Promise<Contract> {
  await ensureOwnedBusiness(client, playerId, input.businessId);

  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + CONTRACT_DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("contracts")
    .insert({
      owner_player_id: playerId,
      business_id: input.businessId,
      title: input.title,
      item_key: input.itemKey,
      required_quantity: input.requiredQuantity,
      delivered_quantity: 0,
      unit_price: input.unitPrice,
      status: "open",
      notes: input.notes?.trim() ? input.notes.trim() : null,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeContract(data as Contract);
}

export async function acceptContract(
  client: QueryClient,
  playerId: string,
  input: AcceptContractInput
): Promise<Contract> {
  const { data, error } = await client.rpc("accept_contract_atomic", {
    p_player_id: playerId,
    p_contract_id: input.contractId,
  });

  if (error) throw error;
  return normalizeContract(data as Contract);
}

export async function cancelContract(
  client: QueryClient,
  playerId: string,
  input: CancelContractInput
): Promise<Contract> {
  const contract = await getContractOrThrow(client, playerId, input.contractId);

  if (isClosedContractStatus(contract.status)) {
    throw new Error("This contract can no longer be cancelled.");
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("contracts")
    .update({
      status: "cancelled",
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", contract.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeContract(data as Contract);
}

export async function fulfillContract(
  client: QueryClient,
  playerId: string,
  input: FulfillContractInput
): Promise<Contract> {
  const contract = await getContractOrThrow(client, playerId, input.contractId);

  if (!isFulfillableContractStatus(contract.status)) {
    throw new Error("Only accepted or in-progress contracts can be fulfilled.");
  }

  await ensureOwnedBusiness(client, playerId, contract.business_id);

  const remaining = Math.max(0, contract.required_quantity - contract.delivered_quantity);
  if (remaining <= 0) {
    throw new Error("Contract is already fully delivered.");
  }

  // fulfill_contract_atomic (migration 106) relieves the exact
  // weighted-average inventory cost, credits the payout, and writes
  // revenue/COGS/inventory financial events all in one transaction --
  // restricted to service_role like every other economic RPC that moves
  // business cash, so call it with a service-role client rather than the
  // caller's client (same reasoning as addBusinessAccountEntry in
  // src/domains/businesses/service.ts). The checks above are a cheap
  // early-exit that preserve this function's existing error messages; the
  // RPC re-validates everything under row locks regardless.
  const { data, error } = await createSupabaseServiceRoleClient().rpc("fulfill_contract_atomic", {
    p_player_id: playerId,
    p_contract_id: contract.id,
  });
  if (error) throw error;

  const result = data as { ok: boolean; reason?: string; contract?: Contract } | null;
  if (!result?.ok) {
    throw new Error("Not enough inventory to fulfill this contract.");
  }

  return normalizeContract(result.contract as Contract);
}
