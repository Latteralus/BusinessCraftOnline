"use client";

import type { BankAccountWithBalance, LoanSummary, TransactionEntry } from "@/domains/banking";
import type { BusinessWithBalance } from "@/domains/businesses";
import Link from "next/link";
import { useMemo, useState } from "react";

type LoanResponse = {
  summary: LoanSummary | null;
  maxLoanAvailable: number;
};

type Props = {
  initialData: {
    accounts: BankAccountWithBalance[];
    loanData: LoanResponse;
    transactions: TransactionEntry[];
    businesses: BusinessWithBalance[];
  };
};

type AccountsResponse = { accounts: BankAccountWithBalance[]; error?: string };
type TransactionsResponse = { entries: TransactionEntry[]; error?: string };
type BusinessesResponse = { businesses: BusinessWithBalance[]; error?: string };

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

export default function BankingClient({ initialData }: Props) {
  const [accounts, setAccounts] = useState(initialData.accounts);
  const [loanData, setLoanData] = useState<LoanResponse | null>(initialData.loanData);
  const [transactions, setTransactions] = useState(initialData.transactions);
  const [businesses, setBusinesses] = useState(initialData.businesses);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checking = initialData.accounts.find((account) => account.account_type === "checking");
  const [fromAccountId, setFromAccountId] = useState(checking?.id ?? "");
  const [toAccountId, setToAccountId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [personalBusinessDirection, setPersonalBusinessDirection] = useState<"to_business" | "from_business">("to_business");
  const [personalBusinessAccountId, setPersonalBusinessAccountId] = useState(checking?.id ?? "");
  const [personalBusinessId, setPersonalBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [personalBusinessAmount, setPersonalBusinessAmount] = useState("");
  const [personalBusinessSubmitting, setPersonalBusinessSubmitting] = useState(false);
  const [fromOwnedBusinessId, setFromOwnedBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [toOwnedBusinessId, setToOwnedBusinessId] = useState(initialData.businesses[1]?.id ?? "");
  const [ownedBusinessAmount, setOwnedBusinessAmount] = useState("");
  const [ownedBusinessSubmitting, setOwnedBusinessSubmitting] = useState(false);
  const [loanPrincipal, setLoanPrincipal] = useState("");
  const [loanSubmitting, setLoanSubmitting] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [accountsRes, loanRes, txRes, businessesRes] = await Promise.all([
      fetch("/api/banking/accounts", { cache: "no-store" }),
      fetch("/api/banking/loan", { cache: "no-store" }),
      fetch("/api/banking/transactions?limit=30", { cache: "no-store" }),
      fetch("/api/businesses", { cache: "no-store" }),
    ]);

    const accountsJson = (await accountsRes.json()) as AccountsResponse;
    const loanJson = (await loanRes.json()) as LoanResponse & { error?: string };
    const txJson = (await txRes.json()) as TransactionsResponse;
    const businessesJson = (await businessesRes.json()) as BusinessesResponse;

    if (!accountsRes.ok) {
      setError(accountsJson.error ?? "Failed to load accounts.");
    } else if (!loanRes.ok) {
      setError(loanJson.error ?? "Failed to load loan status.");
    } else if (!txRes.ok) {
      setError(txJson.error ?? "Failed to load transaction history.");
    } else if (!businessesRes.ok) {
      setError(businessesJson.error ?? "Failed to load businesses.");
    } else {
      setAccounts(accountsJson.accounts ?? []);
      setLoanData(loanJson);
      setTransactions(txJson.entries ?? []);
      setBusinesses(businessesJson.businesses ?? []);
    }

    setLoading(false);
  }

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
      body: JSON.stringify({ fromAccountId, toAccountId, amount: Number(transferAmount) }),
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

  async function submitPersonalBusinessTransfer() {
    if (personalBusinessSubmitting) return;
    setPersonalBusinessSubmitting(true);
    setError(null);
    const response = await fetch("/api/banking/business-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalAccountId: personalBusinessAccountId,
        businessId: personalBusinessId,
        amount: Number(personalBusinessAmount),
        direction: personalBusinessDirection,
      }),
    });
    const data = await response.json();
    setPersonalBusinessSubmitting(false);
    if (!response.ok) {
      setError(data.error ?? "Transfer failed.");
      return;
    }
    setPersonalBusinessAmount("");
    await loadData();
  }

  async function submitOwnedBusinessTransfer() {
    if (ownedBusinessSubmitting) return;
    setOwnedBusinessSubmitting(true);
    setError(null);
    const response = await fetch("/api/banking/businesses-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromBusinessId: fromOwnedBusinessId,
        toBusinessId: toOwnedBusinessId,
        amount: Number(ownedBusinessAmount),
      }),
    });
    const data = await response.json();
    setOwnedBusinessSubmitting(false);
    if (!response.ok) {
      setError(data.error ?? "Transfer failed.");
      return;
    }
    setOwnedBusinessAmount("");
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
      body: JSON.stringify({ loanId: loanData.summary.loan.id, amount: Number(paymentAmount) }),
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
          <p>Personal accounts, transfers, loan management, and transaction history.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Refreshing banking data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Account Balances</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          {accounts.map((account) => (
            <div key={account.id} style={{ border: "1px solid #334155", borderRadius: 8, padding: 12 }}>
              <p style={{ margin: 0, color: "#94a3b8" }}>{ACCOUNT_LABELS[account.account_type] ?? account.account_type}</p>
              <p style={{ margin: "6px 0 0", fontWeight: 700 }}>{formatCurrency(account.balance)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Transfer Between Personal Accounts</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <label>
            From
            <select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} title="From account">
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
            <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} title="To account">
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
            <input type="number" min="0" step="0.01" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="0.00" />
          </label>
          <button onClick={submitTransfer} disabled={!fromAccountId || !toAccountId || Number(transferAmount) <= 0 || transferSubmitting}>
            {transferSubmitting ? "Transferring..." : "Submit Transfer"}
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Transfer Between Personal and Business Funds</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <label>
            Direction
            <select value={personalBusinessDirection} onChange={(event) => setPersonalBusinessDirection(event.target.value as "to_business" | "from_business")} title="Transfer direction">
              <option value="to_business">Personal → Business</option>
              <option value="from_business">Business → Personal</option>
            </select>
          </label>
          <label>
            Personal Account
            <select value={personalBusinessAccountId} onChange={(event) => setPersonalBusinessAccountId(event.target.value)} title="Personal account">
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {ACCOUNT_LABELS[account.account_type] ?? account.account_type} ({formatCurrency(account.balance)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Business
            <select value={personalBusinessId} onChange={(event) => setPersonalBusinessId(event.target.value)} title="Business">
              <option value="">Select business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({formatCurrency(business.balance)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input type="number" min="0" step="0.01" value={personalBusinessAmount} onChange={(event) => setPersonalBusinessAmount(event.target.value)} placeholder="0.00" />
          </label>
          <button onClick={submitPersonalBusinessTransfer} disabled={!personalBusinessAccountId || !personalBusinessId || Number(personalBusinessAmount) <= 0 || personalBusinessSubmitting}>
            {personalBusinessSubmitting ? "Transferring..." : "Submit Transfer"}
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Transfer Between Your Businesses</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <label>
            From Business
            <select value={fromOwnedBusinessId} onChange={(event) => setFromOwnedBusinessId(event.target.value)} title="From business">
              <option value="">Select business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({formatCurrency(business.balance)})
                </option>
              ))}
            </select>
          </label>
          <label>
            To Business
            <select value={toOwnedBusinessId} onChange={(event) => setToOwnedBusinessId(event.target.value)} title="To business">
              <option value="">Select business</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name} ({formatCurrency(business.balance)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input type="number" min="0" step="0.01" value={ownedBusinessAmount} onChange={(event) => setOwnedBusinessAmount(event.target.value)} placeholder="0.00" />
          </label>
          <button
            onClick={submitOwnedBusinessTransfer}
            disabled={!fromOwnedBusinessId || !toOwnedBusinessId || fromOwnedBusinessId === toOwnedBusinessId || Number(ownedBusinessAmount) <= 0 || ownedBusinessSubmitting}
          >
            {ownedBusinessSubmitting ? "Transferring..." : "Submit Transfer"}
          </button>
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Loans</h2>
        <p><strong>Max Loan Available:</strong> {formatCurrency(loanData?.maxLoanAvailable ?? 0)}</p>
        {loanData?.summary ? (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}><strong>Status:</strong> {loanData.summary.loan.status}</p>
            <p style={{ margin: 0 }}><strong>Balance Remaining:</strong> {formatCurrency(loanData.summary.loan.balance_remaining)}</p>
            <p style={{ margin: 0 }}><strong>Minimum Weekly Due:</strong> {formatCurrency(loanData.summary.currentMinimumDue)}</p>
            <p style={{ margin: 0 }}><strong>Next Due Date:</strong> {loanData.summary.loan.next_payment_due ? new Date(loanData.summary.loan.next_payment_due).toLocaleString() : "N/A"}</p>
            <p style={{ margin: 0, color: loanData.summary.isPaymentOverdue ? "#f87171" : "#94a3b8" }}>
              {loanData.summary.isPaymentOverdue ? "Payment is overdue." : "Loan is in good standing."}
            </p>
            <label>
              Payment Amount (from checking)
              <input type="number" min="0" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" />
            </label>
            <p style={{ margin: 0, color: "#94a3b8" }}>Checking Balance: {formatCurrency(checkingAccount?.balance ?? 0)}</p>
            <button onClick={submitLoanPayment} disabled={Number(paymentAmount) <= 0 || paymentSubmitting}>
              {paymentSubmitting ? "Submitting Payment..." : "Pay Loan"}
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
            <p style={{ margin: 0 }}>No active loan.</p>
            <label>
              Loan Principal
              <input type="number" min="0" step="0.01" value={loanPrincipal} onChange={(event) => setLoanPrincipal(event.target.value)} placeholder="1000.00" />
            </label>
            <button onClick={submitLoanApplication} disabled={Number(loanPrincipal) <= 0 || loanSubmitting}>
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
                <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>Time</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>Type</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>Direction</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #334155", padding: 8 }}>Amount</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #334155", padding: 8 }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>{new Date(entry.created_at).toLocaleString()}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>{entry.transaction_type}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>{entry.direction}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #1f2937", textAlign: "right", color: entry.direction === "credit" ? "#34d399" : "#f87171" }}>
                    {entry.direction === "credit" ? "+" : "-"}{formatCurrency(entry.amount)}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>{entry.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
