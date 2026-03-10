"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BANK_ACCOUNT_LABELS } from "@/domains/banking";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { fetchBankingPageData, queryKeys, type BankingPageData } from "@/lib/client/queries";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { TooltipLabel } from "@/components/ui/tooltip";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

type Props = {
  initialData: BankingPageData;
};

function BankingMetric(props: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "positive" | "negative" | "accent" | "warn";
}) {
  const color =
    props.tone === "positive"
      ? "#86efac"
      : props.tone === "negative"
        ? "#fca5a5"
        : props.tone === "accent"
          ? "#7dd3fc"
          : props.tone === "warn"
            ? "#fcd34d"
            : "#f8fafc";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(10, 17, 31, 0.95), rgba(6, 10, 19, 0.94))",
        border: "1px solid rgba(148, 163, 184, 0.14)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800, color }}>{props.value}</div>
      <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div>
    </div>
  );
}

function Panel(props: { title: string; eyebrow?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        marginTop: 0,
        background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 18,
        padding: 18,
        ...props.style,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        {props.eyebrow ? (
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>
            {props.eyebrow}
          </div>
        ) : null}
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

function FieldLabel(props: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", marginBottom: 6 }}>
      {props.children}
    </div>
  );
}

function StatusBadge(props: { children: ReactNode; tone?: "good" | "bad" | "neutral" | "warn" }) {
  const styles =
    props.tone === "good"
      ? { border: "1px solid rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.12)", color: "#86efac" }
      : props.tone === "bad"
        ? { border: "1px solid rgba(248, 113, 113, 0.3)", background: "rgba(248, 113, 113, 0.12)", color: "#fca5a5" }
        : props.tone === "warn"
          ? { border: "1px solid rgba(251, 191, 36, 0.3)", background: "rgba(251, 191, 36, 0.12)", color: "#fcd34d" }
          : { border: "1px solid rgba(96, 165, 250, 0.28)", background: "rgba(96, 165, 250, 0.12)", color: "#bfdbfe" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...styles,
      }}
    >
      {props.children}
    </span>
  );
}

