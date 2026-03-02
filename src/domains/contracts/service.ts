import { getBusinessById } from "@/domains/businesses";
import type {
  AcceptContractInput,
  CancelContractInput,
  Contract,
  ContractListFilter,
  CreateContractInput,
  FulfillContractInput,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeContract(row: Contract): Contract {
  return {
    ...row,
    required_quantity: Number(row.required_quantity),
    delivered_quantity: Number(row.delivered_quantity),
    unit_price: toNumber(row.unit_price),
  };
}

async function ensureOwnedBusiness(client: QueryClient, playerId: string, businessId: string) {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");
  return business;
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

async function consumeBusinessInventory(
  client: QueryClient,
  playerId: string,
  businessId: string,
  itemKey: string,
  quantity: number
): Promise<boolean> {
  const { data: rows, error } = await client
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("owner_player_id", playerId)
    .eq("business_id", businessId)
    .eq("item_key", itemKey)
    .order("quality", { ascending: false });

  if (error) throw error;

  const inventoryRows = (rows ?? []) as Array<{
    id: string;
    quantity: number | string;
    reserved_quantity: number | string;
  }>;

  let availableTotal = 0;
  for (const row of inventoryRows) {
    availableTotal += Math.max(0, toNumber(row.quantity) - toNumber(row.reserved_quantity));
  }

  if (availableTotal < quantity) return false;

  let remaining = quantity;
  for (const row of inventoryRows) {
    if (remaining <= 0) break;

    const currentQty = toNumber(row.quantity);
    const currentReserved = toNumber(row.reserved_quantity);
    const available = Math.max(0, currentQty - currentReserved);
    if (available <= 0) continue;

    const used = Math.min(available, remaining);
    const nextQty = currentQty - used;

    if (nextQty <= 0) {
      const { error: deleteError } = await client.from("business_inventory").delete().eq("id", row.id);
      if (deleteError) throw deleteError;
    } else {
      const { error: updateError } = await client
        .from("business_inventory")
        .update({
          quantity: nextQty,
          reserved_quantity: Math.min(currentReserved, nextQty),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
    }

    remaining -= used;
  }

  return true;
}

export async function getContracts(
  client: QueryClient,
  playerId: string,
  filter: ContractListFilter = {}
): Promise<Contract[]> {
  let query = client
    .from("contracts")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("created_at", { ascending: false });

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
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

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
  const contract = await getContractOrThrow(client, playerId, input.contractId);

  if (contract.status !== "open") {
    throw new Error("Only open contracts can be accepted.");
  }

  if (contract.expires_at && new Date(contract.expires_at).getTime() <= Date.now()) {
    const { error: expireError } = await client
      .from("contracts")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", contract.id);
    if (expireError) throw expireError;
    throw new Error("Contract has expired.");
  }

  const acceptedAt = new Date().toISOString();
  const dueAt = contract.due_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("contracts")
    .update({
      status: "accepted",
      accepted_at: acceptedAt,
      due_at: dueAt,
      updated_at: acceptedAt,
    })
    .eq("id", contract.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeContract(data as Contract);
}

export async function cancelContract(
  client: QueryClient,
  playerId: string,
  input: CancelContractInput
): Promise<Contract> {
  const contract = await getContractOrThrow(client, playerId, input.contractId);

  if (["fulfilled", "cancelled", "expired"].includes(contract.status)) {
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

  if (!["accepted", "in_progress"].includes(contract.status)) {
    throw new Error("Only accepted or in-progress contracts can be fulfilled.");
  }

  await ensureOwnedBusiness(client, playerId, contract.business_id);

  const remaining = Math.max(0, contract.required_quantity - contract.delivered_quantity);
  if (remaining <= 0) {
    throw new Error("Contract is already fully delivered.");
  }

  const consumed = await consumeBusinessInventory(
    client,
    playerId,
    contract.business_id,
    contract.item_key,
    remaining
  );

  if (!consumed) {
    const { error: inProgressError } = await client
      .from("contracts")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", contract.id);
    if (inProgressError) throw inProgressError;
    throw new Error("Not enough inventory to fulfill this contract.");
  }

  const payout = Number((remaining * contract.unit_price).toFixed(2));

  const { error: ledgerError } = await client.from("business_accounts").insert({
    business_id: contract.business_id,
    amount: payout,
    entry_type: "credit",
    category: "contract_payout",
    reference_id: contract.id,
    description: `Contract payout: ${remaining}x ${contract.item_key}`,
  });

  if (ledgerError) throw ledgerError;

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
