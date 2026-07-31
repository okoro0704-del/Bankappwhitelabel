-- Phase 2: denormalize tenant_id onto financial tables + tenant-scoped RLS.
-- Preserves Northline data and does not alter transfer/wallet business rules.

-- ---------------------------------------------------------------------------
-- Helper: tenant-scoped admin check (does not replace Master Admin)
-- ---------------------------------------------------------------------------
create or replace function public.is_tenant_admin(auth_user_id uuid, resource_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth_user_id
      and role = 'admin'
      and status = 'active'
      and tenant_id = resource_tenant_id
  );
$$;

-- ---------------------------------------------------------------------------
-- accounts.tenant_id
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists tenant_id uuid references public.tenants (id);

update public.accounts a
set tenant_id = p.tenant_id
from public.profiles p
where a.profile_id = p.id
  and a.tenant_id is null;

-- Orphan safety: bind any remaining rows to Northline
update public.accounts
set tenant_id = 'a0000000-0000-4000-8000-000000000001'
where tenant_id is null;

alter table public.accounts
  alter column tenant_id set not null;

create index if not exists accounts_tenant_id_idx on public.accounts (tenant_id);
create index if not exists accounts_tenant_number_idx
  on public.accounts (tenant_id, account_number);

create or replace function public.protect_account_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.account_type is distinct from old.account_type
      or new.account_number is distinct from old.account_number
      or new.account_status is distinct from old.account_status
      or new.profile_id is distinct from old.profile_id
      or new.tenant_id is distinct from old.tenant_id
    then
      if auth.role() <> 'service_role' then
        raise exception 'Changing account type, number, status, ownership, or tenant is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Keep account.tenant_id aligned with profile.tenant_id on insert when omitted.
create or replace function public.set_account_tenant_from_profile()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id
    from public.profiles
    where id = new.profile_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_account_tenant_from_profile on public.accounts;
create trigger set_account_tenant_from_profile
before insert on public.accounts
for each row
execute function public.set_account_tenant_from_profile();

-- ---------------------------------------------------------------------------
-- wallets.tenant_id
-- ---------------------------------------------------------------------------
alter table public.wallets
  add column if not exists tenant_id uuid references public.tenants (id);

update public.wallets w
set tenant_id = a.tenant_id
from public.accounts a
where w.account_id = a.id
  and w.tenant_id is null;

update public.wallets
set tenant_id = 'a0000000-0000-4000-8000-000000000001'
where tenant_id is null;

alter table public.wallets
  alter column tenant_id set not null;

create index if not exists wallets_tenant_id_idx on public.wallets (tenant_id);

create or replace function public.protect_wallet_tenant()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    if auth.role() <> 'service_role' then
      raise exception 'Changing wallet tenant_id is not permitted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_wallet_tenant on public.wallets;
create trigger protect_wallet_tenant
before update on public.wallets
for each row
execute function public.protect_wallet_tenant();

create or replace function public.set_wallet_tenant_from_account()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id
    from public.accounts
    where id = new.account_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_wallet_tenant_from_account on public.wallets;
create trigger set_wallet_tenant_from_account
before insert on public.wallets
for each row
execute function public.set_wallet_tenant_from_account();

-- ---------------------------------------------------------------------------
-- transactions.tenant_id
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists tenant_id uuid references public.tenants (id);

update public.transactions t
set tenant_id = a.tenant_id
from public.accounts a
where t.account_id = a.id
  and t.tenant_id is null;

update public.transactions
set tenant_id = 'a0000000-0000-4000-8000-000000000001'
where tenant_id is null;

alter table public.transactions
  alter column tenant_id set not null;

create index if not exists transactions_tenant_id_idx on public.transactions (tenant_id);
create index if not exists transactions_tenant_created_idx
  on public.transactions (tenant_id, created_at desc);

create or replace function public.protect_transaction_tenant()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.amount is distinct from old.amount
    or new.balance_before is distinct from old.balance_before
    or new.balance_after is distinct from old.balance_after
    or new.wallet_id is distinct from old.wallet_id
    or new.account_id is distinct from old.account_id
  ) then
    if auth.role() <> 'service_role' then
      raise exception 'Changing ledger ownership, tenant, or amounts is not permitted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_transaction_tenant on public.transactions;
create trigger protect_transaction_tenant
before update on public.transactions
for each row
execute function public.protect_transaction_tenant();

-- ---------------------------------------------------------------------------
-- transfers.tenant_id
-- ---------------------------------------------------------------------------
alter table public.transfers
  add column if not exists tenant_id uuid references public.tenants (id);