function formatTransactionType(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function BankingClient({ initialData }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const bankingPageQuery = useQuery({
    queryKey: queryKeys.bankingPage,
    queryFn: fetchBankingPageData,
    initialData,
  });
  const accounts = bankingPageQuery.data.accounts;
  const loanData = bankingPageQuery.data.loanData;
  const transactions = bankingPageQuery.data.transactions;
  const businesses = bankingPageQuery.data.businesses;

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

  const checkingAccount = useMemo(
    () => accounts.find((account) => account.account_type === "checking") ?? null,
    [accounts]
  );
  const fromAccount = useMemo(() => accounts.find((account) => account.id === fromAccountId) ?? null, [accounts, fromAccountId]);
  const toAccount = useMemo(() => accounts.find((account) => account.id === toAccountId) ?? null, [accounts, toAccountId]);
  const personalBusinessAccount = useMemo(
    () => accounts.find((account) => account.id === personalBusinessAccountId) ?? null,
    [accounts, personalBusinessAccountId]
  );
  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === personalBusinessId) ?? null,
    [businesses, personalBusinessId]
  );
  const sourceOwnedBusiness = useMemo(
    () => businesses.find((business) => business.id === fromOwnedBusinessId) ?? null,
    [businesses, fromOwnedBusinessId]
  );
  const destinationOwnedBusiness = useMemo(
    () => businesses.find((business) => business.id === toOwnedBusinessId) ?? null,
    [businesses, toOwnedBusinessId]
  );
  const totalPersonalFunds = useMemo(() => accounts.reduce((sum, account) => sum + account.balance, 0), [accounts]);
  const businessTreasury = useMemo(() => businesses.reduce((sum, business) => sum + business.balance, 0), [businesses]);
  const recentCredits = useMemo(
    () => transactions.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + entry.amount, 0),
    [transactions]
  );
  const recentDebits = useMemo(
    () => transactions.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + entry.amount, 0),
    [transactions]
  );
  const recentNetFlow = recentCredits - recentDebits;
  const loanSummary = loanData.summary;
  const allBusy = transferSubmitting || personalBusinessSubmitting || ownedBusinessSubmitting || loanSubmitting || paymentSubmitting;

  function resetMessages() {
    setError(null);
    setSuccess(null);
  }

  async function refreshBankingData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bankingPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.businessesPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventoryPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.marketPage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.appShell }),
    ]);
  }

  async function submitTransfer() {
    if (transferSubmitting) return;
    setTransferSubmitting(true);
    resetMessages();
    try {
      await apiPost(apiRoutes.banking.transfer, { fromAccountId, toAccountId, amount: Number(transferAmount) }, { fallbackError: "Transfer failed." });
      setTransferAmount("");
      setSuccess("Personal account transfer completed.");
      await refreshBankingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setTransferSubmitting(false);
    }
  }

  async function submitPersonalBusinessTransfer() {
    if (personalBusinessSubmitting) return;
    setPersonalBusinessSubmitting(true);
    resetMessages();
    try {
      await apiPost(
        apiRoutes.banking.personalBusinessTransfer,
        {
          personalAccountId: personalBusinessAccountId,
          businessId: personalBusinessId,
          amount: Number(personalBusinessAmount),
          direction: personalBusinessDirection,
        },
        { fallbackError: "Transfer failed." }
      );
      setPersonalBusinessAmount("");
      setSuccess(
        personalBusinessDirection === "to_business"
          ? "Funds moved from personal banking into the business."
          : "Funds moved from the business back into personal banking."
      );
      await refreshBankingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setPersonalBusinessSubmitting(false);
    }
  }

  async function submitOwnedBusinessTransfer() {
    if (ownedBusinessSubmitting) return;
    setOwnedBusinessSubmitting(true);
    resetMessages();
    try {
      await apiPost(
        apiRoutes.banking.businessToBusinessTransfer,
        {
          fromBusinessId: fromOwnedBusinessId,
          toBusinessId: toOwnedBusinessId,
          amount: Number(ownedBusinessAmount),
        },
        { fallbackError: "Transfer failed." }
      );
      setOwnedBusinessAmount("");
      setSuccess("Funds reallocated between owned businesses.");
      await refreshBankingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setOwnedBusinessSubmitting(false);
    }
  }

  async function submitLoanApplication() {
    if (loanSubmitting) return;
    setLoanSubmitting(true);
    resetMessages();
    try {
      await apiPost(apiRoutes.banking.loan, { principal: Number(loanPrincipal) }, { fallbackError: "Loan application failed." });
      setLoanPrincipal("");
      setSuccess("Loan application approved and deposited.");
      await refreshBankingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Loan application failed.");
    } finally {
      setLoanSubmitting(false);
    }
  }

  async function submitLoanPayment() {
    if (!loanData?.summary?.loan.id || paymentSubmitting) return;
    setPaymentSubmitting(true);
    resetMessages();
    try {
      await apiPost(
        apiRoutes.banking.loanPayment,
        { loanId: loanData.summary.loan.id, amount: Number(paymentAmount) },
        { fallbackError: "Loan payment failed." }
      );
      setPaymentAmount("");
      setSuccess("Loan payment submitted from checking.");
      await refreshBankingData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Loan payment failed.");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  return (
    <div className="anim" style={{ display: "grid", gap: 18 }}>
      <header className="lc-page-header">
        <div>
          <h1>Banking</h1>
          <p>Your accounts and cash.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      <section
        style={{
          marginTop: 0,
          background:
            "radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 30%), radial-gradient(circle at top right, rgba(96, 165, 250, 0.14), transparent 28%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Treasury Control</div>
            <div style={{ marginTop: 8, fontSize: "1.95rem", fontWeight: 800, color: "#f8fafc" }}>
              Banking
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              Move money, cover your businesses, and keep your debt in line.
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
            <StatusBadge tone={bankingPageQuery.isFetching ? "warn" : "good"}>
              {bankingPageQuery.isFetching ? "Refreshing Banking" : "Banking Live"}
            </StatusBadge>
            <StatusBadge tone={loanSummary ? (loanSummary.isPaymentOverdue ? "bad" : "warn") : "neutral"}>
              {loanSummary ? (loanSummary.isPaymentOverdue ? "Payment Overdue" : "Loan Active") : "No Active Loan"}
            </StatusBadge>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {accounts.length} personal accounts and {businesses.length} owned businesses in treasury scope
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
          <BankingMetric label="Personal Funds" value={formatCurrency(totalPersonalFunds)} sub={`${formatCurrency(checkingAccount?.balance ?? 0)} in checking`} tone="positive" />
          <BankingMetric label="Business Treasury" value={formatCurrency(businessTreasury)} sub={`${businesses.length} owned operating accounts`} tone="accent" />
          <BankingMetric
            label="Loan Exposure"
            value={formatCurrency(loanSummary?.loan.balance_remaining ?? 0)}
            sub={loanSummary ? `${formatCurrency(loanSummary.currentMinimumDue)} currently due` : `${formatCurrency(loanData.maxLoanAvailable)} available to borrow`}
            tone={loanSummary ? "warn" : "neutral"}
          />
          <BankingMetric
            label="Recent Net Flow"
            value={`${recentNetFlow >= 0 ? "+" : "-"}${formatCurrency(Math.abs(recentNetFlow))}`}
            sub={`${transactions.length} recent ledger entries`}
            tone={recentNetFlow >= 0 ? "positive" : "negative"}
          />
        </div>
      </section>

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(248, 113, 113, 0.28)",
            background: "rgba(127, 29, 29, 0.22)",
            color: "#fecaca",
          }}
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(34, 197, 94, 0.24)",
            background: "rgba(20, 83, 45, 0.18)",
            color: "#bbf7d0",
          }}
        >
          {success}
        </div>
      ) : null}

      <Panel title="Account Overview" eyebrow="Personal Banking">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {accounts.map((account) => {
            const isPrimary = account.account_type === "checking";
            return (
              <article
                key={account.id}
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.14)",
                  borderRadius: 16,
                  padding: 16,
                  background:
                    isPrimary
                      ? "radial-gradient(circle at top right, rgba(34, 197, 94, 0.08), transparent 30%), linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))"
                      : "linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#f8fafc" }}>{BANK_ACCOUNT_LABELS[account.account_type] ?? account.account_type}</div>
                    <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: 12 }}>Opened {formatDateTime(account.opened_at)}</div>
                  </div>
                  <StatusBadge tone={isPrimary ? "good" : "neutral"}>{isPrimary ? "Primary Rail" : "Active"}</StatusBadge>
                </div>
                <div style={{ fontSize: "1.35rem", fontWeight: 800 }}>{formatCurrency(account.balance)}</div>
              </article>
            );
          })}
        </div>
      </Panel>

      <Panel title="Personal To Personal" eyebrow="Transfer Command">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label>
              <FieldLabel><TooltipLabel label="From Account" content="The personal account that will be debited for this transfer." /></FieldLabel>
              <select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} title="From account">
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {BANK_ACCOUNT_LABELS[account.account_type] ?? account.account_type} ({formatCurrency(account.balance)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <FieldLabel><TooltipLabel label="To Account" content="The personal account that will receive the funds." /></FieldLabel>
              <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} title="To account">
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {BANK_ACCOUNT_LABELS[account.account_type] ?? account.account_type} ({formatCurrency(account.balance)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <FieldLabel><TooltipLabel label="Amount" content="Enter the dollar amount to move between the selected accounts." /></FieldLabel>
              <input type="number" min="0" step="0.01" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="0.00" />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {fromAccount && toAccount
                ? `Moving ${formatCurrency(Number(transferAmount) || 0)} from ${BANK_ACCOUNT_LABELS[fromAccount.account_type]} to ${BANK_ACCOUNT_LABELS[toAccount.account_type]}`
                : "Select both source and destination accounts."}
            </div>
            <button onClick={submitTransfer} disabled={!fromAccountId || !toAccountId || fromAccountId === toAccountId || Number(transferAmount) <= 0 || transferSubmitting}>
              {transferSubmitting ? "Transferring..." : "Submit Transfer"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Personal And Business" eyebrow="Treasury Movements">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label>
              <FieldLabel><TooltipLabel label="Direction" content="Choose whether money is being injected into the business or pulled back into personal banking." /></FieldLabel>
              <select value={personalBusinessDirection} onChange={(event) => setPersonalBusinessDirection(event.target.value as "to_business" | "from_business")} title="Transfer direction">
                <option value="to_business">Personal to Business</option>
                <option value="from_business">Business to Personal</option>
              </select>
            </label>
            <label>
              <FieldLabel><TooltipLabel label="Personal Account" content="This personal account funds the move or receives the withdrawal." /></FieldLabel>
              <select value={personalBusinessAccountId} onChange={(event) => setPersonalBusinessAccountId(event.target.value)} title="Personal account">
                <option value="">Select account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {BANK_ACCOUNT_LABELS[account.account_type] ?? account.account_type} ({formatCurrency(account.balance)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <FieldLabel><TooltipLabel label="Business" content="The operating business treasury participating in this transfer." /></FieldLabel>
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
              <FieldLabel><TooltipLabel label="Amount" content="The number of dollars to move between personal funds and the selected business." /></FieldLabel>
              <input type="number" min="0" step="0.01" value={personalBusinessAmount} onChange={(event) => setPersonalBusinessAmount(event.target.value)} placeholder="0.00" />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {personalBusinessAccount && selectedBusiness
                ? `${personalBusinessDirection === "to_business" ? "Funding" : "Withdrawing from"} ${selectedBusiness.name} using ${BANK_ACCOUNT_LABELS[personalBusinessAccount.account_type]}.`
                : "Choose an account and business to continue."}
            </div>
            <button onClick={submitPersonalBusinessTransfer} disabled={!personalBusinessAccountId || !personalBusinessId || Number(personalBusinessAmount) <= 0 || personalBusinessSubmitting}>
              {personalBusinessSubmitting ? "Transferring..." : "Submit Transfer"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Business To Business" eyebrow="Treasury Movements">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <label>
              <FieldLabel><TooltipLabel label="From Business" content="This business treasury will send the funds." /></FieldLabel>
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
              <FieldLabel><TooltipLabel label="To Business" content="This business treasury will receive the reallocated cash." /></FieldLabel>
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
              <FieldLabel><TooltipLabel label="Amount" content="The dollar amount to shift between your owned businesses." /></FieldLabel>
              <input type="number" min="0" step="0.01" value={ownedBusinessAmount} onChange={(event) => setOwnedBusinessAmount(event.target.value)} placeholder="0.00" />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {sourceOwnedBusiness && destinationOwnedBusiness
                ? `Routing cash from ${sourceOwnedBusiness.name} to ${destinationOwnedBusiness.name}.`
                : "Choose both businesses to set the route."}
            </div>
            <button
              onClick={submitOwnedBusinessTransfer}
              disabled={!fromOwnedBusinessId || !toOwnedBusinessId || fromOwnedBusinessId === toOwnedBusinessId || Number(ownedBusinessAmount) <= 0 || ownedBusinessSubmitting}
            >
              {ownedBusinessSubmitting ? "Transferring..." : "Submit Transfer"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Loan Desk" eyebrow="Credit Line">
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              border: "1px solid rgba(148, 163, 184, 0.12)",
              background: "rgba(8, 13, 24, 0.7)",
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Max available" content="The largest new loan principal the bank will currently approve." /></span>
                <strong>{formatCurrency(loanData.maxLoanAvailable)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Checking balance" content="Current funds in your primary account. Loan payments are pulled from here." /></span>
                <strong>{formatCurrency(checkingAccount?.balance ?? 0)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Status" content="The current state of your loan, such as active, overdue, or unavailable." /></span>
                <strong>{loanSummary ? loanSummary.loan.status : "No active loan"}</strong>
              </div>
            </div>
          </div>
          {loanSummary ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 8, color: "var(--text-secondary)", fontSize: 13 }}>
                <div><strong style={{ color: "#f8fafc" }}>Balance Remaining:</strong> {formatCurrency(loanSummary.loan.balance_remaining)}</div>
                <div><strong style={{ color: "#f8fafc" }}>Minimum Weekly Due:</strong> {formatCurrency(loanSummary.currentMinimumDue)}</div>
                <div><strong style={{ color: "#f8fafc" }}>Next Due Date:</strong> {loanSummary.loan.next_payment_due ? formatDateTime(loanSummary.loan.next_payment_due) : "N/A"}</div>
              </div>
              <StatusBadge tone={loanSummary.isPaymentOverdue ? "bad" : "good"}>
                {loanSummary.isPaymentOverdue ? "Payment overdue" : "Loan in good standing"}
              </StatusBadge>
              <label>
                <FieldLabel><TooltipLabel label="Payment Amount" content="How much of the loan you want to pay down right now from checking." /></FieldLabel>
                <input type="number" min="0" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="0.00" />
              </label>
              <button onClick={submitLoanPayment} disabled={Number(paymentAmount) <= 0 || paymentSubmitting}>
                {paymentSubmitting ? "Submitting Payment..." : "Pay Loan"}
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
              <label>
                <FieldLabel><TooltipLabel label="Loan Principal" content="The amount you want to borrow. Approved principal is deposited into checking." /></FieldLabel>
                <input type="number" min="0" step="0.01" value={loanPrincipal} onChange={(event) => setLoanPrincipal(event.target.value)} placeholder="1000.00" />
              </label>
              <button onClick={submitLoanApplication} disabled={Number(loanPrincipal) <= 0 || loanSubmitting}>
                {loanSubmitting ? "Applying..." : "Apply For Loan"}
              </button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Recent Transactions" eyebrow="Ledger Feed">
        <div style={{ display: "grid", gap: 12 }}>
          {transactions.map((entry) => (
            <article
              key={entry.id}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.14)",
                borderRadius: 16,
                padding: 16,
                background: "linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700, color: "#f8fafc" }}>{formatTransactionType(entry.transaction_type)}</div>
                    <StatusBadge tone={entry.direction === "credit" ? "good" : "bad"}>{entry.direction}</StatusBadge>
                  </div>
                  <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{entry.description}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800, color: entry.direction === "credit" ? "#86efac" : "#fca5a5" }}>
                    {entry.direction === "credit" ? "+" : "-"}
                    {formatCurrency(entry.amount)}
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{formatDateTime(entry.created_at)}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
