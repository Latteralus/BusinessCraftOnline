"use client";

import type {
  BankAccountWithBalance,
  LoanSummary,
  TransactionEntry,
} from "@/domains/banking";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AccountsResponse = {
  accounts: BankAccountWithBalance[];
};

type LoanResponse = {
  summary: LoanSummary | null;
  maxLoanAvailable: number;
};

type TransactionsResponse = {
  entries: TransactionEntry[];
};

const ACCOUNT_LABELS: Record<string, string> = {
  pocket_cash: "Pocket Cash",
  checking: "Checking",
  savings: "Savings",
  investment: "Investment",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export default function BankingPage() {
  const [accounts, setAccounts] = useState<BankAccountWithBalance[]>([]);
  const [loanData, setLoanData] = useState<LoanResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const [loanPrincipal, setLoanPrincipal] = useState("");
  const [loanSubmitting, setLoanSubmitting] = useState(false);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [accountsRes, loanRes, txRes] = await Promise.all([
      fetch("/api/banking/accounts", { cache: "no-store" }),
      fetch("/api/banking/loan", { cache: "no-store" }),
      fetch("/api/banking/transactions?limit=30", { cache: "no-store" }),
    ]);

    const accountsJson = (await accountsRes.json()) as AccountsResponse & { error?: string };
    const loanJson = (await loanRes.json()) as LoanResponse & { error?: string };
    const txJson = (await txRes.json()) as TransactionsResponse & { error?: string };

    if (!accountsRes.ok) {
      setError(accountsJson.error ?? "Failed to load accounts.");
      setLoading(false);
      return;
    }

    if (!loanRes.ok) {
      setError(loanJson.error ?? "Failed to load loan status.");
      setLoading(false);
      return;
    }

    if (!txRes.ok) {
      setError(txJson.error ?? "Failed to load transaction history.");
      setLoading(false);
      return;
    }

    setAccounts(accountsJson.accounts ?? []);
    setLoanData(loanJson);
    setTransactions(txJson.entries ?? []);

    const checking = (accountsJson.accounts ?? []).find(
      (account) => account.account_type === "checking"
    );
    if (checking) {
      setFromAccountId((current) => current || checking.id);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  const checkingAccount = useMemo(
    () => accounts.find((account) => account.account_type === "checking") ?? null,
    [accounts]
  );

  async function submitTransfer() {
    if (transferSubmitting) return;
    setTransferSubmitting(true);
    setError(null);

    const response = await fetch("/api/banking/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAccountId,
        toAccountId,
        amount: Number(transferAmount),
      }),
    });

    const data = await response.json();
    setTransferSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Transfer failed.");
      return;
    }

    setTransferAmount("");
    await loadData();
  }

  async function submitLoanApplication() {
    if (loanSubmitting) return;
    setLoanSubmitting(true);
    setError(null);

    const response = await fetch("/api/banking/loan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal: Number(loanPrincipal) }),
    });

    const data = await response.json();
    setLoanSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Loan application failed.");
      return;
    }

    setLoanPrincipal("");
    await loadData();
  }

  async function submitLoanPayment() {
    if (!loanData?.summary?.loan.id || paymentSubmitting) return;
    setPaymentSubmitting(true);
    setError(null);

    const response = await fetch("/api/banking/loan/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        loanId: loanData.summary.loan.id,
        amount: Number(paymentAmount),
      }),
    });

    const data = await response.json();
    setPaymentSubmitting(false);

    if (!response.ok) {
      setError(data.error ?? "Loan payment failed.");
      return;
    }

    setPaymentAmount("");
    await loadData();
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Banking</h1>
          <p>
            Personal accounts, transfers, loan management, and transaction history.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading banking data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      {!loading ? (
        <>
          <section>
            <h2 style={{ marginTop: 0 }}>Account Balances</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
              {accounts.map((account) => (
                <div
                  key={account.id}
                  style={{ border: "1px solid #334155", borderRadius: 8, padding: 12 }}
                >
                  <p style={{ margin: 0, color: "#94a3b8" }}>
                    {ACCOUNT_LABELS[account.account_type] ?? account.account_type}
                  </p>
                  <p style={{ margin: "6px 0 0", fontWeight: 700 }}>
                    {formatCurrency(account.balance)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Transfer Between Personal Accounts</h2>
            <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
              <label>
                From
                <select
                  value={fromAccountId}
                  onChange={(event) => setFromAccountId(event.target.value)}
                  title="From account"
                >
                  <option value="">Select account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {ACCOUNT_LABELS[account.account_type] ?? account.account_type}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                To
                <select
                  value={toAccountId}
                  onChange={(event) => setToAccountId(event.target.value)}
                  title="To account"
                >
                  <option value="">Select account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {ACCOUNT_LABELS[account.account_type] ?? account.account_type}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={transferAmount}
                  onChange={(event) => setTransferAmount(event.target.value)}
                  placeholder="0.00"
                />
              </label>

              <button
                onClick={submitTransfer}
                disabled={!fromAccountId || !toAccountId || Number(transferAmount) <= 0 || transferSubmitting}
              >
                {transferSubmitting ? "Transferring..." : "Submit Transfer"}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Loans</h2>
            <p>
              <strong>Max Loan Available:</strong>{" "}
              {formatCurrency(loanData?.maxLoanAvailable ?? 0)}
            </p>

            {loanData?.summary ? (
              <div style={{ display: "grid", gap: 8 }}>
                <p style={{ margin: 0 }}>
                  <strong>Status:</strong> {loanData.summary.loan.status}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Balance Remaining:</strong>{" "}
                  {formatCurrency(loanData.summary.loan.balance_remaining)}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Minimum Weekly Due:</strong>{" "}
                  {formatCurrency(loanData.summary.currentMinimumDue)}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Next Due Date:</strong>{" "}
                  {loanData.summary.loan.next_payment_due
                    ? new Date(loanData.summary.loan.next_payment_due).toLocaleString()
                    : "N/A"}
                </p>
                <p style={{ margin: 0, color: loanData.summary.isPaymentOverdue ? "#f87171" : "#94a3b8" }}>
                  {loanData.summary.isPaymentOverdue
                    ? "Payment is overdue."
                    : "Loan is in good standing."}
                </p>

                <label>
                  Payment Amount (from checking)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>

                <p style={{ margin: 0, color: "#94a3b8" }}>
                  Checking Balance: {formatCurrency(checkingAccount?.balance ?? 0)}
                </p>

                <button
                  onClick={submitLoanPayment}
                  disabled={Number(paymentAmount) <= 0 || paymentSubmitting}
                >
                  {paymentSubmitting ? "Submitting Payment..." : "Pay Loan"}
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                <p style={{ margin: 0 }}>No active loan.</p>
                <label>
                  Loan Principal
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={loanPrincipal}
                    onChange={(event) => setLoanPrincipal(event.target.value)}
                    placeholder="1000.00"
                  />
                </label>
                <button
                  onClick={submitLoanApplication}
                  disabled={Number(loanPrincipal) <= 0 || loanSubmitting}
                >
                  {loanSubmitting ? "Applying..." : "Apply For Loan"}
                </button>
              </div>
            )}
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Recent Transactions</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>
                      Time
                    </th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>
                      Type
                    </th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>
                      Direction
                    </th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #334155", padding: 8 }}>
                      Amount
                    </th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>
                        {entry.transaction_type}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>
                        {entry.direction}
                      </td>
                      <td
                        style={{
                          padding: 8,
                          borderBottom: "1px solid #1f2937",
                          textAlign: "right",
                          color: entry.direction === "credit" ? "#34d399" : "#f87171",
                        }}
                      >
                        {entry.direction === "credit" ? "+" : "-"}
                        {formatCurrency(entry.amount)}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>
                        {entry.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
