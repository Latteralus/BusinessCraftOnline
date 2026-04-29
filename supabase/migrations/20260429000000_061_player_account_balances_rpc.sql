-- Adds get_player_account_balances(p_player_id) so the app can fetch all
-- personal account balances in a single aggregate query instead of loading
-- every transaction row and computing sums in JavaScript.

create or replace function public.get_player_account_balances(p_player_id uuid)
returns table(account_id uuid, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    ba.id as account_id,
    coalesce(
      sum(case when t.direction = 'credit' then t.amount else -t.amount end),
      0
    )::numeric as balance
  from public.bank_accounts ba
  left join public.transactions t on t.account_id = ba.id
  where ba.player_id = p_player_id
  group by ba.id;
$$;

grant execute on function public.get_player_account_balances(uuid) to authenticated;
