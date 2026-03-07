export const BANK_ACCOUNT_TYPES = [
  "pocket_cash",
  "checking",
  "savings",
  "investment",
] as const;

export const TRANSACTION_DIRECTIONS = ["credit", "debit"] as const;

export const TRANSACTION_TYPES = [
  "account_opening",
  "transfer_in",
  "transfer_out",
  "loan_disbursement",
  "loan_payment",
  "interest_credit",
  "manual_adjustment",
  "market_purchase",
] as const;

export const LOAN_STATUSES = ["active", "paid", "defaulted"] as const;

export const STARTING_POCKET_CASH = 5000;
export const LOAN_MIN_PRINCIPAL = 1000;
export const LOAN_MAX_PRINCIPAL = 50000;
export const LOAN_DEFAULT_INTEREST_RATE = 8;
export const LOAN_WEEKLY_MIN_PAYMENT_RATE = 0.1;
export const LOAN_WEEKLY_PAYMENT_INTERVAL_DAYS = 7;
export const LOAN_LIMIT_PER_BUSINESS_LEVEL = 2500;

export const TRANSACTION_HISTORY_DEFAULT_LIMIT = 50;
export const TRANSACTION_HISTORY_MAX_LIMIT = 200;
