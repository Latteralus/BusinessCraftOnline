import { ensureOwnedBusiness } from "@/domains/_shared/ownership";
import {
  consumeInventoryRowsCost,
  getAvailableInventoryQuantity,
  insertBusinessFinancialEvents,
  loadBusinessInventoryRowsForItem,
} from "@/domains/businesses/financial-events";
import { addBusinessAccountEntry } from "@/domains/businesses";
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

  // Fetch once and reuse for both the availability check and the actual
  // consumption below, instead of hasEnoughBusinessInventory and
  // consumeBusinessInventoryCost each independently re-selecting the same
  // rows. Resolves audit finding L1 (Documents/SBAudit.md).
  const inventoryRows = await loadBusinessInventoryRowsForItem(
    client,
    playerId,
    contract.business_id,
    contract.item_key
  );

  if (getAvailableInventoryQuantity(inventoryRows) < remaining) {
    const { error: inProgressError } = await client
      .from("contracts")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", contract.id);
    if (inProgressError) throw inProgressError;
    throw new Error("Not enough inventory to fulfill this contract.");
  }

  const inventoryCost = await consumeInventoryRowsCost(client, inventoryRows, remaining);

  const payout = Number((remaining * contract.unit_price).toFixed(2));

  await addBusinessAccountEntry(client, playerId, contract.business_id, {
    amount: payout,
    entryType: "credit",
    category: "contract_payout",
    referenceId: contract.id,
    description: `Contract payout: ${remaining}x ${contract.item_key}`,
  });

  await insertBusinessFinancialEvents(client, playerId, [
    {
      business_id: contract.business_id,
      account_code: "revenue",
      amount: payout,
      quantity: remaining,
      item_key: contract.item_key,
      reference_type: "contract",
      reference_id: contract.id,
      description: `Contract revenue: ${remaining}x ${contract.item_key}`,
      metadata: { estimatedCost: inventoryCost.estimated },
    },
    {
      business_id: contract.business_id,
      account_code: "cogs",
      amount: inventoryCost.totalCost,
      quantity: inventoryCost.quantityConsumed,
      item_key: contract.item_key,
      reference_type: "contract",
      reference_id: contract.id,
      description: `Contract COGS: ${remaining}x ${contract.item_key}`,
      metadata: { estimatedCost: inventoryCost.estimated },
    },
    {
      business_id: contract.business_id,
      account_code: "inventory",
      amount: inventoryCost.totalCost,
      quantity: inventoryCost.quantityConsumed,
      item_key: contract.item_key,
      reference_type: "contract",
      reference_id: contract.id,
      description: `Inventory relieved for contract: ${remaining}x ${contract.item_key}`,
      metadata: { direction: "out", estimatedCost: inventoryCost.estimated },
    },
  ]);

  const now = new Date().toISOString();
  const { data, error } = await client
    .from("contracts")
    .update({
      delivered_quantity: contract.required_quantity,
      status: "fulfilled",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", contract.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeContract(data as Contract);
}
