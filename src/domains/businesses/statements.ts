// AccountingFixPlan Phase G: real financial statements (items 47-49).
//
// This module is the authoritative source for the Balance Sheet, Income
// Statement, and Cash Flow Statement -- built from actual accounting data,
// not the legacy category-string heuristics in finance.ts's per-period
// dashboard (that file's `balanceSheet` field is fixed to call into this
// module too; see getBusinessFinanceDashboard).
//
// Source of truth for each figure:
//   - Cash: business_accounts (the cash ledger), via get_business_account_balance
//     for a point-in-time balance, or summed directly for a period's cash flow.
//   - Inventory (book value): SUM(business_inventory.total_cost) -- NEVER
//     market/NPC prices. Item 47/50: "Do not use current market prices to
//     calculate accounting inventory value." Market-based valuation is a
//     separate feature (getBusinessFinanceDashboard's `valuation` field) that
//     intentionally does not feed this module.
//   - Fixed assets / depreciation: business_financial_events rows with
//     account_code='fixed_assets' (cost + acquisition date = effective_at),
//     depreciated straight-line using FIXED_ASSET_USEFUL_LIFE_MONTHS
//     (src/config/finance.ts). Computed analytically at report time -- there
//     is no periodic depreciation tick or journal posting.
//   - Wages payable: SUM(employees.unpaid_wage_due) for the business's
//     employees -- the running liability balance Phase B already maintains,
//     not re-derived from the journal (only payroll posts to the journal so
//     far; this is simpler and equally authoritative).
//   - Revenue / COGS / Payroll Expense / Operating Expense: business_financial_events,
//     grouped by account_code. Every revenue-generating path in this codebase
//     (storefront, market, buy orders, B2B, contracts) writes these
//     consistently as of Phases B-F; this is a completely covered source,
//     unlike business_journal_lines (only a subset of paths post there as of
//     Phase G -- buy-order fills deliberately don't, see migration 108's
//     header comment). Using financial_events here means every revenue path
//     is represented, at the cost of not being literal double-entry; the
//     journal remains available as an independent reconciliation source for
//     the paths that do post to it (Phase H's reconciliation RPCs, item 53).
//   - Owner capital / draw: business_accounts categories opening_capital +
//     owner_transfer_in (capital) and owner_transfer_out (draw).
//   - Cash flow classification: CASH_FLOW_CLASSIFICATION (src/config/finance.ts),
//     applied to business_accounts entries -- independent of the accrual
//     income statement (e.g. B2B inbound freight is an Operating cash outflow
//     per item 49's own worked examples, but is capitalized into inventory,
//     not expensed, on the income statement -- see FIXED_ASSET note above and
//     item 45).
//
// Known limitation (documented, not silently hidden, per item 53's own
// rule): in-transit B2B shipments are a temporary real Balance Sheet
// imbalance for the destination business -- cash left at dispatch but the
// landed-cost inventory asset isn't recognized until delivery, and this game
// has no "goods in transit" balance-sheet line. See migration 108's header
// comment for the full explanation. `getBalanceSheet`'s `balanced` flag will
// correctly read false for a business with active in-transit shipments.

import { CASH_FLOW_CLASSIFICATION, FIXED_ASSET_USEFUL_LIFE_MONTHS, type LedgerCategory } from "@/config/finance";
import { round2, toNumber } from "@/lib/core/number";
import { nowIso } from "@/lib/core/time";
import type { QueryClient } from "@/lib/db/query-client";
import type { Business } from "./types";

export type StatementPeriod = {
  /** Inclusive lower bound (ISO timestamp). Omit/null for "since business inception". */
  from?: string | null;
  /** Exclusive upper bound (ISO timestamp). Defaults to now. */
  to?: string;
};

export type IncomeStatement = {
  periodStart: string | null;
  periodEnd: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: {
    payroll: number;
    depreciation: number;
    other: number;
    total: number;
  };
  operatingIncome: number;
  netIncome: number;
};

export type BalanceSheet = {
  asOf: string;
  assets: {
    cash: number;
    inventory: number;
    fixedAssetsGross: number;
    accumulatedDepreciation: number;
    fixedAssetsNet: number;
    total: number;
  };
  liabilities: {
    wagesPayable: number;
    total: number;
  };
  equity: {
    ownerCapital: number;
    ownerDraw: number;
    retainedEarnings: number;
    total: number;
  };
  /** Assets == Liabilities + Equity, within a cent of rounding. False is a real, reportable discrepancy -- see this file's header comment for the one known cause (in-transit B2B shipments). */
  balanced: boolean;
};

