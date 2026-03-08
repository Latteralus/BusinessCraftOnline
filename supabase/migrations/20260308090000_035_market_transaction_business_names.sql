-- Phase 12 patch: persist business names on market transactions so feed rendering
-- does not depend on cross-player business table visibility under RLS.

alter table public.market_transactions
  add column if not exists seller_business_name text null,
  add column if not exists buyer_business_name text null;

update public.market_transactions tx
set seller_business_name = b.name
from public.businesses b
where tx.seller_business_id = b.id
  and tx.seller_business_name is null;

update public.market_transactions tx
set buyer_business_name = b.name
from public.businesses b
where tx.buyer_business_id = b.id
  and tx.buyer_business_name is null;

create or replace function public.set_market_transaction_business_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.seller_business_name is null and new.seller_business_id is not null then
    select name into new.seller_business_name
    from public.businesses
    where id = new.seller_business_id;
  end if;

  if new.buyer_business_name is null and new.buyer_business_id is not null then
    select name into new.buyer_business_name
    from public.businesses
    where id = new.buyer_business_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_market_transaction_business_names on public.market_transactions;

create trigger trg_set_market_transaction_business_names
before insert on public.market_transactions
for each row
execute function public.set_market_transaction_business_names();
