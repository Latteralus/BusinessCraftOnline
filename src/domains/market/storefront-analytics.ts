import { round2, round4 } from "@/lib/core/number";
import type { MarketStorefrontPerformanceSnapshot } from "./types";

export type StorefrontMetricSource = "snapshot" | "transaction" | "empty";

export type StorefrontMetricWarning =
  | "buyers_gt_visitors"
  | "conversion_gt_100"
  | "net_revenue_mismatch"
  | "transaction_snapshot_divergence"
  | "incomplete_snapshot_coverage"
  | "missing_snapshot_traffic";

export type StorefrontMetricTotals = {
  ad_spend: number;
  gross_revenue: number;
  fee_total: number;
  net_revenue: number;
  sales_count: number;
  buyers_count: number;
  units_sold: number;
  shoppers_generated: number;
  stock_out_count: number;
};

export type StorefrontMetricRatios = {
  roi: number | null;
  conversion_rate: number | null;
  avg_basket_size: number | null;
  avg_transaction_value: number | null;
  revenue_per_visitor: number | null;
};

export type StorefrontMetricSummary = StorefrontMetricTotals & StorefrontMetricRatios;

export type StorefrontMetricAudit = {
  snapshot: StorefrontMetricTotals & { count: number };
  transaction: StorefrontMetricTotals & {
    count: number;
    first_transaction_at: string | null;
    last_transaction_at: string | null;
  };
};

export type StorefrontMetricAnalytics = StorefrontMetricSummary & {
  source: StorefrontMetricSource;
  warnings: StorefrontMetricWarning[];
  snapshot_count: number;
  transaction_count: number;
  captured_from: string;
  captured_to: string;
  audit: StorefrontMetricAudit;
};

export type StorefrontTransactionAggregate = {
  transaction_count: number;
  units_sold: number;
  gross_revenue: number;
  fee_total: number;
  net_revenue: number;
  distinct_shopper_count: number;
  first_transaction_at: string | null;
  last_transaction_at: string | null;
};

export const EMPTY_STOREFRONT_TOTALS: StorefrontMetricTotals = {
  ad_spend: 0,
  gross_revenue: 0,
  fee_total: 0,
  net_revenue: 0,
  sales_count: 0,
  buyers_count: 0,
  units_sold: 0,
  shoppers_generated: 0,
  stock_out_count: 0,
};

function hasMeaningfulTotals(totals: StorefrontMetricTotals): boolean {
  return (
    totals.shoppers_generated > 0 ||
    totals.buyers_count > 0 ||
    totals.sales_count > 0 ||
    totals.units_sold > 0 ||
    totals.gross_revenue > 0 ||
    totals.fee_total > 0 ||
    totals.ad_spend > 0 ||
    totals.stock_out_count > 0
  );
}

function relativeDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
}

function hasSnapshotTransactionDivergence(
  snapshot: StorefrontMetricTotals,
  transaction: StorefrontMetricTotals
): boolean {
  if (!hasMeaningfulTotals(snapshot) || !hasMeaningfulTotals(transaction)) return false;

  return (
    relativeDelta(snapshot.sales_count, transaction.sales_count) > 0.05 ||
    relativeDelta(snapshot.units_sold, transaction.units_sold) > 0.05 ||
    relativeDelta(snapshot.buyers_count, transaction.buyers_count) > 0.05 ||
    relativeDelta(snapshot.gross_revenue, transaction.gross_revenue) > 0.05 ||
    relativeDelta(snapshot.fee_total, transaction.fee_total) > 0.05
  );
}

function hasTransactionSalesEvidence(totals: StorefrontMetricTotals): boolean {
  return totals.sales_count > 0 || totals.units_sold > 0 || totals.gross_revenue > 0 || totals.fee_total > 0;
}

function hasSnapshotSalesEvidence(totals: StorefrontMetricTotals): boolean {
  return totals.sales_count > 0 || totals.units_sold > 0 || totals.gross_revenue > 0 || totals.fee_total > 0;
}

function hasIncompleteSnapshotCoverage(
  snapshot: StorefrontMetricTotals,
  transaction: StorefrontMetricTotals
): boolean {
  if (!hasTransactionSalesEvidence(transaction)) return false;
  if (!hasSnapshotSalesEvidence(snapshot)) return true;

  return (
    transaction.sales_count > snapshot.sales_count ||
    transaction.units_sold > snapshot.units_sold ||
    transaction.gross_revenue > snapshot.gross_revenue + 0.01 ||
    transaction.fee_total > snapshot.fee_total + 0.01
  );
}

function uniqueWarnings(warnings: StorefrontMetricWarning[]): StorefrontMetricWarning[] {
  return Array.from(new Set(warnings));
}

export function calculateStorefrontRatios(
  totals: StorefrontMetricTotals,
  warnings: StorefrontMetricWarning[] = []
): StorefrontMetricRatios {
  const hasBadVisitorMath =
    warnings.includes("buyers_gt_visitors") || warnings.includes("conversion_gt_100");

  return {
    roi: totals.ad_spend > 0 ? round4(totals.net_revenue / totals.ad_spend) : null,
    conversion_rate:
      totals.shoppers_generated > 0 && !hasBadVisitorMath
        ? round4(totals.buyers_count / totals.shoppers_generated)
        : null,
    avg_basket_size: totals.sales_count > 0 ? round4(totals.units_sold / totals.sales_count) : null,
    avg_transaction_value: totals.sales_count > 0 ? round2(totals.gross_revenue / totals.sales_count) : null,
    revenue_per_visitor:
      totals.shoppers_generated > 0 && !hasBadVisitorMath
        ? round4(totals.gross_revenue / totals.shoppers_generated)
        : null,
  };
}

