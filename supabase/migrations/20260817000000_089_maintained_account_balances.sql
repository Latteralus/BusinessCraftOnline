-- Resolves audit finding C1 (Documents/SBAudit.md) and architectural
-- recommendation #1: replace live SUM() ledger aggregation with a
-- transactionally maintained running balance.
--
-- `transactions` and `business_accounts` are append-only ledgers (RLS blocks
-- update/delete on both). Every account/business balance in the app was
-- computed by summing the *entire* ledger on every read -- most visibly in
-- get_online_player_previews, which did this for every player in the
-- database (not just online ones) on every 60s app-shell poll.
--
-- Fix: add a maintained `balance` / `cash_balance` column, kept in sync by an
-- AFTER INSERT trigger on each ledger table (both tables are insert-only, so
-- INSERT is the only write path that needs to be covered). This turns every
-- balance read into an O(1) column read instead of an O(history) scan, with
-- no change to the RPC signatures or call sites -- existing callers
-- (get_bank_account_balance, get_business_account_balance,
-- get_player_account_balances) keep the same name/args/return shape.
--
-- Locking note: transfer_between_own_accounts, transfer_between_personal_and_business,
-- transfer_between_own_businesses, and pay_loan_from_checking (migration 072)
-- already lock the relevant bank_accounts/businesses row with `for update`
-- before calling these getters and checking sufficiency. The trigger's
-- UPDATE runs against that same already-locked row inside the same
-- transaction, so this changes nothing about the existing double-spend
-- protection -- it only changes how the balance value itself is computed.

-- ---------------------------------------------------------------------------
-- 1. Add maintained balance columns.
-- ---------------------------------------------------------------------------

alter table public.bank_accounts
  add column if not exists balance numeric(14, 2) not null default 0;

alter table public.businesses
  add column if not exists cash_balance numeric(14, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the existing ledgers.
-- ---------------------------------------------------------------------------

update public.bank_accounts ba
set balance = coalesce(t.total, 0)
from (
  select
    account_id,
    sum(case when direction = 'credit' then amount else -amount end) as total
  from public.transactions
  group by account_id
) t
where t.account_id = ba.id;

update public.businesses b
set cash_balance = coalesce(e.total, 0)
from (
  select
    business_id,
    sum(case when entry_type = 'credit' then amount else -amount end) as total
  from public.business_accounts
  group by business_id
) e
where e.business_id = b.id;

-- ---------------------------------------------------------------------------
-- 3. Triggers to keep the columns in sync on every future ledger insert.
-- ---------------------------------------------------------------------------

create or replace function public.apply_transaction_to_bank_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bank_accounts
  set balance = balance + case when new.direction = 'credit' then new.amount else -new.amount end
  where id = new.account_id;

  return new;
end;
$$;

drop trigger if exists trg_transactions_apply_balance on public.transactions;

create trigger trg_transactions_apply_balance
  after insert on public.transactions
  for each row
  execute function public.apply_transaction_to_bank_balance();

create or replace function public.apply_entry_to_business_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.businesses
  set cash_balance = cash_balance + case when new.entry_type = 'credit' then new.amount else -new.amount end
  where id = new.business_id;

  return new;
end;
$$;

drop trigger if exists trg_business_accounts_apply_balance on public.business_accounts;

create trigger trg_business_accounts_apply_balance
  after insert on public.business_accounts
  for each row
  execute function public.apply_entry_to_business_balance();

-- ---------------------------------------------------------------------------
-- 4. Point the existing balance-reading RPCs at the maintained columns.
--    Signatures and return shapes are unchanged -- no app code needs to
--    change for these three.
-- ---------------------------------------------------------------------------

create or replace function public.get_bank_account_balance(p_account_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(balance, 0)::numeric
  from public.bank_accounts
  where id = p_account_id;
$$;

create or replace function public.get_business_account_balance(p_business_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(cash_balance, 0)::numeric
  from public.businesses
  where id = p_business_id;
$$;

create or replace function public.get_player_account_balances(p_player_id uuid)
returns table(account_id uuid, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select ba.id as account_id, ba.balance
  from public.bank_accounts ba
  where ba.player_id = p_player_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rewrite get_online_player_previews to filter to the online player set
--    FIRST, then aggregate only their (few) accounts/businesses/loans using
--    the maintained columns -- instead of summing every player's entire
--    history before joining down to who's online.
-- ---------------------------------------------------------------------------

create or replace function public.get_online_player_previews(p_window_seconds integer default 300)
returns table (
  player_id uuid,
  character_name text,
  business_level integer,
  wealth numeric,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with bounded_window as (
    select greatest(30, least(coalesce(p_window_seconds, 300), 3600)) as window_seconds
  ),
  online as (
    select pp.player_id, pp.last_seen_at
    from public.player_presence pp
    cross join bounded_window bw
    where pp.last_seen_at >= now() - make_interval(secs => bw.window_seconds)
  ),
  personal_balances as (
    select ba.player_id, round(coalesce(sum(ba.balance), 0)::numeric, 2) as total
    from public.bank_accounts ba
    where ba.player_id in (select player_id from online)
    group by ba.player_id
  ),
  business_totals as (
    select
      b.player_id,
      round(coalesce(sum(b.cash_balance), 0)::numeric, 2) as cash_total,
      round(coalesce(sum(b.value), 0)::numeric, 2) as value_total
    from public.businesses b
    where b.player_id in (select player_id from online)
    group by b.player_id
  ),
  active_loans as (
    select l.player_id, round(coalesce(sum(l.balance_remaining), 0)::numeric, 2) as total
    from public.loans l
    where l.status = 'active'
      and l.player_id in (select player_id from online)
    group by l.player_id
  )
  select
    o.player_id,
    trim(c.first_name || ' ' || c.last_name) as character_name,
    c.business_level,
    round((
      coalesce(pb.total, 0) +
      coalesce(bt.cash_total, 0) +
      coalesce(bt.value_total, 0) -
      coalesce(al.total, 0)
    )::numeric, 2) as wealth,
    o.last_seen_at
  from online o
  join public.characters c on c.player_id = o.player_id
  left join personal_balances pb on pb.player_id = o.player_id
  left join business_totals bt on bt.player_id = o.player_id
  left join active_loans al on al.player_id = o.player_id
  order by wealth desc, character_name asc;
$$;

grant execute on function public.get_bank_account_balance(uuid) to authenticated;
grant execute on function public.get_business_account_balance(uuid) to authenticated;
grant execute on function public.get_player_account_balances(uuid) to authenticated;
grant execute on function public.get_online_player_previews(integer) to authenticated;
