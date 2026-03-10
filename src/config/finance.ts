import type { BusinessType } from "@/config/businesses";
import { NPC_PRICE_CEILINGS } from "@/config/items";

export const FINANCE_PERIODS = ["1h", "24h", "7d", "30d"] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number];

export const BUSINESS_LEDGER_CATEGORY_CLASSIFICATION = {
  opening_capital: "owner_equity",
  startup_purchase: "operating_expense",
  npc_sale: "revenue",
  market_sale: "revenue",
  contract_payout: "revenue",
  market_fee: "operating_expense",
  wage_payment: "operating_expense",
  storefront_ads: "operating_expense",
  upgrade_purchase: "operating_expense",
  market_purchase: "inventory",
  owner_transfer_in: "owner_equity",
  owner_transfer_out: "owner_draw",
  business_transfer_in: "intercompany",
  business_transfer_out: "intercompany",
} as const satisfies Record<string, "inventory" | "intercompany" | "operating_expense" | "owner_draw" | "owner_equity" | "revenue">;

export const INVENTORY_BASELINE_UNIT_COSTS: Record<string, number> = Object.fromEntries(
  Object.entries(NPC_PRICE_CEILINGS).map(([itemKey, ceiling]) => [itemKey, Number((ceiling * 0.55).toFixed(2))])
);

export const DEFAULT_INVENTORY_UNIT_COST = 0;

export const BUSINESS_VALUATION_MULTIPLIERS: Record<
  BusinessType,
  {
    profitMultiple: number;
    revenueMultiple: number;
    floor: number;
    label: string;
  }
> = {
  mine: { profitMultiple: 4.5, revenueMultiple: 1.2, floor: 3000, label: "asset-heavy extraction" },
  farm: { profitMultiple: 4.8, revenueMultiple: 1.3, floor: 2200, label: "yield-based production" },
  water_company: { profitMultiple: 5.4, revenueMultiple: 1.6, floor: 2000, label: "utility cash flow" },
  logging_camp: { profitMultiple: 4.7, revenueMultiple: 1.25, floor: 2800, label: "commodity production" },
  oil_well: { profitMultiple: 4.2, revenueMultiple: 1.15, floor: 4200, label: "cyclical extraction" },
  sawmill: { profitMultiple: 5.2, revenueMultiple: 1.45, floor: 3600, label: "light manufacturing" },
  metalworking_factory: { profitMultiple: 5.8, revenueMultiple: 1.55, floor: 5000, label: "margin-driven manufacturing" },
  food_processing_plant: { profitMultiple: 5.4, revenueMultiple: 1.6, floor: 3200, label: "repeat-demand manufacturing" },
  winery_distillery: { profitMultiple: 6, revenueMultiple: 1.75, floor: 4500, label: "brand-led manufacturing" },
  carpentry_workshop: { profitMultiple: 5.5, revenueMultiple: 1.5, floor: 4000, label: "craft manufacturing" },
  general_store: { profitMultiple: 4.4, revenueMultiple: 1.9, floor: 3600, label: "retail revenue multiple" },
  specialty_store: { profitMultiple: 4.9, revenueMultiple: 2.2, floor: 3400, label: "niche retail multiple" },
};
