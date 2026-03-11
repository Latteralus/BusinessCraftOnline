import {
  BUSINESS_LEDGER_CATEGORY_CLASSIFICATION,
  BUSINESS_VALUATION_MULTIPLIERS,
  DEFAULT_INVENTORY_UNIT_COST,
  FINANCE_PERIODS,
  INVENTORY_BASELINE_UNIT_COSTS,
  type FinancePeriod,
} from "@/config/finance";
import { round2, toNumber } from "@/lib/core/number";
import { addHoursToNowIso, nowIso } from "@/lib/core/time";
import type { QueryClient } from "@/lib/db/query-client";
import { formatCurrency } from "@/lib/formatters";
import { supportsStorefront } from "./capabilities";
import type { Business, BusinessAccountEntry } from "./types";

type FinancialEventAccountCode =
  | "cash"
  | "inventory"
  | "revenue"
  | "cogs"
  | "operating_expense"
  | "owner_equity"
  | "owner_draw"
  | "liability"
  | "other_income_expense";

type FinancialEventRow = {
  id: string;
  business_id: string;
  account_code: FinancialEventAccountCode;
  amount: number | string;
  quantity: number | string | null;
  item_key: string | null;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  effective_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type InventorySnapshotRow = {
  id: string;
  item_key: string;
  quality: number | string;
  quantity: number | string;
  reserved_quantity: number | string;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
};

type StorefrontSnapshotRow = {
  id: string;
  business_id: string;
  shoppers_generated: number | string;
  sales_count: number | string;
  units_sold: number | string;
  gross_revenue: number | string;
  fee_total: number | string;
  ad_spend: number | string;
  captured_at: string;
};

type StorefrontTransactionRow = {
  id: string;
  seller_business_id: string;
  buyer_type: "player" | "npc";
  item_key: string;
  quantity: number | string;
  gross_total: number | string;
  market_fee: number | string;
  created_at: string;
};

type StorefrontPeriodEvidence = {
  shoppersGenerated: number;
  salesCount: number;
  unitsSold: number;
  grossRevenue: number;
  feeTotal: number;
  adSpend: number;
};

type LedgerEvent = {
  id: string;
  source: "ledger";
  accountCode: Exclude<FinancialEventAccountCode, "cash" | "cogs" | "liability" | "other_income_expense"> | "intercompany";
  amount: number;
  effectiveAt: string;
  description: string;
  category: string;
  referenceId: string | null;
  entryType: "credit" | "debit";
};

type DerivedFinancialEvent = {
  id: string;
  source: "financial_event";
  accountCode: FinancialEventAccountCode;
  amount: number;
  effectiveAt: string;
  description: string;
  quantity: number | null;
  itemKey: string | null;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown> | null;
};

type PeriodRange = {
  key: FinancePeriod;
  since: string | null;
  label: string;
  days: number | null;
};

export type IncomeStatementRow = {
  label: string;
  amount: number;
  tone?: "neutral" | "positive" | "negative" | "muted";
};

export type BalanceSheetSection = {
  label: string;
  amount: number;
};

export type CashFlowSection = {
  label: string;
  amount: number;
};

export type BusinessFinanceSeriesPoint = {
  label: string;
  bucketStart: string;
  bucketEnd: string;
  isCurrent: boolean;
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpense: number;
  cash: number;
};

export type BusinessValuationBreakdown = {
  currentValue: number;
  previousValue: number;
  baseValue: number;
  profitMultiple: number;
  revenueMultiple: number;
  methodology: string;
  annualizedRevenue: number;
  annualizedOperatingProfit: number;
  inventoryAssetValue: number;
  cash: number;
  liabilities: number;
  confidence: "estimated" | "observed";
};

export type BusinessFinanceRecentEvent = {
  id: string;
  occurredAt: string;
  label: string;
  amount: number;
  accountCode: string;
  source: "ledger" | "financial_event";
  sourceLabel: string;
  accountLabel: string;
  postingType: "debit" | "credit";
};

export type BusinessFinancePeriodSnapshot = {
  period: FinancePeriod;
  label: string;
  kpis: {
    cash: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMargin: number | null;
    operatingExpense: number;
    operatingProfit: number;
    ownerEquity: number;
    inventoryAssetValue: number;
    liabilities: number;
    valuation: number;
  };
  storefront: {
    shoppersGenerated: number;
    salesCount: number;
    unitsSold: number;
    grossRevenue: number;
    feeTotal: number;
    adSpend: number;
    netRevenue: number;
    conversionRate: number | null;
    averageTicket: number | null;
  };
  incomeStatement: IncomeStatementRow[];
  cashFlow: CashFlowSection[];
  capital: {
    ownerContributions: number;
    ownerDraws: number;
    intercompanySales: number;
    intercompanyPurchases: number;
  };
  series: BusinessFinanceSeriesPoint[];
  recentEvents: BusinessFinanceRecentEvent[];
};

export type BusinessFinanceHealth = {
  status: "making_money" | "losing_money" | "break_even";
  tone: "positive" | "negative" | "neutral";
  headline: string;
  reason: string;
  runwayDays: number | null;
  cashDelta24h: number;
  warnings: string[];
};

export type BusinessFinanceDashboard = {
  generatedAt: string;
  currentPeriod: FinancePeriod;
  periods: Record<FinancePeriod, BusinessFinancePeriodSnapshot>;
  balanceSheet: BalanceSheetSection[];
  valuation: BusinessValuationBreakdown;
  health: BusinessFinanceHealth;
  assumptions: string[];
};

function normalizeBusinessAccountEntry(row: BusinessAccountEntry): BusinessAccountEntry {
  return {
    ...row,
    amount: toNumber(row.amount),
  };
}

function normalizeFinancialEventRow(row: FinancialEventRow): DerivedFinancialEvent {
  return {
    id: row.id,
    source: "financial_event",
    accountCode: row.account_code,
    amount: toNumber(row.amount),
    effectiveAt: row.effective_at,
    description: row.description,
    quantity: row.quantity === null ? null : Number(row.quantity),
    itemKey: row.item_key ?? null,
    referenceType: row.reference_type ?? null,
    referenceId: row.reference_id ?? null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata
        : null,
  };
}

function getPeriodRanges(): PeriodRange[] {
  return [
    { key: "1h", since: addHoursToNowIso(-1), label: "Last Hour", days: 1 / 24 },
    { key: "24h", since: addHoursToNowIso(-24), label: "Last 24 Hours", days: 1 },
    { key: "7d", since: addHoursToNowIso(-24 * 7), label: "Last 7 Days", days: 7 },
    { key: "30d", since: addHoursToNowIso(-24 * 30), label: "Last 30 Days", days: 30 },
  ];
}

function toLedgerEvent(entry: BusinessAccountEntry): LedgerEvent {
  const mapped = BUSINESS_LEDGER_CATEGORY_CLASSIFICATION[
    entry.category as keyof typeof BUSINESS_LEDGER_CATEGORY_CLASSIFICATION
  ] ?? "operating_expense";
  return {
    id: entry.id,
    source: "ledger",
    accountCode: mapped,
    amount: toNumber(entry.amount),
    effectiveAt: entry.created_at,
    description: entry.description,
    category: entry.category,
    referenceId: entry.reference_id,
    entryType: entry.entry_type,
  };
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatQuantity(quantity: number, itemKey: string): string {
  return `${quantity} ${quantity === 1 ? "unit" : "units"} of ${toTitleCase(itemKey)}`;
}

function formatLedgerDescription(description: string, category: string): string {
  const wageMatch = description.match(/^Wage payment:\s*(.+)$/i);
  if (wageMatch) {
    return `Payroll disbursement, ${wageMatch[1].trim()}`;
  }

  const saleMatch = description.match(/^(?:NPC|PLAYER)\s+market sale:\s*(\d+)x\s+(.+)$/i);
  if (saleMatch) {
    return `Marketplace sale proceeds, ${formatQuantity(Number(saleMatch[1]), saleMatch[2].trim())}`;
  }

  const feeMatch = description.match(/^Market fee:\s*(\d+)x\s+(.+)$/i);
  if (feeMatch) {
    return `Marketplace transaction fee, ${formatQuantity(Number(feeMatch[1]), feeMatch[2].trim())}`;
  }

  const purchaseMatch = description.match(/^Market purchase:\s*(\d+)x\s+(.+)$/i);
  if (purchaseMatch) {
    return `Inventory purchase, ${formatQuantity(Number(purchaseMatch[1]), purchaseMatch[2].trim())}`;
  }

  switch (category) {
    case "opening_capital":
      return "Initial capital contribution";
    case "owner_transfer_in":
      return "Owner capital contribution";
    case "owner_transfer_out":
      return "Owner draw distribution";
    case "business_transfer_in":
      return "Intercompany transfer received";
    case "business_transfer_out":
      return "Intercompany transfer disbursed";
    case "startup_purchase":
      return "Business setup expenditure";
    case "upgrade_purchase":
      return "Capital improvement expenditure";
    case "storefront_ads":
      return "Storefront advertising expense";
    default:
      return description;
  }
}

function formatFinancialEventDescription(event: DerivedFinancialEvent): string {
  switch (event.accountCode) {
    case "revenue":
      return event.quantity && event.itemKey
        ? `Revenue recognized, ${formatQuantity(event.quantity, event.itemKey)}`
        : "Revenue recognized";
    case "cogs":
      return event.quantity && event.itemKey
        ? `Cost of goods sold recognized, ${formatQuantity(event.quantity, event.itemKey)}`
        : "Cost of goods sold recognized";
    case "inventory":
      return event.quantity && event.itemKey
        ? `Inventory movement recorded, ${formatQuantity(event.quantity, event.itemKey)}`
        : "Inventory movement recorded";
    case "operating_expense":
      return event.quantity && event.itemKey
        ? `Operating expense recognized, ${formatQuantity(event.quantity, event.itemKey)}`
        : "Operating expense recognized";
    default:
      return event.description;
  }
}

function getAccountLabel(accountCode: string): string {
  switch (accountCode) {
    case "operating_expense":
      return "Operating Expense";
    case "owner_equity":
      return "Owner Equity";
    case "owner_draw":
      return "Owner Draw";
    case "intercompany":
      return "Intercompany";
    case "cogs":
      return "Cost of Goods Sold";
    default:
      return toTitleCase(accountCode);
  }
}

function getPostingType(event: LedgerEvent | DerivedFinancialEvent): "debit" | "credit" {
  if (event.source === "ledger") {
    return event.entryType;
  }

  switch (event.accountCode) {
    case "revenue":
    case "owner_equity":
    case "liability":
    case "other_income_expense":
      return "credit";
    default:
      return "debit";
  }
}

function getInventoryUnitCost(row: InventorySnapshotRow): { unitCost: number; estimated: boolean } {
  const explicitUnitCost = row.unit_cost === undefined || row.unit_cost === null ? null : toNumber(row.unit_cost);
  if (explicitUnitCost !== null && explicitUnitCost > 0) {
    return { unitCost: explicitUnitCost, estimated: false };
  }

  const explicitTotalCost = row.total_cost === undefined || row.total_cost === null ? null : toNumber(row.total_cost);
  const quantity = Math.max(0, toNumber(row.quantity));
  if (explicitTotalCost !== null && explicitTotalCost > 0 && quantity > 0) {
    return { unitCost: round2(explicitTotalCost / quantity), estimated: false };
  }

  return {
    unitCost: INVENTORY_BASELINE_UNIT_COSTS[row.item_key] ?? DEFAULT_INVENTORY_UNIT_COST,
    estimated: true,
  };
}

function buildInventorySnapshot(rows: InventorySnapshotRow[]) {
  let inventoryAssetValue = 0;
  let estimatedRows = 0;

  for (const row of rows) {
    const quantity = Math.max(0, toNumber(row.quantity));
    const totalCost = row.total_cost === undefined || row.total_cost === null ? null : toNumber(row.total_cost);
    if (totalCost !== null && totalCost > 0) {
      inventoryAssetValue += totalCost;
      continue;
    }
    const { unitCost, estimated } = getInventoryUnitCost(row);
    inventoryAssetValue += quantity * unitCost;
    if (estimated) estimatedRows += 1;
  }

  return {
    inventoryAssetValue: round2(inventoryAssetValue),
    estimatedRows,
  };
}

function normalizeStorefrontSnapshotRow(row: StorefrontSnapshotRow) {
  return {
    ...row,
    shoppers_generated: Number(row.shoppers_generated),
    sales_count: Number(row.sales_count),
    units_sold: Number(row.units_sold),
    gross_revenue: toNumber(row.gross_revenue),
    fee_total: toNumber(row.fee_total),
    ad_spend: toNumber(row.ad_spend),
  };
}

function normalizeStorefrontTransactionRow(row: StorefrontTransactionRow) {
  return {
    ...row,
    quantity: Number(row.quantity),
    gross_total: toNumber(row.gross_total),
    market_fee: toNumber(row.market_fee),
  };
}

function buildStorefrontEvidence(input: {
  snapshotShoppersGenerated: number;
  snapshotSalesCount: number;
  snapshotUnitsSold: number;
  snapshotGrossRevenue: number;
  snapshotFeeTotal: number;
  snapshotAdSpend: number;
  transactionSalesCount: number;
  transactionUnitsSold: number;
  transactionGrossRevenue: number;
  transactionFeeTotal: number;
  ledgerSalesCount: number;
  ledgerGrossRevenue: number;
  ledgerFeeTotal: number;
  eventRevenue: number;
  eventCogs: number;
  eventFeeTotal: number;
}): StorefrontPeriodEvidence {
  const salesCount = Math.max(
    input.snapshotSalesCount,
    input.transactionSalesCount,
    input.ledgerSalesCount
  );
  const unitsSold = Math.max(
    input.snapshotUnitsSold,
    input.transactionUnitsSold
  );
  const grossRevenue = round2(
    Math.max(
      input.snapshotGrossRevenue,
      input.transactionGrossRevenue,
      input.ledgerGrossRevenue,
      input.eventRevenue
    )
  );
  const feeTotal = round2(
    Math.max(
      input.snapshotFeeTotal,
      input.transactionFeeTotal,
      input.ledgerFeeTotal,
      input.eventFeeTotal
    )
  );

  return {
    shoppersGenerated: input.snapshotShoppersGenerated,
    salesCount,
    unitsSold,
    grossRevenue,
    feeTotal,
    adSpend: input.snapshotAdSpend,
  };
}

function groupAmountByDay<T extends { effectiveAt: string }>(
  rows: T[],
  selectAmount: (row: T) => number
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.effectiveAt.slice(0, 10);
    map.set(key, round2((map.get(key) ?? 0) + selectAmount(row)));
  }
  return map;
}

function getBucketConfig(period: FinancePeriod) {
  switch (period) {
    case "1h":
      return { bucketMs: 5 * 60 * 1000 };
    case "24h":
      return { bucketMs: 30 * 60 * 1000 };
    case "7d":
      return { bucketMs: 6 * 60 * 60 * 1000 };
    case "30d":
    default:
      return { bucketMs: 24 * 60 * 60 * 1000 };
  }
}

function floorToBucket(timestampMs: number, bucketMs: number) {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

function groupAmountByBucket<T extends { effectiveAt: string }>(
  rows: T[],
  bucketMs: number,
  selectAmount: (row: T) => number
): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) {
    const timestamp = new Date(row.effectiveAt).getTime();
    if (Number.isNaN(timestamp)) continue;
    const key = floorToBucket(timestamp, bucketMs);
    map.set(key, round2((map.get(key) ?? 0) + selectAmount(row)));
  }
  return map;
}

