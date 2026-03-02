export const CONTRACT_STATUSES = [
  "open",
  "accepted",
  "in_progress",
  "fulfilled",
  "cancelled",
  "expired",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

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
