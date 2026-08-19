import type { BusinessType } from "@/config/businesses";
import { NPC_PRICE_CEILINGS } from "@/config/items";

export const FINANCE_PERIODS = ["1h", "24h", "7d", "30d"] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number];

// -----------------------------------------------------------------------------
// Canonical Chart of Accounts (AccountingFixPlan Phase A)
//
// This is the single source of truth for which accounts exist in the game's
// simplified accrual accounting model. It intentionally stays small — one
// entry per economically distinct bucket the plan requires, not one per UI
// label. `type` determines which financial statement an account rolls up
// into and its normal balance side (which side of a journal entry increases
// it): asset/expense accounts are debit-normal, contra_asset is credit-normal
// (it reduces its paired asset), liability/equity/revenue accounts are
// credit-normal, and owner_draw is a contra-equity account (debit-normal — it
// reduces owner equity) even though it lives conceptually under "equity" on
// the balance sheet.
//
// Nothing outside src/config/finance.ts should redeclare account codes.
// Downstream phases (B–H) wire real money-moving code paths to post against
// these accounts via the double-entry journal (see business_journal_entries /
// business_journal_lines, migration 096); Phase A only defines the vocabulary
// and schema so later phases have one place to point at.
// -----------------------------------------------------------------------------

export type AccountType = "asset" | "contra_asset" | "liability" | "equity" | "revenue" | "expense";

export type AccountDefinition = {
  code: string;
  name: string;
  type: AccountType;
  /** Which statement this account appears on. */
  statement: "balance_sheet" | "income_statement" | "both";
  description: string;
};

export const CHART_OF_ACCOUNTS = {
  cash: {
    code: "cash",
    name: "Cash",
    type: "asset",
    statement: "balance_sheet",
    description: "Business cash on hand, mirrored by the business_accounts ledger balance.",
  },
  inventory: {
    code: "inventory",
    name: "Inventory",
    type: "asset",
    statement: "balance_sheet",
    description: "Carrying cost of on-hand inventory at weighted-average cost (business_inventory.total_cost).",
  },
  fixed_assets: {
    code: "fixed_assets",
    name: "Fixed Assets",
    type: "asset",
    statement: "balance_sheet",
    description: "Capitalized durable upgrades/equipment, gross of depreciation.",
  },
  accumulated_depreciation: {
    code: "accumulated_depreciation",
    name: "Accumulated Depreciation",
    type: "contra_asset",
    statement: "balance_sheet",
    description: "Cumulative straight-line depreciation against fixed_assets.",
  },
  wages_payable: {
    code: "wages_payable",
    name: "Wages Payable",
    type: "liability",
    statement: "balance_sheet",
    description: "Earned-but-unpaid payroll liability (unpaid_wage_due).",
  },
  loan_payable: {
    code: "loan_payable",
    name: "Loan Payable",
    type: "liability",
    statement: "balance_sheet",
    description: "Outstanding business debt principal, where business-level borrowing exists.",
  },
  owner_capital: {
    code: "owner_capital",
    name: "Owner Capital",
    type: "equity",
    statement: "balance_sheet",
    description: "Cumulative owner contributions into the business (personal -> business transfers in).",
  },
  owner_draw: {
    code: "owner_draw",
    name: "Owner Draw",
    type: "equity",
    statement: "balance_sheet",
    description: "Cumulative owner withdrawals from the business (business -> personal transfers). Contra-equity: debit-normal.",
  },
  retained_earnings: {
    code: "retained_earnings",
    name: "Retained Earnings",
    type: "equity",
    statement: "balance_sheet",
    description: "Cumulative net income not otherwise captured by owner_capital/owner_draw.",
  },
  intercompany: {
    code: "intercompany",
    name: "Intercompany Transfer",
    type: "equity",
    statement: "balance_sheet",
    description: "Cash moved between two businesses owned by the same player. Not revenue or expense for either side.",
  },
  revenue: {
    code: "revenue",
    name: "Revenue",
    type: "revenue",
    statement: "income_statement",
    description: "Recognized sales revenue from storefront, open-market, B2B, and contract fulfillment.",
  },
  cogs: {
    code: "cogs",
    name: "Cost of Goods Sold",
    type: "expense",
    statement: "income_statement",
    description: "Weighted-average inventory cost relieved when goods are sold or delivered.",
  },
  payroll_expense: {
    code: "payroll_expense",
    name: "Payroll Expense",
    type: "expense",
    statement: "income_statement",
    description: "Wage expense recognized when earned, regardless of whether it was paid or deferred to wages_payable.",
  },
  shipping_expense: {
    code: "shipping_expense",
    name: "Shipping Expense",
    type: "expense",
    statement: "income_statement",
    description: "Ordinary outbound/operating shipping cost. Inbound freight to acquire inventory is capitalized into inventory instead (see Phase F).",
  },
  market_fees: {
    code: "market_fees",
    name: "Market Fees",
    type: "expense",
    statement: "income_statement",
    description: "Transaction fees charged on storefront and open-market sales.",
  },
  advertising_expense: {
    code: "advertising_expense",
    name: "Advertising Expense",
    type: "expense",
    statement: "income_statement",
    description: "Storefront ad spend.",
  },
  depreciation_expense: {
    code: "depreciation_expense",
    name: "Depreciation Expense",
    type: "expense",
    statement: "income_statement",
    description: "Periodic straight-line depreciation of fixed_assets.",
  },
  interest_expense: {
    code: "interest_expense",
    name: "Interest Expense",
    type: "expense",
    statement: "income_statement",
    description: "Interest portion of loan payments, where business-level borrowing exists.",
  },
  operating_expense: {
    code: "operating_expense",
    name: "Other Operating Expense",
    type: "expense",
    statement: "income_statement",
    description: "Catch-all for currently-unclassified operating costs (startup purchases, employee hiring, contract acceptance fees, upgrade purchases prior to capitalization). Phases B-F progressively move specific flows out of this bucket into a named account.",
  },
} as const satisfies Record<string, AccountDefinition>;

