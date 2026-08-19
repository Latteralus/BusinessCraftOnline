-- AccountingFixPlan Phase A: lightweight double-entry journal.
--
-- Adds business_journal_entries (header) / business_journal_lines (lines) so
-- every economic event can eventually post balanced debits and credits
-- against the canonical Chart of Accounts (src/config/finance.ts). This
-- migration only adds the schema, a balance-enforcing constraint, and a
-- single atomic posting RPC -- it does not yet rewire any existing
-- money-moving code path to use it. business_accounts remains the
-- authoritative cash ledger for now; journal_entry_id on business_accounts
-- is a nullable linkage column so later phases can connect a cash entry to
-- the journal transaction that produced it (per AccountingFixPlan Phase A:
-- "Keep business_accounts as the authoritative cash transaction ledger if
-- desired, but connect cash entries to their accounting journal
-- transaction").
--
-- The account_code check constraint on business_journal_lines is a plain SQL
-- literal list rather than a lookup against a table, so it must be kept in
-- sync by hand with CHART_OF_ACCOUNTS in src/config/finance.ts whenever an
-- account is added or removed there.

create table if not exists public.business_journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  reference_type text null check (reference_type is null or char_length(trim(reference_type)) between 1 and 64),
  reference_id uuid null,
  description text not null check (char_length(trim(description)) between 1 and 220),
  effective_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_business_journal_entries_business_effective
  on public.business_journal_entries(business_id, effective_at desc);

create index if not exists idx_business_journal_entries_reference
  on public.business_journal_entries(reference_type, reference_id)
  where reference_id is not null;

create table if not exists public.business_journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.business_journal_entries(id) on delete cascade,
  -- Denormalized from the parent entry so a line can be queried/aggregated
  -- (e.g. "all payroll_expense lines for business X") without a join, and so
  -- RLS on this table can check ownership directly.
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_code text not null check (
    account_code in (
      'cash',
      'inventory',
      'fixed_assets',
      'accumulated_depreciation',
      'wages_payable',
      'loan_payable',
      'owner_capital',
      'owner_draw',
      'retained_earnings',
      'intercompany',
      'revenue',
      'cogs',
      'payroll_expense',
      'shipping_expense',
      'market_fees',
      'advertising_expense',
      'depreciation_expense',
      'interest_expense',
      'operating_expense'
    )
  ),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  -- A line is either a debit or a credit, never both, and never neither.
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  item_key text null check (item_key is null or char_length(trim(item_key)) between 1 and 64),
  quantity integer null,
  description text null check (description is null or char_length(trim(description)) between 1 and 220),
  created_at timestamptz not null default now()
);

create index if not exists idx_business_journal_lines_entry
  on public.business_journal_lines(entry_id);

create index if not exists idx_business_journal_lines_business_account
  on public.business_journal_lines(business_id, account_code, created_at desc);

-- ---------------------------------------------------------------------------
-- Enforce SUM(debits) = SUM(credits) per journal entry. A plain CHECK
-- constraint can't aggregate across sibling rows, so this uses a deferred
-- constraint trigger: it fires once per row change but is only actually
-- evaluated at transaction commit, so a header + all of its lines can be
-- inserted across several statements within one transaction (as the posting
-- RPC below does) and only the final, fully-balanced state is checked.
-- ---------------------------------------------------------------------------

create or replace function public.check_journal_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_total_debit numeric;
  v_total_credit numeric;
  v_line_count integer;
begin
  v_entry_id := coalesce(new.entry_id, old.entry_id);

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
  into v_total_debit, v_total_credit, v_line_count
  from public.business_journal_lines
  where entry_id = v_entry_id;

  if v_line_count = 0 then
    -- Every line for this entry was deleted (e.g. the whole entry is being
    -- torn down via cascade); nothing left to balance.
    return null;
  end if;

  if v_line_count < 2 then
    raise exception 'Journal entry % has fewer than 2 lines.', v_entry_id;
  end if;

  if round(v_total_debit, 2) <> round(v_total_credit, 2) then
    raise exception 'Journal entry % is unbalanced: debits=% credits=%', v_entry_id, v_total_debit, v_total_credit;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_journal_lines_balanced on public.business_journal_lines;

