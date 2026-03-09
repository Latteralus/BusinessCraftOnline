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

export type BusinessUpgradeProjectStatus =
  | "queued"
  | "installing"
  | "completed"
  | "cancelled";

export type BusinessUpgradeProject = {
  id: string;
  business_id: string;
  upgrade_key: BusinessUpgradeKey;
  target_level: number;
  project_status: BusinessUpgradeProjectStatus;
  quoted_cost: number;
  started_at: string | null;
  completes_at: string | null;
  applied_at: string | null;
  downtime_policy: "none" | "partial" | "full";
  created_at: string;
  updated_at: string;
};

export type BusinessWithBalance = Business & {
  balance: number;
};

export type BusinessDetail = BusinessWithBalance & {
  upgrades: BusinessUpgrade[];
  upgradeProjects: BusinessUpgradeProject[];
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
  project: BusinessUpgradeProject;
  debitedAmount: number;
  resultingBalance: number;
};

export type BusinessSummary = {
  totalBusinesses: number;
  totalBusinessBalance: number;
  producingTypesOwned: number;
  topBusiness: BusinessWithBalance | null;
};

export type {
  BalanceSheetSection,
  BusinessFinanceDashboard,
  BusinessFinancePeriodSnapshot,
  BusinessFinanceRecentEvent,
  BusinessFinanceSeriesPoint,
  BusinessValuationBreakdown,
  CashFlowSection,
  IncomeStatementRow,
} from "./finance";

export type { BusinessEntityType, BusinessType, BusinessUpgradeKey };
