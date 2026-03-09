import type {
  BANK_ACCOUNT_TYPES,
  LOAN_STATUSES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_TYPES,
} from "@/config/banking";

export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export type BankAccount = {
  id: string;
  player_id: string;
  account_type: BankAccountType;
  opened_at: string;
  created_at: string;
};

export type BankAccountWithBalance = BankAccount & {
  balance: number;
};

export type TransactionEntry = {
  id: string;
  account_id: string;
  amount: number;
  direction: TransactionDirection;
  transaction_type: TransactionType;
  reference_id: string | null;
  description: string;
  created_at: string;
};

export type Loan = {
  id: string;
  player_id: string;
  principal: number;
  interest_rate: number;
  balance_remaining: number;
  minimum_weekly_payment: number;
  next_payment_due: string | null;
  last_payment_at: string | null;
  missed_payment_count: number;
  status: LoanStatus;
  created_at: string;
  updated_at: string;
};

export type TransferBetweenOwnAccountsInput = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
};

export type TransferBetweenPersonalAndBusinessInput = {
  personalAccountId: string;
  businessId: string;
  amount: number;
  direction: "to_business" | "from_business";
  description?: string;
};

export type TransferBetweenOwnBusinessesInput = {
  fromBusinessId: string;
  toBusinessId: string;
  amount: number;
  description?: string;
};

export type TransactionHistoryFilter = {
  accountId?: string;
  direction?: TransactionDirection;
  transactionType?: TransactionType;
  limit?: number;
};

export type ApplyForLoanInput = {
  principal: number;
  description?: string;
};

export type ApplyForLoanContext = {
  businessLevel: number;
};

export type PayLoanInput = {
  loanId: string;
  amount: number;
  description?: string;
};

export type BankingSnapshot = {
  accounts: BankAccountWithBalance[];
  activeLoan: Loan | null;
};

export type LoanSummary = {
  loan: Loan;
  currentMinimumDue: number;
  isPaymentOverdue: boolean;
};
