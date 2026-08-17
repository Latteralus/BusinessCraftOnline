export const CONTRACT_STATUSES = [
  "open",
  "accepted",
  "in_progress",
  "fulfilled",
  "cancelled",
  "expired",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_DEFAULT_EXPIRY_HOURS = 72;
export const CONTRACT_ACCEPTED_DUE_HOURS = 24;

export const CONTRACT_LIVE_STATUSES = ["open", "accepted", "in_progress"] as const satisfies readonly ContractStatus[];
export const CONTRACT_FULFILLABLE_STATUSES = ["accepted", "in_progress"] as const satisfies readonly ContractStatus[];
export const CONTRACT_CLOSED_STATUSES = ["fulfilled", "cancelled", "expired"] as const satisfies readonly ContractStatus[];

export function isLiveContractStatus(status: ContractStatus): boolean {
  return (CONTRACT_LIVE_STATUSES as readonly ContractStatus[]).includes(status);
}

export function isFulfillableContractStatus(status: ContractStatus): boolean {
  return (CONTRACT_FULFILLABLE_STATUSES as readonly ContractStatus[]).includes(status);
}

export function isClosedContractStatus(status: ContractStatus): boolean {
  return (CONTRACT_CLOSED_STATUSES as readonly ContractStatus[]).includes(status);
}

export function formatContractStatus(status: ContractStatus): string {
  return status.replace("_", " ");
}

export type Contract = {
  id: string;
  owner_player_id: string;
  business_id: string;
  title: string;
  item_key: string;
  required_quantity: number;
  delivered_quantity: number;
  unit_price: number;
  status: ContractStatus;
  notes: string | null;
  accepted_at: string | null;
  due_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractListFilter = {
  businessId?: string;
  status?: ContractStatus;
  limit?: number;
};

export type CreateContractInput = {
  businessId: string;
  title: string;
  itemKey: string;
  requiredQuantity: number;
  unitPrice: number;
  notes?: string;
  expiresAt?: string;
};

export type AcceptContractInput = {
  contractId: string;
};

export type CancelContractInput = {
  contractId: string;
};

export type FulfillContractInput = {
  contractId: string;
};