export function summarizeStorefrontSnapshots(
  snapshots: MarketStorefrontPerformanceSnapshot[]
): StorefrontMetricTotals {
  const totals = snapshots.reduce(
    (acc, row) => {
      acc.ad_spend += row.ad_spend;
      acc.gross_revenue += row.gross_revenue;
      acc.fee_total += row.fee_total;
      acc.sales_count += row.sales_count;
      acc.buyers_count += row.buyers_count;
      acc.units_sold += row.units_sold;
      acc.shoppers_generated += row.shoppers_generated;
      acc.stock_out_count += row.stock_out_count;
      return acc;
    },
    { ...EMPTY_STOREFRONT_TOTALS }
  );

  const grossRevenue = round2(totals.gross_revenue);
  const feeTotal = round2(totals.fee_total);
  return {
    ...totals,
    ad_spend: round2(totals.ad_spend),
    gross_revenue: grossRevenue,
    fee_total: feeTotal,
    net_revenue: round2(grossRevenue - feeTotal),
  };
}

export function summarizeStorefrontTransactionAggregate(
  aggregate: StorefrontTransactionAggregate | null
): StorefrontMetricTotals {
  if (!aggregate) return { ...EMPTY_STOREFRONT_TOTALS };

  const grossRevenue = round2(aggregate.gross_revenue);
  const feeTotal = round2(aggregate.fee_total);
  return {
    ...EMPTY_STOREFRONT_TOTALS,
    gross_revenue: grossRevenue,
    fee_total: feeTotal,
    net_revenue: round2(aggregate.net_revenue || grossRevenue - feeTotal),
    sales_count: aggregate.transaction_count,
    buyers_count: aggregate.distinct_shopper_count,
    units_sold: aggregate.units_sold,
  };
}

export function buildStorefrontMetricSummary(
  totals: StorefrontMetricTotals,
  warnings: StorefrontMetricWarning[] = []
): StorefrontMetricSummary {
  return {
    ...totals,
    ...calculateStorefrontRatios(totals, warnings),
  };
}

export function buildStorefrontAnalytics(input: {
  snapshotTotals: StorefrontMetricTotals;
  transactionTotals: StorefrontMetricTotals;
  snapshotCount: number;
  transactionAggregate: StorefrontTransactionAggregate | null;
  capturedFrom: string;
  capturedTo: string;
}): StorefrontMetricAnalytics {
  const transactionCount = input.transactionAggregate?.transaction_count ?? 0;
  const incompleteSnapshotCoverage =
    input.snapshotCount > 0 && hasIncompleteSnapshotCoverage(input.snapshotTotals, input.transactionTotals);
  const source: StorefrontMetricSource =
    input.snapshotCount > 0 && !incompleteSnapshotCoverage
      ? "snapshot"
      : transactionCount > 0
        ? "transaction"
        : "empty";
  const primaryTotals =
    source === "snapshot"
      ? input.snapshotTotals
      : source === "transaction"
        ? input.transactionTotals
        : { ...EMPTY_STOREFRONT_TOTALS };

  const warnings: StorefrontMetricWarning[] = [];
  if (primaryTotals.shoppers_generated > 0 && primaryTotals.buyers_count > primaryTotals.shoppers_generated) {
    warnings.push("buyers_gt_visitors");
  }
  if (primaryTotals.shoppers_generated > 0 && primaryTotals.buyers_count / primaryTotals.shoppers_generated > 1) {
    warnings.push("conversion_gt_100");
  }
  if (Math.abs(primaryTotals.net_revenue - round2(primaryTotals.gross_revenue - primaryTotals.fee_total)) > 0.01) {
    warnings.push("net_revenue_mismatch");
  }
  if (source === "transaction" && primaryTotals.shoppers_generated === 0) {
    warnings.push("missing_snapshot_traffic");
  }
  if (incompleteSnapshotCoverage) {
    warnings.push("incomplete_snapshot_coverage");
  }
  if (hasSnapshotTransactionDivergence(input.snapshotTotals, input.transactionTotals)) {
    warnings.push("transaction_snapshot_divergence");
  }

  const finalWarnings = uniqueWarnings(warnings);
  const summary = buildStorefrontMetricSummary(primaryTotals, finalWarnings);

  return {
    ...summary,
    source,
    warnings: finalWarnings,
    snapshot_count: input.snapshotCount,
    transaction_count: transactionCount,
    captured_from: input.capturedFrom,
    captured_to: input.capturedTo,
    audit: {
      snapshot: {
        ...input.snapshotTotals,
        count: input.snapshotCount,
      },
      transaction: {
        ...input.transactionTotals,
        count: transactionCount,
        first_transaction_at: input.transactionAggregate?.first_transaction_at ?? null,
        last_transaction_at: input.transactionAggregate?.last_transaction_at ?? null,
      },
    },
  };
}
