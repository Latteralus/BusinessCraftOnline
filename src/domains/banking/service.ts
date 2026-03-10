import {
  BANK_ACCOUNT_TYPES,
  LOAN_DEFAULT_INTEREST_RATE,
  LOAN_LIMIT_PER_BUSINESS_LEVEL,
  LOAN_MAX_PRINCIPAL,
  LOAN_MIN_PRINCIPAL,
  STARTING_CHECKING_BALANCE,
  TRANSACTION_HISTORY_DEFAULT_LIMIT,
} from "@/config/banking";
import type {
  ApplyForLoanContext,
  ApplyForLoanInput,
  BankAccount,
  BankAccountType,
  BankAccountWithBalance,
  BankingSnapshot,
  Loan,
  LoanSummary,
  PayLoanInput,
  TransactionEntry,
  TransactionHistoryFilter,
  TransferBetweenOwnBusinessesInput,
  TransferBetweenOwnAccountsInput,
  TransferBetweenPersonalAndBusinessInput,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function calculateMaxLoanForBusinessLevel(businessLevel: number): number {
  const scaled = Math.max(LOAN_MIN_PRINCIPAL, businessLevel * LOAN_LIMIT_PER_BUSINESS_LEVEL);
  return Math.min(scaled, LOAN_MAX_PRINCIPAL);
}

export function isLoanPaymentOverdue(loan: Loan): boolean {
  if (loan.status !== "active" || !loan.next_payment_due) {
    return false;
  }
  return new Date(loan.next_payment_due).getTime() < Date.now();
}

export function getCurrentWeeklyMinimumDue(loan: Loan): number {
  return Math.min(toNumber(loan.minimum_weekly_payment), toNumber(loan.balance_remaining));
}

export async function ensurePersonalAccounts(
  client: QueryClient,
  playerId: string
): Promise<BankAccount[]> {
  const { data, error } = await client
    .from("bank_accounts")
    .select("*")
    .eq("player_id", playerId);

  if (error) throw error;

  const existing = (data as BankAccount[]) ?? [];
  const existingTypes = new Set(existing.map((account) => account.account_type));

  const missingTypes = BANK_ACCOUNT_TYPES.filter((accountType) => !existingTypes.has(accountType));

  if (missingTypes.length === 0) {
    return sortAccounts(existing);
  }

  const insertedRows: BankAccount[] = [];

  for (const accountType of missingTypes) {
    const { data: inserted, error: insertError } = await client
      .from("bank_accounts")
      .insert({
        player_id: playerId,
        account_type: accountType,
      })
      .select("*")
      .single();

    if (insertError) throw insertError;

    const insertedAccount = inserted as BankAccount;
    insertedRows.push(insertedAccount);

    if (accountType === "checking") {
      const { error: txError } = await client.from("transactions").insert({
        account_id: insertedAccount.id,
        amount: STARTING_CHECKING_BALANCE,
        direction: "credit",
        transaction_type: "account_opening",
        description: "Starting checking balance",
      });

      if (txError) throw txError;
    }
  }

  return sortAccounts([...existing, ...insertedRows]);
}

function sortAccounts(rows: BankAccount[]): BankAccount[] {
  const order = new Map<BankAccountType, number>(
    BANK_ACCOUNT_TYPES.map((accountType, index) => [accountType, index])
  );

  return [...rows].sort((a, b) => {
    return (order.get(a.account_type) ?? 999) - (order.get(b.account_type) ?? 999);
  });
}

export async function getAccounts(client: QueryClient, playerId: string): Promise<BankAccount[]> {
  const { data, error } = await client
    .from("bank_accounts")
    .select("*")
    .eq("player_id", playerId);

  if (error) throw error;

  return sortAccounts((data as BankAccount[]) ?? []);
}

export async function getAccountsWithBalances(
  client: QueryClient,
  playerId: string,
  existingAccounts?: BankAccount[]
): Promise<BankAccountWithBalance[]> {
  const accounts = existingAccounts ?? (await getAccounts(client, playerId));

  if (accounts.length === 0) {
    return [];
  }

  const accountIds = accounts.map((account) => account.id);
  const { data, error } = await client
    .from("transactions")
    .select("account_id,amount,direction")
    .in("account_id", accountIds);

  if (error) throw error;

  const balancesByAccountId = new Map<string, number>();

  for (const row of (data as Array<{ account_id: string; amount: number | string; direction: string }>) ?? []) {
    const current = balancesByAccountId.get(row.account_id) ?? 0;
    const amount = toNumber(row.amount);
    const next = row.direction === "credit" ? current + amount : current - amount;
    balancesByAccountId.set(row.account_id, next);
  }

  return accounts.map((account) => ({
    ...account,
    balance: Number((balancesByAccountId.get(account.id) ?? 0).toFixed(2)),
  }));
}

export async function getTransactionHistory(
  client: QueryClient,
  playerId: string,
  filter: TransactionHistoryFilter
): Promise<TransactionEntry[]> {
  const accounts = await getAccounts(client, playerId);

  if (accounts.length === 0) {
    return [];
  }

  const ownedAccountIds = new Set(accounts.map((account) => account.id));
  if (filter.accountId && !ownedAccountIds.has(filter.accountId)) {
    throw new Error("Account does not belong to player.");
  }

  const queryAccountIds = filter.accountId
    ? [filter.accountId]
    : accounts.map((account) => account.id);

  let query = client
    .from("transactions")
    .select("*")
    .in("account_id", queryAccountIds)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? TRANSACTION_HISTORY_DEFAULT_LIMIT);

  if (filter.direction) {
    query = query.eq("direction", filter.direction);
  }

  if (filter.transactionType) {
    query = query.eq("transaction_type", filter.transactionType);
  }

  const { data, error } = await query;

  if (error) throw error;
  return ((data as TransactionEntry[]) ?? []).map((entry) => ({
    ...entry,
    amount: toNumber(entry.amount),
  }));
}

