-- Phase 12 patch: allow market purchases in personal transactions ledger.
-- The market buy flow records personal account debits with transaction_type = 'market_purchase'.

alter table public.transactions
  drop constraint if exists transactions_transaction_type_check;

alter table public.transactions
  add constraint transactions_transaction_type_check
  check (
    transaction_type in (
      'account_opening',
      'transfer_in',
      'transfer_out',
      'loan_disbursement',
      'loan_payment',
      'interest_credit',
      'manual_adjustment',
      'market_purchase'
    )
  );

