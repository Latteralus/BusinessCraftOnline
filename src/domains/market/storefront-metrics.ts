import { round2, round4 } from "@/lib/core/number";
import type { MarketStorefrontPerformanceSnapshot, MarketTransaction } from "./types";

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

function getShopperKey(row: MarketTransaction) {
  return row.shopper_name
    ? `${row.tick_window_started_at ?? row.created_at}:${row.sub_tick_index ?? "na"}:${row.shopper_name}`
    : row.id;
}

export function calculateStorefrontRatios(totals: StorefrontMetricTotals): StorefrontMetricRatios {
  return {
    roi: totals.ad_spend > 0 ? round4(totals.net_revenue / totals.ad_spend) : null,
    conversion_rate: totals.shoppers_generated > 0 ? round4(totals.buyers_count / totals.shoppers_generated) : null,
    avg_basket_size: totals.sales_count > 0 ? round4(totals.units_sold / totals.sales_count) : null,
    avg_transaction_value: totals.sales_count > 0 ? round2(totals.gross_revenue / totals.sales_count) : null,
    revenue_per_visitor: totals.shoppers_generated > 0 ? round4(totals.gross_revenue / totals.shoppers_generated) : null,
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

export function summarizeStorefrontTransactions(transactions: MarketTransaction[]): StorefrontMetricTotals {
  const buyerKeys = new Set<string>();
  const totals = transactions.reduce(
    (acc, row) => {
      acc.gross_revenue += row.gross_total;
      acc.fee_total += row.market_fee;
      acc.sales_count += 1;
      acc.units_sold += row.quantity;
      buyerKeys.add(getShopperKey(row));
      return acc;
    },
    { ...EMPTY_STOREFRONT_TOTALS }
  );

  const grossRevenue = round2(totals.gross_revenue);
  const feeTotal = round2(totals.fee_total);
  return {
    ...totals,
    gross_revenue: grossRevenue,
    fee_total: feeTotal,
    net_revenue: round2(grossRevenue - feeTotal),
    buyers_count: buyerKeys.size,
  };
}

export function reconcileStorefrontTotals(input: {
  snapshotTotals: StorefrontMetricTotals;
  transactionTotals: StorefrontMetricTotals;
  hasTransactions: boolean;
}): StorefrontMetricTotals {
  const grossRevenue = input.hasTransactions
    ? input.transactionTotals.gross_revenue
    : input.snapshotTotals.gross_revenue;
  const feeTotal = input.hasTransactions
    ? input.transactionTotals.fee_total
    : input.snapshotTotals.fee_total;

  return {
    ...input.snapshotTotals,
    gross_revenue: grossRevenue,
    fee_total: feeTotal,
    net_revenue: round2(grossRevenue - feeTotal),
    sales_count: input.hasTransactions ? input.transactionTotals.sales_count : input.snapshotTotals.sales_count,
    buyers_count: input.hasTransactions ? input.transactionTotals.buyers_count : input.snapshotTotals.buyers_count,
    units_sold: input.hasTransactions ? input.transactionTotals.units_sold : input.snapshotTotals.units_sold,
  };
}

export function buildStorefrontMetricSummary(totals: StorefrontMetricTotals): StorefrontMetricSummary {
  return {
    ...totals,
    ...calculateStorefrontRatios(totals),
  };
}