export async function transferBetweenOwnAccounts(
  client: QueryClient,
  playerId: string,
  input: TransferBetweenOwnAccountsInput
): Promise<{ transferId: string }> {
  const { data, error } = await client.rpc("transfer_between_own_accounts", {
    p_player_id: playerId,
    p_from_account_id: input.fromAccountId,
    p_to_account_id: input.toAccountId,
    p_amount: input.amount,
    p_description: input.description ?? null,
  });

  if (error) throw error;
  return { transferId: String(data) };
}

export async function transferBetweenPersonalAndBusiness(
  client: QueryClient,
  playerId: string,
  input: TransferBetweenPersonalAndBusinessInput
): Promise<{ transferId: string }> {
  const { data, error } = await client.rpc("transfer_between_personal_and_business", {
    p_player_id: playerId,
    p_personal_account_id: input.personalAccountId,
    p_business_id: input.businessId,
    p_amount: input.amount,
    p_direction: input.direction,
    p_description: input.description ?? null,
  });

  if (error) throw error;
  return { transferId: String(data) };
}

export async function transferBetweenOwnBusinesses(
  client: QueryClient,
  playerId: string,
  input: TransferBetweenOwnBusinessesInput
): Promise<{ transferId: string }> {
  const { data, error } = await client.rpc("transfer_between_own_businesses", {
    p_player_id: playerId,
    p_from_business_id: input.fromBusinessId,
    p_to_business_id: input.toBusinessId,
    p_amount: input.amount,
    p_description: input.description ?? null,
  });

  if (error) throw error;
  return { transferId: String(data) };
}

export async function getActiveLoan(client: QueryClient, playerId: string): Promise<Loan | null> {
  const { data, error } = await client
    .from("loans")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const loan = data as Loan;
  return {
    ...loan,
    principal: toNumber(loan.principal),
    interest_rate: toNumber(loan.interest_rate),
    balance_remaining: toNumber(loan.balance_remaining),
    minimum_weekly_payment: toNumber(loan.minimum_weekly_payment),
  };
}

export async function applyForLoan(
  client: QueryClient,
  playerId: string,
  input: ApplyForLoanInput,
  context: ApplyForLoanContext
): Promise<Loan> {
  await ensurePersonalAccounts(client, playerId);

  const maxLoanAvailable = calculateMaxLoanForBusinessLevel(context.businessLevel);

  if (input.principal < LOAN_MIN_PRINCIPAL || input.principal > LOAN_MAX_PRINCIPAL) {
    throw new Error(
      `Loan principal must be between ${LOAN_MIN_PRINCIPAL} and ${LOAN_MAX_PRINCIPAL}.`
    );
  }

  if (input.principal > maxLoanAvailable) {
    throw new Error(`Loan amount exceeds your current max of $${maxLoanAvailable.toFixed(2)}.`);
  }

  const { data, error } = await client.rpc("create_loan_for_player", {
    p_player_id: playerId,
    p_principal: input.principal,
    p_interest_rate: LOAN_DEFAULT_INTEREST_RATE,
    p_description: input.description ?? null,
  });

  if (error) throw error;

  const loanId = String(data);
  const { data: loanRow, error: loanError } = await client
    .from("loans")
    .select("*")
    .eq("id", loanId)
    .eq("player_id", playerId)
    .single();

  if (loanError) throw loanError;

  const loan = loanRow as Loan;
  return {
    ...loan,
    principal: toNumber(loan.principal),
    interest_rate: toNumber(loan.interest_rate),
    balance_remaining: toNumber(loan.balance_remaining),
    minimum_weekly_payment: toNumber(loan.minimum_weekly_payment),
  };
}

export async function payLoan(
  client: QueryClient,
  playerId: string,
  input: PayLoanInput
): Promise<{ paidAmount: number; updatedLoan: Loan }> {
  const { data, error } = await client.rpc("pay_loan_from_checking", {
    p_player_id: playerId,
    p_loan_id: input.loanId,
    p_amount: input.amount,
    p_description: input.description ?? null,
  });

  if (error) throw error;

  const { data: updatedLoanRow, error: updatedLoanError } = await client
    .from("loans")
    .select("*")
    .eq("id", input.loanId)
    .eq("player_id", playerId)
    .single();

  if (updatedLoanError) throw updatedLoanError;

  const updatedLoan = updatedLoanRow as Loan;

  return {
    paidAmount: toNumber(data),
    updatedLoan: {
      ...updatedLoan,
      principal: toNumber(updatedLoan.principal),
      interest_rate: toNumber(updatedLoan.interest_rate),
      balance_remaining: toNumber(updatedLoan.balance_remaining),
      minimum_weekly_payment: toNumber(updatedLoan.minimum_weekly_payment),
    },
  };
}

export async function getLoanSummary(
  client: QueryClient,
  playerId: string,
  businessLevel: number
): Promise<LoanSummary | null> {
  const loan = await getActiveLoan(client, playerId);
  if (!loan) return null;

  return {
    loan,
    currentMinimumDue: getCurrentWeeklyMinimumDue(loan),
    isPaymentOverdue: isLoanPaymentOverdue(loan),
  };
}

export async function getBankingSnapshot(
  client: QueryClient,
  playerId: string
): Promise<BankingSnapshot> {
  const [accounts, activeLoan] = await Promise.all([
    ensurePersonalAccounts(client, playerId),
    getActiveLoan(client, playerId),
  ]);
  const accountsWithBalances = await getAccountsWithBalances(client, playerId, accounts);

  return {
    accounts: accountsWithBalances,
    activeLoan,
  };
}
