-- Phase 85: audit columns and ledger vocabulary for buy-order settlement.
--
-- market_transactions gains buy_order_id (nullable — only set for trades that
-- involved a buy order) and match_type, so the trade feed and buy-order fill
-- history can distinguish a manual listing purchase from an auto-swept or
-- directly-fulfilled buy order. Existing rows default to 'listing_purchase',
-- which is exactly what they are.
--
-- The personal transactions ledger's transaction_type is a closed enum
-- (see 007_transactions.sql, extended by 032 and 058); add the two new
-- values buy-order escrow/refund need for personal purchasers. business_accounts.category
-- is freeform text, so no equivalent constraint change is needed there.

alter table public.market_transactions
  add column buy_order_id uuid null references public.market_buy_orders(id) on delete set null,
  add column match_type text not null default 'listing_purchase';

alter table public.market_transactions
  add constraint market_transactions_match_type_check
  check (match_type in ('listing_purchase', 'buy_order_sweep', 'sell_listing_sweep', 'direct_fulfillment'));

create index idx_market_transactions_buy_order
  on public.market_transactions(buy_order_id)
  where buy_order_id is not null;

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
      'market_purchase',
      'market_sale',
      'shipping_fee',
      'buy_order_escrow',
      'buy_order_release'
    )
  );

-- Migration complete: market_transactions audit columns + buy-order ledger vocabulary
