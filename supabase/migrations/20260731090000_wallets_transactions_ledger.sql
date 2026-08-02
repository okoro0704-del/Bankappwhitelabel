-- Wallets, ledger transactions, atomic funding, and RLS.
-- Builds on profiles/accounts. Does not implement transfers.

create type public.transaction_type as enum (
  'funding',
  'debit',
  'credit'
);

create type public.transaction_status as enum (
  'pending',
  'completed',
  'failed'
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts (id) on delete cascade,
  balance numeric(18, 2) not null default 0 check (balance >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint wallets_currency_check check (char_length(currency) between 3 and 8)
);

create index wallets_account_id_idx on public.wallets (account_id);

create trigger set_wallets_updated_at
before update on public.wallets
for each row
execute function public.set_updated_at();

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  transaction_type public.transaction_type not null,
  status public.transaction_status not null default 'completed',
  amount numeric(18, 2) not null check (amount > 0),
  balance_before numeric(18, 2) not null check (balance_before >= 0),
  balance_after numeric(18, 2) not null check (balance_after >= 0),
  reference text not null,
  idempotency_key text,
  description text,
  created_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint transactions_reference_unique unique (reference),
  constraint transactions_idempotency_key_unique unique (idempotency_key),
  constraint transactions_balance_math_check check (
    (
      transaction_type = 'funding'
      and balance_after = balance_before + amount
    )
    or (
      transaction_type = 'credit'
      and balance_after = balance_before + amount
    )
    or (
      transaction_type = 'debit'
      and balance_after = balance_before - amount
    )
  )
);

create index transactions_wallet_id_idx on public.transactions (wallet_id);
create index transactions_account_id_idx on public.transactions (account_id);
create index transactions_type_status_idx
  on public.transactions (transaction_type, status);
create index transactions_created_at_idx on public.transactions (created_at desc);

create trigger set_transactions_updated_at
before update on public.transactions
for each row
execute function public.set_updated_at();

-- Prevent clients from mutating wallet balances or ownership.
create or replace function public.protect_wallet_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.balance is distinct from old.balance
      or new.account_id is distinct from old.account_id
      or new.currency is distinct from old.currency
    then
      if auth.role() <> 'service_role' then
        raise exception 'Direct wallet balance or ownership changes are not permitted';
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if auth.role() <> 'service_role' then
      raise exception 'Direct wallet inserts are not permitted';
    end if;
  elsif tg_op = 'DELETE' then
    if auth.role() <> 'service_role' then
      raise exception 'Direct wallet deletes are not permitted';
    end if;
    return old;
  end if;

  return new;
end;
$$;

create trigger protect_wallet_privileges
before insert or update or delete on public.wallets
for each row
execute function public.protect_wallet_privileges();

-- Prevent clients from inserting/updating/deleting ledger rows.
create or replace function public.protect_transaction_privileges()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Direct transaction mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger protect_transaction_privileges
before insert or update or delete on public.transactions
for each row
execute function public.protect_transaction_privileges();

-- Atomic wallet funding with idempotency.
-- Returns existing completed funding row when the same idempotency_key is reused.
create or replace function public.fund_wallet_atomic(
  p_wallet_id uuid,
  p_amount numeric,
  p_reference text,
  p_idempotency_key text,
  p_description text default null,
  p_created_by uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_wallet public.wallets%rowtype;
  existing public.transactions%rowtype;
  created public.transactions%rowtype;
  next_balance numeric(18, 2);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Funding amount must be greater than zero';
  end if;

  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'Funding reference is required';
  end if;

  if p_idempotency_key is not null then
    select *
    into existing
    from public.transactions
    where idempotency_key = p_idempotency_key;

    if found then
      return existing;
    end if;
  end if;

  select *
  into existing
  from public.transactions
  where reference = p_reference;

  if found then
    return existing;
  end if;

  select *
  into locked_wallet
  from public.wallets
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'Wallet not found';
  end if;

  next_balance := locked_wallet.balance + p_amount;

  update public.wallets
  set balance = next_balance
  where id = locked_wallet.id;

  insert into public.transactions (
    wallet_id,
    account_id,
    transaction_type,
    status,
    amount,
    balance_before,
    balance_after,
    reference,
    idempotency_key,
    description,
    created_by,
    metadata
  )
  values (
    locked_wallet.id,
    locked_wallet.account_id,
    'funding',
    'completed',
    p_amount,
    locked_wallet.balance,
    next_balance,
    trim(p_reference),
    nullif(trim(p_idempotency_key), ''),
    p_description,
    p_created_by,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into created;

  return created;
exception
  when unique_violation then
    -- Concurrent duplicate reference/idempotency key: return the winner row.
    if p_idempotency_key is not null then
      select *
      into existing
      from public.transactions
      where idempotency_key = p_idempotency_key;

      if found then
        return existing;
      end if;
    end if;

    select *
    into existing
    from public.transactions
    where reference = p_reference;

    if found then
      return existing;
    end if;

    raise;
end;
$$;

revoke all on function public.fund_wallet_atomic(
  uuid, numeric, text, text, text, uuid, jsonb
) from public;
grant execute on function public.fund_wallet_atomic(
  uuid, numeric, text, text, text, uuid, jsonb
) to service_role;

alter table public.wallets enable row level security;
alter table public.transactions enable row level security;

create policy "users_can_read_own_wallet"
on public.wallets
for select
using (
  exists (
    select 1
    from public.accounts
    join public.profiles on profiles.id = accounts.profile_id
    where accounts.id = wallets.account_id
      and profiles.user_id = auth.uid()
  )
);

create policy "admins_can_read_wallets"
on public.wallets
for select
using (public.is_admin(auth.uid()));

create policy "users_can_read_own_transactions"
on public.transactions
for select
using (
  exists (
    select 1
    from public.accounts
    join public.profiles on profiles.id = accounts.profile_id
    where accounts.id = transactions.account_id
      and profiles.user_id = auth.uid()
  )
);

create policy "admins_can_read_transactions"
on public.transactions
for select
using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.wallets from anon, authenticated;
revoke insert, update, delete on public.transactions from anon, authenticated;
grant select on public.wallets to authenticated;
grant select on public.transactions to authenticated;
