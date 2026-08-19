// AccountingFixPlan Phase H (item 53): reconciliation report combining the
// raw SQL aggregates from reconcile_business_accounting (migration 109) with
// the already-canonical getBalanceSheet/getCashFlowStatement checks from
// statements.ts. This module never repairs a discrepancy -- it only reports
// one, per the plan's own rule ("Never silently repair discrepancies in the
// normal reconciliation check. Report them clearly.").
//
// Two documented, expected sources of a nonzero journal discrepancy that are
// NOT bugs (see migration 108's own header comment, carried forward here so
// this report doesn't mislabel them as failures):
//   - Buy-order fills never post to the double-entry journal at all (the
//     buyer's cash is debited in full at order placement via
//     buy_order_escrow; a fill at a lower-or-equal price never re-touches
//     that cash, and there is no escrow/prepaid-asset account to balance a
//     journal entry against).
//   - B2B landed-cost capitalization at shipping delivery
//     (execute_due_shipping_deliveries) reclassifies cash already spent at
//     dispatch into inventory, with no "goods in transit" balance-sheet
//     account to post the missing leg against.
// Both mean journal.discrepancy is realistically expected to be nonzero for
// an active economy and is reported as a number, not asserted as pass/fail.
import { getBalanceSheet, getCashFlowStatement, type BalanceSheet, type CashFlowStatement } from "./statements";
import { round2, toNumber } from "@/lib/core/number";
import { nowIso } from "@/lib/core/time";
import type { QueryClient } from "@/lib/db/query-client";
import type { Business } from "./types";

export type BusinessReconciliationReport = {
  businessId: string;
  asOf: string;
  cash: {
    ledgerBalance: number;
    storedBalance: number;
    discrepancy: number;
    ok: boolean;
  };
  journal: {
    debits: number;
    credits: number;
    discrepancy: number;
    entryCount: number;
    unbalancedEntryCount: number;
    ok: boolean;
  };
  inventory: {
    bookValue: number;
    zeroCostRowCount: number;
  };
  fixedAssets: {
    total: number;
    eventCount: number;
  };
  balanceSheet: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    balanced: boolean;
  };
  cashFlow: {
    beginningCash: number;
    netCashFlow: number;
    endingCash: number;
    reconciles: boolean;
  };
  /** Overall pass/fail across every check this report can assert without a known, documented exception (cash, journal-per-entry-balance, Balance Sheet, Cash Flow Statement). Does NOT fold in journal.discrepancy -- see this file's header comment for why that number is expected to be nonzero. */
  ok: boolean;
  notes: string[];
};

type ReconcileRpcResult = {
  businessId: string;
  asOf: string;
  cash: { ledgerBalance: number | string; storedBalance: number | string; discrepancy: number | string };
  journal: {
    debits: number | string;
    credits: number | string;
    discrepancy: number | string;
    entryCount: number;
    unbalancedEntryCount: number;
  };
  inventory: { bookValue: number | string; zeroCostRowCount: number };
  fixedAssets: { total: number | string; eventCount: number };
};

const CENT = 0.01;

