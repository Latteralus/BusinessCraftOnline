import type {
  BusinessEntityType,
  BusinessType,
  BusinessUpgradeKey,
} from "@/config/businesses";

export type Business = {
  id: string;
  player_id: string;
  name: string;
  type: BusinessType;
  city_id: string;
  entity_type: BusinessEntityType;
  value: number;
  created_at: string;
  updated_at: string;
};

export type BusinessAccountEntry = {
  id: string;
  business_id: string;
  amount: number;
  entry_type: "credit" | "debit";
  category: string;
  reference_id: string | null;
  description: string;
  created_at: string;
};

export type BusinessUpgrade = {
  id: string;
  business_id: string;
  upgrade_key: BusinessUpgradeKey;
  level: number;
  purchased_at: string;
  created_at: string;
  updated_at: string;
};

export type BusinessWithBalance = Business & {
  balance: number;
};

export type BusinessDetail = BusinessWithBalance & {
  upgrades: BusinessUpgrade[];
};

export type CreateBusinessInput = {
  name: string;
  type: BusinessType;
  cityId: string;
  entityType?: BusinessEntityType;
};

export type PurchaseUpgradeInput = {
  businessId: string;
  upgradeKey: BusinessUpgradeKey;
};

export type PurchaseUpgradeResult = {
  businessId: string;
  upgrade: BusinessUpgrade;
  debitedAmount: number;
  resultingBalance: number;
};

export type BusinessSummary = {
  totalBusinesses: number;
  totalBusinessBalance: number;
  producingTypesOwned: number;
  topBusiness: BusinessWithBalance | null;
};

export type { BusinessEntityType, BusinessType, BusinessUpgradeKey };