create constraint trigger trg_journal_lines_balanced
  after insert or update or delete on public.business_journal_lines
  deferrable initially deferred
  for each row
  execute function public.check_journal_entry_balanced();

-- ---------------------------------------------------------------------------
-- Link cash ledger entries to the journal transaction that produced them.
-- Nullable and unused by existing code paths until each phase wires its
-- money-moving RPCs to also post a journal entry.
-- ---------------------------------------------------------------------------

alter table public.business_accounts
  add column if not exists journal_entry_id uuid null references public.business_journal_entries(id);

create index if not exists idx_business_accounts_journal_entry
  on public.business_accounts(journal_entry_id)
  where journal_entry_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: players can read their own businesses' journal; all writes go through
-- the service-role-only posting RPC below (mirrors business_financial_events'
-- pattern -- a player crafting their own unbalanced/fabricated journal lines
-- directly via PostgREST would be exactly the kind of self-serve accounting
-- fraud this table exists to prevent).
-- ---------------------------------------------------------------------------

alter table public.business_journal_entries enable row level security;

create policy "business_journal_entries_select_own"
  on public.business_journal_entries
  for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.player_id = auth.uid()
    )
  );

create policy "business_journal_entries_insert_service"
  on public.business_journal_entries
  for insert
  to service_role
  with check (true);

alter table public.business_journal_lines enable row level security;

create policy "business_journal_lines_select_own"
  on public.business_journal_lines
  for select
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.player_id = auth.uid()
    )
  );

create policy "business_journal_lines_insert_service"
  on public.business_journal_lines
  for insert
  to service_role
  with check (true);

comment on table public.business_journal_entries is
  'Double-entry journal header. One row per economic event; see business_journal_lines for its balanced debit/credit lines.';
comment on table public.business_journal_lines is
  'Double-entry journal lines. SUM(debit) = SUM(credit) per entry_id is enforced by trg_journal_lines_balanced.';

-- ---------------------------------------------------------------------------
-- Atomic posting RPC. Takes the header fields plus a jsonb array of lines,
-- inserts the header and every line in one statement each, and lets the
-- deferred balance trigger reject the whole transaction if the lines don't
-- balance. service_role only -- callers (future RPCs, or TypeScript via the
-- service-role client) are trusted internal code, mirroring
-- append_business_financial_event.
--
-- p_lines shape: [{"account_code": "cash", "debit": 100, "description": "..."}, ...]
-- Exactly one of debit/credit must be positive per line (enforced by the
-- table's own CHECK constraint), and lines must sum balanced (enforced by
-- the deferred trigger at commit).
-- ---------------------------------------------------------------------------

create or replace function public.post_business_journal_entry(
  p_business_id uuid,
  p_lines jsonb,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_description text default '',
  p_effective_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_line_count integer;
begin
  if p_business_id is null then
    raise exception 'business_id is required.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be a jsonb array.';
  end if;

  select count(*) into v_line_count from jsonb_array_elements(p_lines);
  if v_line_count < 2 then
    raise exception 'A journal entry needs at least 2 lines.';
  end if;

  insert into public.business_journal_entries (
    business_id, reference_type, reference_id, description, effective_at, metadata
  ) values (
    p_business_id,
    p_reference_type,
    p_reference_id,
    coalesce(nullif(trim(p_description), ''), 'Journal entry'),
    coalesce(p_effective_at, now()),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.business_journal_lines (
      entry_id, business_id, account_code, debit, credit, item_key, quantity, description
    ) values (
      v_entry_id,
      p_business_id,
      v_line ->> 'account_code',
      coalesce((v_line ->> 'debit')::numeric, 0),
      coalesce((v_line ->> 'credit')::numeric, 0),
      v_line ->> 'item_key',
      case when v_line ? 'quantity' then (v_line ->> 'quantity')::integer else null end,
      v_line ->> 'description'
    );
  end loop;

  return v_entry_id;
end;
$$;

revoke all on function public.post_business_journal_entry(uuid, jsonb, text, uuid, text, timestamptz, jsonb) from public;
grant execute on function public.post_business_journal_entry(uuid, jsonb, text, uuid, text, timestamptz, jsonb) to service_role;

-- Migration complete: double-entry journal schema, balance enforcement, and posting RPC.