export type AccountCode = keyof typeof CHART_OF_ACCOUNTS;

export const ACCOUNT_CODES = Object.keys(CHART_OF_ACCOUNTS) as AccountCode[];

const CREDIT_NORMAL_TYPES: ReadonlySet<AccountType> = new Set(["liability", "equity", "revenue"]);

/** Which side of a journal entry increases this account's balance. owner_draw is the one equity-typed exception: it's contra-equity, so it's debit-normal like an expense. */
export function getAccountNormalBalance(code: AccountCode): "debit" | "credit" {
  if (code === "owner_draw") return "debit";
  const type = CHART_OF_ACCOUNTS[code].type;
  return CREDIT_NORMAL_TYPES.has(type) ? "credit" : "debit";
}

export function isAccountCode(value: string): value is AccountCode {
  return Object.prototype.hasOwnProperty.call(CHART_OF_ACCOUNTS, value);
}

// -----------------------------------------------------------------------------
// Legacy business_accounts ledger category -> report bucket classification.
//
// business_accounts.category is a free-text column (pre-dates the chart of
// accounts above); this map is what lets the finance dashboard interpret it.
// Typed as `satisfies Record<LedgerCategory, ...>` so every category string
// actually written anywhere in the codebase (searched across src/, shared/,
// and supabase/migrations/*.sql) must have an entry here or this file fails
// to typecheck — categories can no longer silently fall outside the reports.
// Kept additive/non-breaking for Phase A: values are unchanged from before
// except for adding the previously-missing `shipping_fee` key (it already
// fell back to "operating_expense" via `?? "operating_expense"` in
// src/domains/businesses/finance.ts, so this makes existing behavior
// explicit rather than changing it). Later phases (see AccountingFixPlan)
// migrate specific categories to the richer accounts above (e.g.
// wage_payment -> payroll_expense in Phase B) as each area is fixed.
// -----------------------------------------------------------------------------

export type LedgerCategory =
  | "opening_capital"
  | "startup_purchase"
  | "npc_sale"
  | "market_sale"
  | "contract_payout"
  | "contract_acceptance"
  | "market_fee"
  | "wage_payment"
  | "employee_hire"
  | "employee_wage_settlement"
  | "storefront_ads"
  | "upgrade_purchase"
  | "market_purchase"
  | "buy_order_escrow"
  | "buy_order_release"
  | "owner_transfer_in"
  | "owner_transfer_out"
  | "business_transfer_in"
  | "business_transfer_out"
  | "shipping_fee";

export const BUSINESS_LEDGER_CATEGORY_CLASSIFICATION = {
  opening_capital: "owner_equity",
  startup_purchase: "operating_expense",
  npc_sale: "revenue",
  market_sale: "revenue",
  contract_payout: "revenue",
  contract_acceptance: "operating_expense",
  market_fee: "operating_expense",
  wage_payment: "operating_expense",
  employee_hire: "operating_expense",
  employee_wage_settlement: "operating_expense",
  storefront_ads: "operating_expense",
  upgrade_purchase: "operating_expense",
  market_purchase: "inventory",
  buy_order_escrow: "inventory",
  buy_order_release: "inventory",
  owner_transfer_in: "owner_equity",
  owner_transfer_out: "owner_draw",
  business_transfer_in: "intercompany",
  business_transfer_out: "intercompany",
  shipping_fee: "operating_expense",
} as const satisfies Record<LedgerCategory, "inventory" | "intercompany" | "operating_expense" | "owner_draw" | "owner_equity" | "revenue">;

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