export type CashFlowStatement = {
  periodStart: string | null;
  periodEnd: string;
  beginningCash: number;
  operating: number;
  investing: number;
  financing: number;
  netCashFlow: number;
  endingCash: number;
  /** beginningCash + netCashFlow == endingCash, within a cent of rounding. */
  reconciles: boolean;
};

type FinancialEventAmountRow = { account_code: string; amount: number | string; effective_at: string };
type FixedAssetRow = { cost: number; acquiredAt: string };
type LedgerAmountRow = { amount: number | string; entry_type: "credit" | "debit"; category: string; created_at: string };

async function getFixedAssetRows(client: QueryClient, businessId: string): Promise<FixedAssetRow[]> {
  const { data, error } = await client
    .from("business_financial_events")
    .select("amount, effective_at")
    .eq("business_id", businessId)
    .eq("account_code", "fixed_assets");
  if (error) throw error;
  return ((data as { amount: number | string; effective_at: string }[]) ?? []).map((row) => ({
    cost: toNumber(row.amount),
    acquiredAt: row.effective_at,
  }));
}

/** Straight-line accumulated depreciation across every fixed-asset row, as of `asOfIso`. A month is treated as exactly 30 days -- a deliberate simplification (item 46 calls straight-line depreciation with a "simple configurable useful life" acceptable, not calendar-accurate depreciation). */
export function computeAccumulatedDepreciation(rows: FixedAssetRow[], asOfIso: string): number {
  const asOfMs = new Date(asOfIso).getTime();
  const msPerMonth = 30 * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const row of rows) {
    if (row.cost <= 0) continue;
    const acquiredMs = new Date(row.acquiredAt).getTime();
    if (Number.isNaN(acquiredMs) || asOfMs <= acquiredMs) continue;
    const monthsElapsed = (asOfMs - acquiredMs) / msPerMonth;
    const monthlyRate = row.cost / FIXED_ASSET_USEFUL_LIFE_MONTHS;
    total += Math.min(row.cost, monthlyRate * monthsElapsed);
  }
  return round2(total);
}

function sumFinancialEvents(rows: FinancialEventAmountRow[], accountCode: string, from: string | null, to: string): number {
  return round2(
    rows
      .filter((row) => row.account_code === accountCode && (!from || row.effective_at >= from) && row.effective_at < to)
      .reduce((sum, row) => sum + toNumber(row.amount), 0)
  );
}