function formatBucketLabel(period: FinancePeriod, bucketStartMs: number): string {
  const date = new Date(bucketStartMs);
  if (period === "1h" || period === "24h") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  if (period === "7d") {
    return new Intl.DateTimeFormat("en-US", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toRecentEvent(event: LedgerEvent | DerivedFinancialEvent): BusinessFinanceRecentEvent {
  return {
    id: event.id,
    occurredAt: event.effectiveAt,
    label:
      event.source === "ledger"
        ? formatLedgerDescription(event.description, event.category)
        : formatFinancialEventDescription(event),
    amount: round2(event.amount),
    accountCode: event.accountCode,
    source: event.source,
    sourceLabel: event.source === "ledger" ? "Ledger Posting" : "System Adjustment",
    accountLabel: getAccountLabel(event.accountCode),
    postingType: getPostingType(event),
  };
}

function buildSeries(
  period: PeriodRange,
  ledgerEvents: LedgerEvent[],
  financialEvents: DerivedFinancialEvent[],
  currentCashBalance: number
): BusinessFinanceSeriesPoint[] {
  const combined = [...ledgerEvents, ...financialEvents].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  const { bucketMs } = getBucketConfig(period.key);
  const nowMs = Date.now();
  const startMs = period.since
    ? floorToBucket(new Date(period.since).getTime(), bucketMs)
    : combined[0]
      ? floorToBucket(new Date(combined[0].effectiveAt).getTime(), bucketMs)
      : floorToBucket(nowMs, bucketMs);
  const endBucketStartMs = floorToBucket(nowMs, bucketMs);

  if (Number.isNaN(startMs)) return [];

  const revenueByBucket = groupAmountByBucket(
    ledgerEvents.filter((row) => row.accountCode === "revenue"),
    bucketMs,
    (row) => row.amount
  );
  const transferRevenueByBucket = groupAmountByBucket(
    financialEvents.filter(
      (row) => row.accountCode === "revenue" && row.referenceType === "inventory_transfer"
    ),
    bucketMs,
    (row) => row.amount
  );
  const opexByBucket = groupAmountByBucket(
    ledgerEvents.filter((row) => row.accountCode === "operating_expense"),
    bucketMs,
    (row) => row.amount
  );
  const cogsByBucket = groupAmountByBucket(
    financialEvents.filter((row) => row.accountCode === "cogs"),
    bucketMs,
    (row) => row.amount
  );
  const cashDeltaByBucket = groupAmountByBucket(ledgerEvents, bucketMs, (row) => {
    if (row.accountCode === "intercompany") return 0;
    if (row.accountCode === "revenue" || row.accountCode === "owner_equity") return row.amount;
    return -row.amount;
  });

  let runningCash = round2(
    currentCashBalance -
      Array.from(cashDeltaByBucket.entries())
        .filter(([bucketStart]) => bucketStart >= startMs)
        .reduce((sum, [, value]) => sum + value, 0)
  );

  const points: BusinessFinanceSeriesPoint[] = [];
  for (let bucketStartMs = startMs; bucketStartMs <= endBucketStartMs; bucketStartMs += bucketMs) {
    const bucketEndMs = bucketStartMs + bucketMs;
    runningCash = round2(runningCash + (cashDeltaByBucket.get(bucketStartMs) ?? 0));
    const revenue = round2((revenueByBucket.get(bucketStartMs) ?? 0) + (transferRevenueByBucket.get(bucketStartMs) ?? 0));
    const cogs = round2(cogsByBucket.get(bucketStartMs) ?? 0);
    const operatingExpense = round2(opexByBucket.get(bucketStartMs) ?? 0);
    points.push({
      label: formatBucketLabel(period.key, bucketStartMs),
      bucketStart: new Date(bucketStartMs).toISOString(),
      bucketEnd: new Date(bucketEndMs).toISOString(),
      isCurrent: bucketStartMs === endBucketStartMs,
      revenue,
      cogs,
      grossProfit: round2(revenue - cogs),
      operatingExpense,
      cash: runningCash,
    });
  }

  return points;
}

function sumAmounts<T>(rows: T[], predicate: (row: T) => boolean, selectAmount: (row: T) => number): number {
  return round2(rows.filter(predicate).reduce((sum, row) => sum + selectAmount(row), 0));
}

function annualize(amount: number, days: number | null): number {
  if (!days || days <= 0) return amount;
  return round2((amount / days) * 365);
}

function buildHealth(periods: Record<FinancePeriod, BusinessFinancePeriodSnapshot>): BusinessFinanceHealth {
  const now = periods["1h"];
  const today = periods["24h"];
  const week = periods["7d"];
  const month = periods["30d"];
  const currentProfit = today.kpis.operatingProfit;
  const weekProfit = week.kpis.operatingProfit;
  const monthProfit = month.kpis.operatingProfit;
  const cashDelta24h = round2(
    today.series.length >= 2
      ? Number(today.series[today.series.length - 1]?.cash ?? 0) - Number(today.series[0]?.cash ?? 0)
      : 0
  );
  const weekDailyProfit = weekProfit / 7;
  const todayVsWeekPace = weekDailyProfit !== 0 ? currentProfit / weekDailyProfit : null;
  const dailyBurn = monthProfit < 0 ? Math.abs(monthProfit / 30) : weekProfit < 0 ? Math.abs(weekProfit / 7) : 0;
  const runwayDays = dailyBurn > 0 ? round2(now.kpis.cash / dailyBurn) : null;

  let status: BusinessFinanceHealth["status"] = "break_even";
  let tone: BusinessFinanceHealth["tone"] = "neutral";
  let headline = "Break-even";
  if (weekProfit > 0 || monthProfit > 0) {
    status = "making_money";
    tone = "positive";
    headline = "Making money";
  } else if (currentProfit < 0 || weekProfit < 0 || monthProfit < 0) {
    status = "losing_money";
    tone = "negative";
    headline = "Losing money";
  }

  let reason = `Today is ${currentProfit >= 0 ? "profitable" : "unprofitable"} at ${formatCurrency(currentProfit)} operating profit.`;
  if (todayVsWeekPace !== null) {
    if (todayVsWeekPace >= 1.15) {
      reason = `Today is outperforming the 7-day pace with ${formatCurrency(currentProfit)} operating profit.`;
    } else if (todayVsWeekPace <= 0.85) {
      reason = `Today is running below the 7-day pace with ${formatCurrency(currentProfit)} operating profit.`;
    }
  } else if (weekProfit > 0) {
    reason = `The last 7 days produced ${formatCurrency(weekProfit)} operating profit.`;
  } else if (weekProfit < 0) {
    reason = `The last 7 days lost ${formatCurrency(Math.abs(weekProfit))} in operating profit.`;
  }

  const warnings: string[] = [];
  if (today.kpis.revenue > 0 && today.kpis.grossMargin !== null && today.kpis.grossMargin < 10) {
    warnings.push("Margins are thin today.");
  }
  if (cashDelta24h < 0) {
    warnings.push(`Cash is down ${formatCurrency(Math.abs(cashDelta24h))} over the last 24 hours.`);
  }
  if (runwayDays !== null) {
    warnings.push(
      runwayDays < 3
        ? "Treasury runway is critical."
        : runwayDays < 7
          ? "Treasury runway is getting tight."
          : `Treasury runway is about ${Math.floor(runwayDays)} days.`
    );
  }
  if (today.storefront.shoppersGenerated > 0 && today.storefront.salesCount === 0) {
    warnings.push("Traffic is reaching the storefront but not converting.");
  }

  return {
    status,
    tone,
    headline,
    reason,
    runwayDays,
    cashDelta24h,
    warnings,
  };
}

function buildValuation(
  business: Business,
  periods: Record<FinancePeriod, BusinessFinancePeriodSnapshot>,
  cashBalance: number,
  inventoryAssetValue: number,
  liabilities: number
): BusinessValuationBreakdown {
  const basis = periods["30d"].kpis.revenue > 0 || periods["30d"].kpis.operatingProfit !== 0
    ? { snapshot: periods["30d"], days: 30 }
    : periods["7d"].kpis.revenue > 0 || periods["7d"].kpis.operatingProfit !== 0
      ? { snapshot: periods["7d"], days: 7 }
      : periods["24h"].kpis.revenue > 0 || periods["24h"].kpis.operatingProfit !== 0
        ? { snapshot: periods["24h"], days: 1 }
        : { snapshot: periods["1h"], days: 1 / 24 };
  const multipliers = BUSINESS_VALUATION_MULTIPLIERS[business.type];
  const annualizedRevenue = annualize(basis.snapshot.kpis.revenue, basis.days);
  const annualizedOperatingProfit = annualize(basis.snapshot.kpis.operatingProfit, basis.days);
  const operatingBase = annualizedOperatingProfit > 0
    ? annualizedOperatingProfit * multipliers.profitMultiple
    : annualizedRevenue * multipliers.revenueMultiple;
  const baseValue = round2(Math.max(multipliers.floor, operatingBase));
  const currentValue = round2(
    Math.max(
      multipliers.floor,
      baseValue + cashBalance + inventoryAssetValue - liabilities
    )
  );

  return {
    currentValue,
    previousValue: round2(business.value),
    baseValue,
    profitMultiple: multipliers.profitMultiple,
    revenueMultiple: multipliers.revenueMultiple,
    methodology: multipliers.label,
    annualizedRevenue,
    annualizedOperatingProfit,
    inventoryAssetValue,
    cash: cashBalance,
    liabilities,
    confidence: "estimated",
  };
}

export async function getBusinessFinanceDashboard(
  client: QueryClient,
  playerId: string,
  business: Business,
  currentPeriod: FinancePeriod = "1h"
): Promise<BusinessFinanceDashboard> {
  const ranges = getPeriodRanges();
  const isStore = supportsStorefront(business.type);

  const [ledgerRes, inventoryRes, financialEventsRes, balanceValue, storefrontSnapshotsRes, storefrontTransactionsRes] = await Promise.all([
    client
      .from("business_accounts")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true }),
    client
      .from("business_inventory")
      .select("*")
      .eq("owner_player_id", playerId)
      .eq("business_id", business.id),
    client
      .from("business_financial_events")
      .select("*")
      .eq("business_id", business.id)
      .order("effective_at", { ascending: true }),
    client.rpc("get_business_account_balance", { p_business_id: business.id }),
    isStore
      ? client
          .from("market_storefront_performance_snapshots")
          .select("id, business_id, shoppers_generated, sales_count, units_sold, gross_revenue, fee_total, ad_spend, captured_at")
          .eq("business_id", business.id)
          .order("captured_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    isStore
      ? client
          .from("market_transactions")
          .select("id, seller_business_id, buyer_type, item_key, quantity, gross_total, market_fee, created_at")
          .eq("seller_business_id", business.id)
          .eq("buyer_type", "npc")
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (ledgerRes.error) throw ledgerRes.error;
  if (inventoryRes.error) throw inventoryRes.error;

  const ledgerEntries = ((ledgerRes.data as BusinessAccountEntry[]) ?? []).map(normalizeBusinessAccountEntry);
  const ledgerEvents = ledgerEntries.map(toLedgerEvent);
  const financialEvents = financialEventsRes.error
    ? []
    : ((financialEventsRes.data as FinancialEventRow[]) ?? []).map(normalizeFinancialEventRow);
  const storefrontSnapshots =
    storefrontSnapshotsRes.error || !isStore
      ? []
      : ((storefrontSnapshotsRes.data as StorefrontSnapshotRow[]) ?? []).map(normalizeStorefrontSnapshotRow);
  const storefrontTransactions =
    storefrontTransactionsRes.error || !isStore
      ? []
      : ((storefrontTransactionsRes.data as StorefrontTransactionRow[]) ?? []).map(normalizeStorefrontTransactionRow);
  const cashBalance = round2(toNumber(balanceValue.data));
  const { inventoryAssetValue, estimatedRows } = buildInventorySnapshot(
    (inventoryRes.data as InventorySnapshotRow[]) ?? []
  );
  const liabilities = 0;

  const periods = Object.fromEntries(
    ranges.map((range) => {
      const ledgerInRange = ledgerEvents.filter((event) => !range.since || event.effectiveAt >= range.since);
      const financialInRange = financialEvents.filter((event) => !range.since || event.effectiveAt >= range.since);
      const revenueFromLedger = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "revenue",
        (row) => row.amount
      );
      const revenueFromTransfers = sumAmounts(
        financialInRange,
        (row) => row.accountCode === "revenue" && row.referenceType === "inventory_transfer",
        (row) => row.amount
      );
      const storefrontTransactionsInRange = storefrontTransactions.filter(
        (row) => !range.since || row.created_at >= range.since
      );
      const storefrontFallbackGrossRevenue = round2(
        storefrontTransactionsInRange.reduce((sum, row) => sum + row.gross_total, 0)
      );
      const storefrontFallbackFeeTotal = round2(
        storefrontTransactionsInRange.reduce((sum, row) => sum + row.market_fee, 0)
      );
      const storefrontFallbackSalesCount = storefrontTransactionsInRange.length;
      const storefrontFallbackUnitsSold = storefrontTransactionsInRange.reduce((sum, row) => sum + row.quantity, 0);
      const storefrontLedgerInRange = ledgerInRange.filter((row) => row.category === "npc_sale" || row.category === "market_fee");
      const storefrontLedgerSales = storefrontLedgerInRange.filter((row) => row.category === "npc_sale");
      const storefrontLedgerFees = storefrontLedgerInRange.filter((row) => row.category === "market_fee");
      const storefrontRevenueEventsInRange = financialInRange.filter(
        (row) => row.accountCode === "revenue" && row.referenceType === "storefront_sale"
      );
      const storefrontCogsEventsInRange = financialInRange.filter(
        (row) => row.accountCode === "cogs" && row.referenceType === "storefront_sale"
      );
      const storefrontExpenseEventsInRange = financialInRange.filter(
        (row) => row.accountCode === "operating_expense" && row.referenceType === "storefront_sale"
      );
      const operatingExpense = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "operating_expense",
        (row) => row.amount
      );
      const storefrontInRange = storefrontSnapshots.filter((row) => !range.since || row.captured_at >= range.since);
      const snapshotShoppersGenerated = storefrontInRange.reduce((sum, row) => sum + row.shoppers_generated, 0);
      const snapshotSalesCount = storefrontInRange.reduce((sum, row) => sum + row.sales_count, 0);
      const snapshotUnitsSold = storefrontInRange.reduce((sum, row) => sum + row.units_sold, 0);
      const snapshotGrossRevenue = round2(
        storefrontInRange.reduce((sum, row) => sum + row.gross_revenue, 0)
      );
      const snapshotFeeTotal = round2(
        storefrontInRange.reduce((sum, row) => sum + row.fee_total, 0)
      );
      const snapshotAdSpend = round2(
        storefrontInRange.reduce((sum, row) => sum + row.ad_spend, 0)
      );
      const storefrontEvidence = buildStorefrontEvidence({
        snapshotShoppersGenerated,
        snapshotSalesCount,
        snapshotUnitsSold,
        snapshotGrossRevenue,
        snapshotFeeTotal,
        snapshotAdSpend,
        transactionSalesCount: storefrontFallbackSalesCount,
        transactionUnitsSold: storefrontFallbackUnitsSold,
        transactionGrossRevenue: storefrontFallbackGrossRevenue,
        transactionFeeTotal: storefrontFallbackFeeTotal,
        ledgerSalesCount: storefrontLedgerSales.length,
        ledgerGrossRevenue: sumAmounts(storefrontLedgerSales, () => true, (row) => row.amount),
        ledgerFeeTotal: sumAmounts(storefrontLedgerFees, () => true, (row) => row.amount),
        eventRevenue: sumAmounts(storefrontRevenueEventsInRange, () => true, (row) => row.amount),
        eventCogs: sumAmounts(storefrontCogsEventsInRange, () => true, (row) => row.amount),
        eventFeeTotal: sumAmounts(storefrontExpenseEventsInRange, () => true, (row) => row.amount),
      });
      const recognizedStorefrontRevenue = isStore ? storefrontEvidence.grossRevenue : 0;
      const revenue = round2(
        Math.max(revenueFromLedger + revenueFromTransfers, revenueFromTransfers + recognizedStorefrontRevenue)
      );
      const cogs = round2(
        Math.max(
          sumAmounts(financialInRange, (row) => row.accountCode === "cogs", (row) => row.amount),
          isStore ? sumAmounts(storefrontCogsEventsInRange, () => true, (row) => row.amount) : 0
        )
      );
      const grossProfit = round2(revenue - cogs);
      const operatingProfit = round2(grossProfit - operatingExpense);
      const ownerContributions = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "owner_equity",
        (row) => row.amount
      );
      const ownerDraws = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "owner_draw",
        (row) => row.amount
      );
      const intercompanySales = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "intercompany" && row.category === "business_transfer_in",
        (row) => row.amount
      );
      const intercompanyPurchases = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "intercompany" && row.category === "business_transfer_out",
        (row) => row.amount
      );
      const ownerEquity = round2(cashBalance + inventoryAssetValue - liabilities);
      const shoppersGenerated = storefrontEvidence.shoppersGenerated;
      const salesCount = storefrontEvidence.salesCount;
      const unitsSold = storefrontEvidence.unitsSold;
      const storefrontGrossRevenue = storefrontEvidence.grossRevenue;
      const storefrontFeeTotal = storefrontEvidence.feeTotal;
      const storefrontAdSpend = storefrontEvidence.adSpend;
      const storefrontNetRevenue = round2(storefrontGrossRevenue - storefrontFeeTotal - storefrontAdSpend);
      const transferRevenueReferenceIds = new Set(
        financialInRange
          .filter(
            (row) =>
              row.accountCode === "revenue" &&
              row.referenceType === "inventory_transfer" &&
              Boolean(row.referenceId)
          )
          .map((row) => row.referenceId as string)
      );
      const recentLedger = ledgerInRange.filter(
        (row) =>
          !(
            row.accountCode === "intercompany" &&
            row.referenceId &&
            transferRevenueReferenceIds.has(row.referenceId)
          )
      );
      const recentEvents = [...recentLedger, ...financialInRange]
        .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
        .slice(0, 10)
        .map(toRecentEvent);
      const storefrontTransactionEvents = storefrontTransactionsInRange
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 10)
        .map((row) => ({
          id: `storefront-tx-${row.id}`,
          occurredAt: row.created_at,
          label: `Storefront sale cleared, ${formatQuantity(row.quantity, row.item_key)}`,
          amount: round2(row.gross_total),
          accountCode: "revenue",
          source: "ledger" as const,
          sourceLabel: "Storefront Transaction",
          accountLabel: "Revenue",
          postingType: "credit" as const,
        }));
      const mergedRecentEvents = [...recentEvents, ...storefrontTransactionEvents]
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 10);

      const snapshot: BusinessFinancePeriodSnapshot = {
        period: range.key,
        label: range.label,
        kpis: {
          cash: cashBalance,
          revenue,
          cogs,
          grossProfit,
          grossMargin: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
          operatingExpense,
          operatingProfit,
          ownerEquity,
          inventoryAssetValue,
          liabilities,
          valuation: 0,
        },
        storefront: {
          shoppersGenerated,
          salesCount,
          unitsSold,
          grossRevenue: storefrontGrossRevenue,
          feeTotal: storefrontFeeTotal,
          adSpend: storefrontAdSpend,
          netRevenue: storefrontNetRevenue,
          conversionRate: shoppersGenerated > 0 ? round2((salesCount / shoppersGenerated) * 100) : null,
          averageTicket: salesCount > 0 ? round2(storefrontGrossRevenue / salesCount) : null,
        },
        incomeStatement: [
          { label: "Revenue", amount: revenue, tone: "positive" },
          { label: "COGS", amount: -cogs, tone: "negative" },
          { label: "Gross Profit", amount: grossProfit, tone: grossProfit >= 0 ? "positive" : "negative" },
          { label: "Operating Expense", amount: -operatingExpense, tone: "negative" },
          { label: "Operating Income", amount: operatingProfit, tone: operatingProfit >= 0 ? "positive" : "negative" },
        ],
        cashFlow: [
          { label: "Operating Cash Flow", amount: round2(revenue - operatingExpense) },
          { label: "Investing Cash Flow", amount: round2(-sumAmounts(ledgerInRange, (row) => row.accountCode === "inventory", (row) => row.amount)) },
          { label: "Financing Cash Flow", amount: round2(ownerContributions - ownerDraws) },
        ],
        capital: {
          ownerContributions,
          ownerDraws,
          intercompanySales,
          intercompanyPurchases,
        },
        series: buildSeries(range, ledgerEvents, financialEvents, cashBalance),
        recentEvents: mergedRecentEvents,
      };

      return [range.key, snapshot];
    })
  ) as Record<FinancePeriod, BusinessFinancePeriodSnapshot>;

  const valuation = buildValuation(business, periods, cashBalance, inventoryAssetValue, liabilities);
  const health = buildHealth(periods);
  for (const period of FINANCE_PERIODS) {
    periods[period].kpis.valuation = valuation.currentValue;
  }

  return {
    generatedAt: nowIso(),
    currentPeriod,
    periods,
    balanceSheet: [
      { label: "Cash", amount: cashBalance },
      { label: "Inventory", amount: inventoryAssetValue },
      { label: "Liabilities", amount: -liabilities },
      { label: "Owner Equity", amount: round2(cashBalance + inventoryAssetValue - liabilities) },
    ],
    valuation,
    health,
    assumptions: [
      "Weighted-average inventory costing is used when explicit inventory cost exists.",
      estimatedRows > 0
        ? `Some inventory value uses baseline estimated costs (${estimatedRows} row${estimatedRows === 1 ? "" : "s"}).`
        : "Inventory values are based on observed cost data.",
      "Business liabilities are currently modeled as zero until business debt instruments are introduced.",
    ],
  };
}