export async function getBusinessReconciliation(
  client: QueryClient,
  business: Pick<Business, "id" | "player_id">,
  /** Callers that already computed these for their own purposes (e.g. getBusinessFinanceDashboard, which needs the full Balance Sheet/Cash Flow Statement anyway) can pass them in to avoid a redundant second query round trip. Standalone callers (the admin reconciliation route) omit this and let it self-compute. */
  precomputed?: { balanceSheet?: BalanceSheet; cashFlow?: CashFlowStatement }
): Promise<BusinessReconciliationReport> {
  const [rpcRes, balanceSheet, cashFlow] = await Promise.all([
    client.rpc("reconcile_business_accounting", { p_business_id: business.id }),
    precomputed?.balanceSheet ? Promise.resolve(precomputed.balanceSheet) : getBalanceSheet(client, business),
    precomputed?.cashFlow ? Promise.resolve(precomputed.cashFlow) : getCashFlowStatement(client, business, { from: null }),
  ]);
  if (rpcRes.error) throw rpcRes.error;
  const raw = rpcRes.data as ReconcileRpcResult;

  const cashDiscrepancy = round2(toNumber(raw.cash.discrepancy));
  const cashOk = Math.abs(cashDiscrepancy) < CENT;

  const journalDiscrepancy = round2(toNumber(raw.journal.discrepancy));
  const journalOk = raw.journal.unbalancedEntryCount === 0;

  const notes: string[] = [
    "Journal debits vs credits (journal.discrepancy) is expected to be nonzero for an active economy: buy-order fills and B2B landed-cost capitalization at shipping delivery deliberately do not post to the double-entry journal (see migration 108). This is a documented, known gap, not a failure.",
  ];
  if (!balanceSheet.balanced) {
    notes.push(
      "Balance Sheet does not currently balance -- the most likely cause is inventory in transit on an active B2B shipment (cash left at dispatch, landed-cost inventory asset not recognized until delivery). See statements.ts."
    );
  }
  if (raw.inventory.zeroCostRowCount > 0) {
    notes.push(
      `${raw.inventory.zeroCostRowCount} inventory row(s) carry quantity > 0 at exactly $0 cost basis. This is correct for genuinely free production (e.g. mined output with no consumed inputs, per item 42) but worth a manual look if unexpected for this business.`
    );
  }

  return {
    businessId: business.id,
    asOf: nowIso(),
    cash: {
      ledgerBalance: round2(toNumber(raw.cash.ledgerBalance)),
      storedBalance: round2(toNumber(raw.cash.storedBalance)),
      discrepancy: cashDiscrepancy,
      ok: cashOk,
    },
    journal: {
      debits: round2(toNumber(raw.journal.debits)),
      credits: round2(toNumber(raw.journal.credits)),
      discrepancy: journalDiscrepancy,
      entryCount: raw.journal.entryCount,
      unbalancedEntryCount: raw.journal.unbalancedEntryCount,
      ok: journalOk,
    },
    inventory: {
      bookValue: round2(toNumber(raw.inventory.bookValue)),
      zeroCostRowCount: raw.inventory.zeroCostRowCount,
    },
    fixedAssets: {
      total: round2(toNumber(raw.fixedAssets.total)),
      eventCount: raw.fixedAssets.eventCount,
    },
    balanceSheet: {
      totalAssets: balanceSheet.assets.total,
      totalLiabilities: balanceSheet.liabilities.total,
      totalEquity: balanceSheet.equity.total,
      balanced: balanceSheet.balanced,
    },
    cashFlow: {
      beginningCash: cashFlow.beginningCash,
      netCashFlow: cashFlow.netCashFlow,
      endingCash: cashFlow.endingCash,
      reconciles: cashFlow.reconciles,
    },
    ok: cashOk && journalOk && balanceSheet.balanced && cashFlow.reconciles,
    notes,
  };
}

export type AllBusinessesReconciliationSummary = {
  asOf: string;
  businessCount: number;
  okCount: number;
  failingBusinessIds: string[];
  reports: BusinessReconciliationReport[];
};

/** Admin/debug tool (item 53: "examine one business or every business"). Runs getBusinessReconciliation for every business, sequentially -- this is an on-demand support tool, not a hot path, so a simple loop over a service-role client is preferred over adding a second, SQL-side implementation of the same checks. */
export async function getAllBusinessesReconciliation(client: QueryClient): Promise<AllBusinessesReconciliationSummary> {
  const { data, error } = await client.from("businesses").select("id, player_id").order("created_at", { ascending: true });
  if (error) throw error;
  const businesses = (data as Array<{ id: string; player_id: string }>) ?? [];

  const reports: BusinessReconciliationReport[] = [];
  for (const business of businesses) {
    reports.push(await getBusinessReconciliation(client, business));
  }

  const failingBusinessIds = reports.filter((report) => !report.ok).map((report) => report.businessId);

  return {
    asOf: nowIso(),
    businessCount: reports.length,
    okCount: reports.length - failingBusinessIds.length,
    failingBusinessIds,
    reports,
  };
}
