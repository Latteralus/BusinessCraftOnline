import {
  BUSINESS_LEDGER_CATEGORY_CLASSIFICATION,
  BUSINESS_VALUATION_MULTIPLIERS,
  FINANCE_PERIODS,
  type FinancePeriod,
} from "@/config/finance";
import { getNpcSuggestedBasePrice } from "@/config/market";
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
  buyers_count: number | string | null;
  sales_count: number | string;
  units_sold: number | string;
  gross_revenue: number | string;
  fee_total: number | string;
  ad_spend: number | string;
  stock_out_count: number | string | null;
  captured_at: string;
};

type StorefrontTransactionAggregateRow = {
  transaction_count: number | string | null;
  units_sold: number | string | null;
  gross_revenue: number | string | null;
  fee_total: number | string | null;
};

type StorefrontPeriodEvidence = {
  shoppersGenerated: number;
  buyersCount: number;
  salesCount: number;
  unitsSold: number;
  grossRevenue: number;
  feeTotal: number;
  adSpend: number;
  stockOutCount: number;
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
    buyersCount: number;
    salesCount: number;
    unitsSold: number;
    grossRevenue: number;
    feeTotal: number;
    adSpend: number;
    netRevenue: number;
    stockOutCount: number;
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

  const storefrontSaleMatch = description.match(/^Storefront sale:\s*(\d+)x\s+(.+)$/i);
  if (storefrontSaleMatch) {
    return `Storefront sale proceeds, ${formatQuantity(Number(storefrontSaleMatch[1]), storefrontSaleMatch[2].trim())}`;
  }

  const storefrontFeeMatch = description.match(/^Storefront fee:\s*(\d+)x\s+(.+)$/i);
  if (storefrontFeeMatch) {
    return `Storefront transaction fee, ${formatQuantity(Number(storefrontFeeMatch[1]), storefrontFeeMatch[2].trim())}`;
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

type MarketAveragePriceRow = {
  item_key: string;
  avg_unit_price: number | string;
};

// A per-item-key-set cache with a short TTL: this is a valuation *estimate*
// used on every finance dashboard load, not a live price feed, so it doesn't
// need to be recomputed on every visit. Only helps within one warm server
// instance, but that's the common case for repeated dashboard loads.
const MARKET_AVERAGE_PRICE_CACHE_TTL_MS = 30_000;
const marketAveragePriceCache = new Map<string, { expiresAt: number; prices: Record<string, number> }>();

// Assets are valued at what they'd fetch right now, not at what was paid for
// them: the average asking price across active open-market listings for that
// item, or — when nothing is currently listed — 100% of the NPC buying price
// (the midpoint of the NPC buy band, e.g. water at $1-$5 values at $2.50).
// This is deliberately separate from COGS/cost-basis accounting (unit_cost /
// total_cost on business_inventory), which still reflects actual acquisition
// cost and must not change.
//
// The averaging itself happens in Postgres (get_market_average_unit_prices),
// not in JS, so only one aggregated row per item key crosses the wire
// instead of every matching listing across every player/city.
async function getMarketAverageUnitPrices(client: QueryClient, itemKeys: string[]): Promise<Record<string, number>> {
  const uniqueItemKeys = [...new Set(itemKeys)].sort();
  if (uniqueItemKeys.length === 0) return {};

  const cacheKey = uniqueItemKeys.join("|");
  const cached = marketAveragePriceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prices;
  }

  const { data, error } = await client.rpc("get_market_average_unit_prices", {
    p_item_keys: uniqueItemKeys,
  });

  if (error || !data) return {};

  const prices = Object.fromEntries(
    (data as MarketAveragePriceRow[]).map((row) => [row.item_key, round2(toNumber(row.avg_unit_price))])
  );

  marketAveragePriceCache.set(cacheKey, { expiresAt: Date.now() + MARKET_AVERAGE_PRICE_CACHE_TTL_MS, prices });
  return prices;
}

function getAssetUnitPrice(
  itemKey: string,
  marketAvgByItemKey: Record<string, number>
): { unitPrice: number; source: "market" | "npc_fallback" } {
  const marketAvg = marketAvgByItemKey[itemKey];
  if (marketAvg && marketAvg > 0) {
    return { unitPrice: marketAvg, source: "market" };
  }
  return { unitPrice: getNpcSuggestedBasePrice(itemKey), source: "npc_fallback" };
}

export async function computeInventoryAssetValue(
  client: QueryClient,
  rows: Array<{ item_key: string; quantity: number | string }>
): Promise<{ inventoryAssetValue: number; npcFallbackRows: number }> {
  const marketAvgByItemKey = await getMarketAverageUnitPrices(client, rows.map((row) => row.item_key));
  let inventoryAssetValue = 0;
  let npcFallbackRows = 0;

  for (const row of rows) {
    const quantity = Math.max(0, toNumber(row.quantity));
    const { unitPrice, source } = getAssetUnitPrice(row.item_key, marketAvgByItemKey);
    inventoryAssetValue += quantity * unitPrice;
    if (source === "npc_fallback") npcFallbackRows += 1;
  }

  return { inventoryAssetValue: round2(inventoryAssetValue), npcFallbackRows };
}

function normalizeStorefrontSnapshotRow(row: StorefrontSnapshotRow) {
  return {
    ...row,
    shoppers_generated: Number(row.shoppers_generated),
    buyers_count: row.buyers_count === null || row.buyers_count === undefined ? 0 : Number(row.buyers_count),
    sales_count: Number(row.sales_count),
    units_sold: Number(row.units_sold),
    gross_revenue: toNumber(row.gross_revenue),
    fee_total: toNumber(row.fee_total),
    ad_spend: toNumber(row.ad_spend),
    stock_out_count: row.stock_out_count === null || row.stock_out_count === undefined ? 0 : Number(row.stock_out_count),
  };
}

function normalizeStorefrontTransactionAggregate(row: Partial<StorefrontTransactionAggregateRow> | null | undefined) {
  return {
    salesCount: Number(row?.transaction_count ?? 0),
    unitsSold: Number(row?.units_sold ?? 0),
    grossRevenue: round2(toNumber(row?.gross_revenue)),
    feeTotal: round2(toNumber(row?.fee_total)),
  };
}

async function getStorefrontTransactionAggregate(
  client: QueryClient,
  input: {
    businessId: string;
    from: string;
    to: string;
  }
) {
  const { data, error } = await client.rpc("get_storefront_transaction_aggregate", {
    p_seller_player_id: null,
    p_seller_business_id: input.businessId,
    p_from: input.from,
    p_to: input.to,
  });
  if (error) return normalizeStorefrontTransactionAggregate(null);
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeStorefrontTransactionAggregate(row as Partial<StorefrontTransactionAggregateRow> | null | undefined);
}

function buildStorefrontEvidence(input: {
  snapshotShoppersGenerated: number;
  snapshotBuyersCount: number;
  snapshotSalesCount: number;
  snapshotUnitsSold: number;
  snapshotGrossRevenue: number;
  snapshotFeeTotal: number;
  snapshotAdSpend: number;
  snapshotStockOutCount: number;
  transactionSalesCount: number;
  transactionUnitsSold: number;
  transactionGrossRevenue: number;
  transactionFeeTotal: number;
  ledgerSalesCount: number;
  ledgerGrossRevenue: number;
  ledgerFeeTotal: number;
}): StorefrontPeriodEvidence {
  // Prefer snapshot sales only when they carry sales evidence. Traffic-only
  // snapshots can be partial windows and should not zero out transaction totals.
  const hasSnapshotSalesSource =
    input.snapshotSalesCount > 0 ||
    input.snapshotUnitsSold > 0 ||
    input.snapshotGrossRevenue > 0 ||
    input.snapshotFeeTotal > 0;
  const hasTransactionSalesSource =
    input.transactionSalesCount > 0 ||
    input.transactionUnitsSold > 0 ||
    input.transactionGrossRevenue > 0 ||
    input.transactionFeeTotal > 0;
  const useSnapshotSalesSource = hasSnapshotSalesSource || !hasTransactionSalesSource;
  const salesCount = useSnapshotSalesSource
    ? input.snapshotSalesCount
    : input.transactionSalesCount > 0
      ? input.transactionSalesCount
      : input.ledgerSalesCount;
  const unitsSold = useSnapshotSalesSource
    ? input.snapshotUnitsSold
    : input.transactionUnitsSold;
  const grossRevenue = round2(
    useSnapshotSalesSource
      ? input.snapshotGrossRevenue
      : input.transactionGrossRevenue > 0
        ? input.transactionGrossRevenue
        : input.ledgerGrossRevenue
  );
  const feeTotal = round2(
    useSnapshotSalesSource
      ? input.snapshotFeeTotal
      : input.transactionFeeTotal > 0
        ? input.transactionFeeTotal
        : input.ledgerFeeTotal
  );

  return {
    shoppersGenerated: input.snapshotShoppersGenerated,
    buyersCount: input.snapshotBuyersCount,
    salesCount,
    unitsSold,
    grossRevenue,
    feeTotal,
    adSpend: input.snapshotAdSpend,
    stockOutCount: input.snapshotStockOutCount,
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
  // Signed by the ledger's own entry_type (credit = cash in, debit = cash
  // out) rather than an accountCode allowlist — every currently-used category
  // is unidirectional so this produces the same result as before for them,
  // but it also correctly nets bidirectional flows like a buy-order escrow
  // hold (debit) followed by its cancellation refund (credit), which an
  // accountCode-only heuristic would otherwise count as cash leaving twice.
  const cashDeltaByBucket = groupAmountByBucket(ledgerEvents, bucketMs, (row) => {
    if (row.accountCode === "intercompany") return 0;
    return row.entryType === "credit" ? row.amount : -row.amount;
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
  const oldestRangeStart = ranges
    .map((range) => range.since)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  const [ledgerRes, inventoryRes, financialEventsRes, balanceValue, storefrontSnapshotsRes] = await Promise.all([
    client
      .from("business_accounts")
      .select("*")
      .eq("business_id", business.id)
      .gte("created_at", oldestRangeStart)
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
      .gte("effective_at", oldestRangeStart)
      .order("effective_at", { ascending: true }),
    client.rpc("get_business_account_balance", { p_business_id: business.id }),
    isStore
      ? client
          .from("market_storefront_performance_snapshots")
          .select("id, business_id, shoppers_generated, buyers_count, sales_count, units_sold, gross_revenue, fee_total, ad_spend, stock_out_count, captured_at")
          .eq("business_id", business.id)
          .gte("captured_at", oldestRangeStart)
          .order("captured_at", { ascending: true })
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
  const storefrontTransactionAggregates = Object.fromEntries(
    await Promise.all(
      ranges.map(async (range) => [
        range.key,
        isStore && range.since
          ? await getStorefrontTransactionAggregate(client, {
              businessId: business.id,
              from: range.since,
              to: nowIso(),
            })
          : normalizeStorefrontTransactionAggregate(null),
      ])
    )
  ) as Record<FinancePeriod, ReturnType<typeof normalizeStorefrontTransactionAggregate>>;
  const cashBalance = round2(toNumber(balanceValue.data));
  const { inventoryAssetValue, npcFallbackRows } = await computeInventoryAssetValue(
    client,
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
      const storefrontTransactionAggregate = storefrontTransactionAggregates[range.key];
      const storefrontFallbackGrossRevenue = storefrontTransactionAggregate.grossRevenue;
      const storefrontFallbackFeeTotal = storefrontTransactionAggregate.feeTotal;
      const storefrontFallbackSalesCount = storefrontTransactionAggregate.salesCount;
      const storefrontFallbackUnitsSold = storefrontTransactionAggregate.unitsSold;
      const storefrontLedgerInRange = ledgerInRange.filter((row) => row.category === "npc_sale" || row.category === "market_fee");
      const storefrontLedgerSales = storefrontLedgerInRange.filter((row) => row.category === "npc_sale");
      const storefrontLedgerFees = storefrontLedgerInRange.filter((row) => row.category === "market_fee");
      const storefrontCogsEventsInRange = financialInRange.filter(
        (row) => row.accountCode === "cogs" && row.referenceType === "storefront_sale"
      );
      const operatingExpense = sumAmounts(
        ledgerInRange,
        (row) => row.accountCode === "operating_expense",
        (row) => row.amount
      );
      const storefrontInRange = storefrontSnapshots.filter((row) => !range.since || row.captured_at >= range.since);
      const snapshotShoppersGenerated = storefrontInRange.reduce((sum, row) => sum + row.shoppers_generated, 0);
      const snapshotBuyersCount = storefrontInRange.reduce((sum, row) => sum + row.buyers_count, 0);
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
      const snapshotStockOutCount = storefrontInRange.reduce((sum, row) => sum + row.stock_out_count, 0);
      const storefrontEvidence = buildStorefrontEvidence({
        snapshotShoppersGenerated,
        snapshotBuyersCount,
        snapshotSalesCount,
        snapshotUnitsSold,
        snapshotGrossRevenue,
        snapshotFeeTotal,
        snapshotAdSpend,
        snapshotStockOutCount,
        transactionSalesCount: storefrontFallbackSalesCount,
        transactionUnitsSold: storefrontFallbackUnitsSold,
        transactionGrossRevenue: storefrontFallbackGrossRevenue,
        transactionFeeTotal: storefrontFallbackFeeTotal,
        ledgerSalesCount: storefrontLedgerSales.length,
        ledgerGrossRevenue: sumAmounts(storefrontLedgerSales, () => true, (row) => row.amount),
        ledgerFeeTotal: sumAmounts(storefrontLedgerFees, () => true, (row) => row.amount),
      });
      const recognizedStorefrontRevenue = isStore ? storefrontEvidence.grossRevenue : 0;
      const revenue = round2(
        revenueFromTransfers + (isStore ? recognizedStorefrontRevenue : revenueFromLedger)
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
      const buyersCount = storefrontEvidence.buyersCount;
      const salesCount = storefrontEvidence.salesCount;
      const unitsSold = storefrontEvidence.unitsSold;
      const storefrontGrossRevenue = storefrontEvidence.grossRevenue;
      const storefrontFeeTotal = storefrontEvidence.feeTotal;
      const storefrontAdSpend = storefrontEvidence.adSpend;
      const storefrontStockOutCount = storefrontEvidence.stockOutCount;
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
      // Exclude storefront_sale and market_transaction financial events — both are
      // internal double-entry journal entries (revenue, cogs, inventory, operating_expense)
      // already represented by the business_accounts ledger entries and market_transactions
      // rows (player purchases, NPC open-market sales, and buy-order fills all post their
      // cash-side entries to the ledger too). Showing them produces 3-4 duplicate lines per
      // trade in the user-facing transaction log.
      const financialForLog = financialInRange.filter(
        (row) => row.referenceType !== "storefront_sale" && row.referenceType !== "market_transaction"
      );
      const recentEvents = [...recentLedger, ...financialForLog]
        .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))
        .slice(0, 30)
        .map(toRecentEvent);
      // storefrontTransactionEvents (market_transactions rows) are intentionally NOT merged
      // here — each NPC storefront sale already appears in recentLedger as an npc_sale credit
      // (and optionally a market_fee debit) from business_accounts.  Adding market_transactions
      // on top would produce two entries per sale in the user-facing log.
      const mergedRecentEvents = recentEvents
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
          buyersCount,
          salesCount,
          unitsSold,
          grossRevenue: storefrontGrossRevenue,
          feeTotal: storefrontFeeTotal,
          adSpend: storefrontAdSpend,
          netRevenue: storefrontNetRevenue,
          stockOutCount: storefrontStockOutCount,
          conversionRate: shoppersGenerated > 0 ? round2((buyersCount / shoppersGenerated) * 100) : null,
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
          { label: "Operating Cash Flow", amount: round2(revenue - cogs - operatingExpense) },
          {
            // Net debits (cash committed to inventory, e.g. market purchases
            // or a buy-order escrow hold) against credits (e.g. an escrowed
            // buy order's cancellation refund) within the same accountCode,
            // rather than summing raw amounts — see cashDeltaByBucket above
            // for why a blind sum double-counts a hold-then-refund pair.
            label: "Investing Cash Flow",
            amount: round2(
              sumAmounts(ledgerInRange, (row) => row.accountCode === "inventory" && row.entryType === "credit", (row) => row.amount) -
                sumAmounts(ledgerInRange, (row) => row.accountCode === "inventory" && row.entryType === "debit", (row) => row.amount)
            ),
          },
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
      "Inventory is valued at the average active open-market asking price for each item.",
      npcFallbackRows > 0
        ? `Some inventory value uses the NPC buying-price midpoint as a fallback where nothing is currently listed on the market (${npcFallbackRows} row${npcFallbackRows === 1 ? "" : "s"}).`
        : "All inventory value is based on live open-market pricing.",
      "Business liabilities are currently modeled as zero until business debt instruments are introduced.",
    ],
  };
}