export async function getIncomeStatement(
  client: QueryClient,
  business: Pick<Business, "id">,
  period: StatementPeriod = {}
): Promise<IncomeStatement> {
  const to = period.to ?? nowIso();
  const from = period.from ?? null;

  const [eventsRes, fixedAssetRows] = await Promise.all([
    client
      .from("business_financial_events")
      .select("account_code, amount, effective_at")
      .eq("business_id", business.id)
      .lt("effective_at", to)
      .gte("effective_at", from ?? "1970-01-01T00:00:00.000Z"),
    getFixedAssetRows(client, business.id),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  const events = (eventsRes.data as FinancialEventAmountRow[]) ?? [];

  const revenue = sumFinancialEvents(events, "revenue", from, to);
  const cogs = sumFinancialEvents(events, "cogs", from, to);
  const grossProfit = round2(revenue - cogs);
  const payroll = sumFinancialEvents(events, "payroll_expense", from, to);
  const other = sumFinancialEvents(events, "operating_expense", from, to);
  const depreciation = round2(
    computeAccumulatedDepreciation(fixedAssetRows, to) - computeAccumulatedDepreciation(fixedAssetRows, from ?? new Date(0).toISOString())
  );
  const operatingExpensesTotal = round2(payroll + other + depreciation);
  const operatingIncome = round2(grossProfit - operatingExpensesTotal);

  return {
    periodStart: from,
    periodEnd: to,
    revenue,
    cogs,
    grossProfit,
    operatingExpenses: {
      payroll,
      depreciation,
      other,
      total: operatingExpensesTotal,
    },
    operatingIncome,
    netIncome: operatingIncome,
  };
}

export async function getBalanceSheet(
  client: QueryClient,
  business: Pick<Business, "id" | "player_id">,
  asOf: string = nowIso()
): Promise<BalanceSheet> {
  const [cashRes, inventoryRes, employeesRes, ledgerRes, fixedAssetRows, incomeStatement] = await Promise.all([
    client.rpc("get_business_account_balance", { p_business_id: business.id }),
    client
      .from("business_inventory")
      .select("total_cost, unit_cost, quantity")
      .eq("owner_player_id", business.player_id)
      .eq("business_id", business.id),
    client.from("employees").select("unpaid_wage_due").eq("employer_business_id", business.id),
    client
      .from("business_accounts")
      .select("amount, category")
      .eq("business_id", business.id)
      .in("category", ["opening_capital", "owner_transfer_in", "owner_transfer_out"] satisfies LedgerCategory[]),
    getFixedAssetRows(client, business.id),
    getIncomeStatement(client, business, { from: null, to: asOf }),
  ]);
  if (inventoryRes.error) throw inventoryRes.error;
  if (employeesRes.error) throw employeesRes.error;
  if (ledgerRes.error) throw ledgerRes.error;

  const cash = round2(toNumber(cashRes.data));

  const inventory = round2(
    ((inventoryRes.data as { total_cost: number | string | null; unit_cost: number | string | null; quantity: number | string }[]) ?? []).reduce(
      (sum, row) =>
        sum +
        (row.total_cost !== null ? toNumber(row.total_cost) : toNumber(row.unit_cost ?? 0) * toNumber(row.quantity)),
      0
    )
  );

  const wagesPayable = round2(
    ((employeesRes.data as { unpaid_wage_due: number | string | null }[]) ?? []).reduce(
      (sum, row) => sum + toNumber(row.unpaid_wage_due ?? 0),
      0
    )
  );

  const fixedAssetsGross = round2(fixedAssetRows.reduce((sum, row) => sum + row.cost, 0));
  const accumulatedDepreciation = computeAccumulatedDepreciation(fixedAssetRows, asOf);
  const fixedAssetsNet = round2(fixedAssetsGross - accumulatedDepreciation);

  const ledgerRows = (ledgerRes.data as { amount: number | string; category: string }[]) ?? [];
  const ownerCapital = round2(
    ledgerRows
      .filter((row) => row.category === "opening_capital" || row.category === "owner_transfer_in")
      .reduce((sum, row) => sum + toNumber(row.amount), 0)
  );
  const ownerDraw = round2(
    ledgerRows.filter((row) => row.category === "owner_transfer_out").reduce((sum, row) => sum + toNumber(row.amount), 0)
  );
  const retainedEarnings = incomeStatement.netIncome;

  const totalAssets = round2(cash + inventory + fixedAssetsNet);
  const totalLiabilities = wagesPayable;
  const totalEquity = round2(ownerCapital - ownerDraw + retainedEarnings);

  return {
    asOf,
    assets: {
      cash,
      inventory,
      fixedAssetsGross,
      accumulatedDepreciation,
      fixedAssetsNet,
      total: totalAssets,
    },
    liabilities: {
      wagesPayable,
      total: totalLiabilities,
    },
    equity: {
      ownerCapital,
      ownerDraw,
      retainedEarnings,
      total: totalEquity,
    },
    balanced: Math.abs(round2(totalAssets - (totalLiabilities + totalEquity))) < 0.01,
  };
}

export async function getCashFlowStatement(
  client: QueryClient,
  business: Pick<Business, "id">,
  period: StatementPeriod = {}
): Promise<CashFlowStatement> {
  const to = period.to ?? nowIso();
  const from = period.from ?? null;

  const { data, error } = await client
    .from("business_accounts")
    .select("amount, entry_type, category, created_at")
    .eq("business_id", business.id)
    .lt("created_at", to)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data as LedgerAmountRow[]) ?? [];

  const signedAmount = (row: LedgerAmountRow) => (row.entry_type === "credit" ? toNumber(row.amount) : -toNumber(row.amount));

  const beforeFrom = from ? rows.filter((row) => row.created_at < from) : [];
  const beginningCash = round2(beforeFrom.reduce((sum, row) => sum + signedAmount(row), 0));

  const inRange = rows.filter((row) => (!from || row.created_at >= from) && row.created_at < to);
  const sectionTotal = (section: "operating" | "investing" | "financing") =>
    round2(
      inRange
        .filter((row) => CASH_FLOW_CLASSIFICATION[row.category as LedgerCategory] === section)
        .reduce((sum, row) => sum + signedAmount(row), 0)
    );

  const operating = sectionTotal("operating");
  const investing = sectionTotal("investing");
  const financing = sectionTotal("financing");
  const netCashFlow = round2(operating + investing + financing);
  const endingCash = round2(beginningCash + inRange.reduce((sum, row) => sum + signedAmount(row), 0));

  return {
    periodStart: from,
    periodEnd: to,
    beginningCash,
    operating,
    investing,
    financing,
    netCashFlow,
    endingCash,
    reconciles: Math.abs(round2(beginningCash + netCashFlow - endingCash)) < 0.01,
  };
}
