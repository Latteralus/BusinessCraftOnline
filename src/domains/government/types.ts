import type { StockpileStatus } from "../../../shared/cities/stockpiles";

export type CityStockpile = {
  id: string;
  city_id: string;
  item_key: string;
  stored_quantity: number;
  target_quantity: number;
  reorder_point: number;
  critical_point: number;
  base_consumption_per_hour: number;
  minimum_quality: number;
  last_materialized_at: string;
  next_reorder_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Adds a read-time projection of the stockpile's *current* effective stock
// (see shared/cities/stockpiles.ts) without requiring a fresh materialize
// write for every read -- stored_quantity/last_materialized_at above remain
// the last-written checkpoint, current_quantity is the projected value.
export type ProjectedCityStockpile = CityStockpile & {
  current_quantity: number;
  status: StockpileStatus;
};

export type { StockpileStatus };

// CityPlan Phase 4: shared government contract-provider/contract model. See
// Documents/Plans/CityPlan.md ("Shared Government Contract Provider Model").

export const GOVERNMENT_CONTRACT_PROVIDER_TYPES = ["city", "federal"] as const;
export type GovernmentContractProviderType = (typeof GOVERNMENT_CONTRACT_PROVIDER_TYPES)[number];

export type GovernmentContractProvider = {
  id: string;
  provider_type: GovernmentContractProviderType;
  city_id: string | null;
  provider_key: string;
  display_name: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const GOVERNMENT_CONTRACT_TYPES = ["replenishment", "federal_placeholder", "future_project"] as const;
export type GovernmentContractType = (typeof GOVERNMENT_CONTRACT_TYPES)[number];

export const GOVERNMENT_CONTRACT_STATUSES = [
  "available",
  "awarded",
  "in_progress",
  "fulfilled",
  "closed",
  "expired",
  "cancelled",
] as const;
export type GovernmentContractStatus = (typeof GOVERNMENT_CONTRACT_STATUSES)[number];

export const GOVERNMENT_CONTRACT_LIVE_STATUSES = [
  "available",
  "awarded",
  "in_progress",
] as const satisfies readonly GovernmentContractStatus[];

export const GOVERNMENT_CONTRACT_URGENCIES = ["normal", "low", "critical"] as const;
export type GovernmentContractUrgency = (typeof GOVERNMENT_CONTRACT_URGENCIES)[number];

export function isLiveGovernmentContractStatus(status: GovernmentContractStatus): boolean {
  return (GOVERNMENT_CONTRACT_LIVE_STATUSES as readonly GovernmentContractStatus[]).includes(status);
}

export type GovernmentContract = {
  id: string;
  provider_id: string;
  city_id: string | null;
  stockpile_id: string | null;
  contract_type: GovernmentContractType;
  agency_key: string | null;
  item_key: string;
  quantity_requested: number;
  quantity_delivered: number;
  minimum_quality: number;
  unit_price: number;
  total_value: number;
  status: GovernmentContractStatus;
  urgency: GovernmentContractUrgency;
  awarded_business_id: string | null;
  posted_at: string;
  deadline_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GovernmentContractListFilter = {
  cityId?: string;
  providerId?: string;
  status?: GovernmentContractStatus;
  businessId?: string;
  limit?: number;
};

export type AwardGovernmentContractInput = {
  contractId: string;
  businessId: string;
};

export type DeliverGovernmentContractInput = {
  contractId: string;
  quantity: number;
};