update public.transfers t
set tenant_id = a.tenant_id
from public.accounts a
where t.account_id = a.id
  and t.tenant_id is null;

update public.transfers
set tenant_id = 'a0000000-0000-4000-8000-000000000001'
where tenant_id is null;

alter table public.transfers
  alter column tenant_id set not null;

create index if not exists transfers_tenant_id_idx on public.transfers (tenant_id);
create index if not exists transfers_tenant_created_idx
  on public.transfers (tenant_id, created_at desc);

create or replace function public.protect_transfer_tenant()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    if auth.role() <> 'service_role' then
      raise exception 'Changing transfer tenant_id is not permitted';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_transfer_tenant on public.transfers;
create trigger protect_transfer_tenant
before update on public.transfers
for each row
execute function public.protect_transfer_tenant();

create or replace function public.set_transfer_tenant_from_account()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id
    from public.accounts
    where id = new.account_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_transfer_tenant_from_account on public.transfers;
create trigger set_transfer_tenant_from_account
before insert on public.transfers
for each row
execute function public.set_transfer_tenant_from_account();

-- ---------------------------------------------------------------------------
-- Atomic RPCs: copy tenant_id from wallet onto ledger rows
-- ---------------------------------------------------------------------------
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
    tenant_id,
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
    locked_wallet.tenant_id,
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

create or replace function public.debit_wallet_atomic(
  p_wallet_id uuid,
  p_amount numeric,
  p_reference text,
  p_idempotency_key text default null,
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
    raise exception 'Debit amount must be greater than zero';
  end if;

  if p_idempotency_key is not null then
    select * into existing
    from public.transactions
    where idempotency_key = p_idempotency_key;

    if found then
      return existing;
    end if;
  end if;

  select * into existing
  from public.transactions
  where reference = p_reference;

  if found then
    return existing;
  end if;

  select * into locked_wallet
  from public.wallets
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'Wallet not found';
  end if;

  if locked_wallet.balance < p_amount then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  next_balance := locked_wallet.balance - p_amount;

  update public.wallets
  set balance = next_balance
  where id = locked_wallet.id;

  insert into public.transactions (
    wallet_id,
    account_id,
    tenant_id,
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
    locked_wallet.tenant_id,
    'debit',
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
    if p_idempotency_key is not null then
      select * into existing
      from public.transactions
      where idempotency_key = p_idempotency_key;
      if found then
        return existing;
      end if;
    end if;

    select * into existing
    from public.transactions
    where reference = p_reference;
    if found then
      return existing;
    end if;

    raise;
end;
$$;

-- complete_transfer_debit_atomic calls debit_wallet_atomic; no signature change needed.
-- Re-read existing definition is unchanged except debit_wallet_atomic now sets tenant_id.

-- ---------------------------------------------------------------------------
-- RLS: replace global admin reads with tenant-scoped admin reads
-- ---------------------------------------------------------------------------

-- Profiles
drop policy if exists "admins_can_read_profiles" on public.profiles;
create policy "tenant_admins_can_read_tenant_profiles"
on public.profiles
for select
using (public.is_tenant_admin(auth.uid(), tenant_id));

-- Accounts
drop policy if exists "admins_can_read_accounts" on public.accounts;
create policy "tenant_admins_can_read_tenant_accounts"
on public.accounts
for select
using (public.is_tenant_admin(auth.uid(), tenant_id));

-- Wallets
drop policy if exists "admins_can_read_wallets" on public.wallets;
create policy "tenant_admins_can_read_tenant_wallets"
on public.wallets
for select
using (public.is_tenant_admin(auth.uid(), tenant_id));

-- Transactions
drop policy if exists "admins_can_read_transactions" on public.transactions;
create policy "tenant_admins_can_read_tenant_transactions"
on public.transactions
for select
using (public.is_tenant_admin(auth.uid(), tenant_id));

-- Transfers
drop policy if exists "admins_can_read_transfers" on public.transfers;
create policy "tenant_admins_can_read_tenant_transfers"
on public.transfers
for select
using (public.is_tenant_admin(auth.uid(), tenant_id));

-- Verification codes: tenant admin via parent transfer tenant
drop policy if exists "admins_can_read_verification_codes" on public.transfer_verification_codes;
create policy "tenant_admins_can_read_tenant_verification_codes"
on public.transfer_verification_codes
for select
using (
  exists (
    select 1
    from public.transfers t
    where t.id = transfer_verification_codes.transfer_id
      and public.is_tenant_admin(auth.uid(), t.tenant_id)
  )
);
