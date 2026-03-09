import type {
  BankAccountType,
  BankingSnapshot,
  Loan,
  LoanSummary,
  TransactionEntry,
} from "./types";

export const BANK_ACCOUNT_LABELS: Record<BankAccountType, string> = {
  pocket_cash: "Pocket Cash",
  checking: "Checking",
  savings: "Savings",
  investment: "Investment",
};

export type BankingAccountsPayload = BankingSnapshot;

export type BankingAccountsResponse = BankingAccountsPayload & {
  error?: string;
};

export type BankingTransactionsPayload = {
  entries: TransactionEntry[];
};

export type BankingTransactionsResponse = BankingTransactionsPayload & {
  error?: string;
};

export type BankingLoanState = {
  summary: LoanSummary | null;
  maxLoanAvailable: number;
};

export type BankingLoanStateResponse = BankingLoanState & {
  error?: string;
};

export type BankingLoanApplicationResponse = {
  loan: Loan;
  error?: string;
};
