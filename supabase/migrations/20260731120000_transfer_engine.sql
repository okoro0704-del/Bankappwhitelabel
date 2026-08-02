-- Transfer engine: workflow state, verification codes, atomic debit, one-time guard.

alter table public.accounts
  add column if not exists one_time_transfer_used boolean not null default false;

create type public.transfer_status as enum (
  'initiated',
  'processing',
  'verification_stage_1',
  'verification_stage_2',
  'verification_stage_3',
  'verification_stage_4',
  'completed',
  'failed',
  'cancelled',
  'restricted'
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  ledger_transaction_id uuid references public.transactions (id) on delete set null,
  reference text not null,
  idempotency_key text not null,
  recipient_name text not null,
  recipient_account text not null,
  recipient_bank text not null,
  amount numeric(18, 2) not null check (amount > 0),
  description text,
  status public.transfer_status not null default 'initiated',
  current_stage integer not null default 0
    check (current_stage >= 0 and current_stage <= 4),
  stages_completed integer not null default 0
    check (stages_completed >= 0 and stages_completed <= 4),
  reason_code text,
  failure_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint transfers_reference_unique unique (reference),
  constraint transfers_idempotency_key_unique unique (idempotency_key),
  constraint transfers_recipient_name_check check (char_length(trim(recipient_name)) between 2 and 100),
  constraint transfers_recipient_account_check check (recipient_account ~ '^\d{8,20}$'),
  constraint transfers_recipient_bank_check check (char_length(trim(recipient_bank)) between 2 and 100)
);

create index transfers_account_id_idx on public.transfers (account_id);
create index transfers_user_id_idx on public.transfers (user_id);
create index transfers_status_idx on public.transfers (status);
create index transfers_created_at_idx on public.transfers (created_at desc);

-- Concurrency for one-time accounts is enforced via accounts.one_time_transfer_used
-- (atomic compare-and-set), not a global unique completed-transfer index.

create trigger set_transfers_updated_at
before update on public.transfers
for each row
execute function public.set_updated_at();

create table public.transfer_verification_codes (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id) on delete cascade,
  stage integer not null check (stage between 1 and 4),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint transfer_verification_codes_transfer_stage_unique unique (transfer_id, stage)
);

create index transfer_verification_codes_transfer_id_idx
  on public.transfer_verification_codes (transfer_id);

create trigger set_transfer_verification_codes_updated_at
before update on public.transfer_verification_codes
for each row
execute function public.set_updated_at();

-- Dev/test plaintext reveals: service-role only, never exposed via client RLS.
create table public.transfer_verification_code_reveals (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id) on delete cascade,
  stage integer not null check (stage between 1 and 4),
  code_plaintext text not null check (code_plaintext ~ '^\d{6}$'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint transfer_verification_code_reveals_transfer_stage_unique unique (transfer_id, stage)
);

create or replace function public.protect_transfer_privileges()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Direct transfer mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger protect_transfer_privileges
before insert or update or delete on public.transfers
for each row
execute function public.protect_transfer_privileges();

create or replace function public.protect_verification_code_privileges()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Direct verification code mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger protect_verification_code_privileges
before insert or update or delete on public.transfer_verification_codes
for each row
execute function public.protect_verification_code_privileges();

create trigger protect_verification_reveal_privileges
before insert or update or delete on public.transfer_verification_code_reveals
for each row
execute function public.protect_verification_code_privileges();

-- Atomic wallet debit with concurrency-safe balance check.
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

-- Complete an eligible transfer with atomic debit + one-time guard.
create or replace function public.complete_transfer_debit_atomic(
  p_transfer_id uuid,
  p_require_one_time_slot boolean default false,
  p_require_four_stages boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_transfer public.transfers%rowtype;
  locked_account public.accounts%rowtype;
  ledger public.transactions%rowtype;
  updated_rows integer;
begin
  select * into locked_transfer
  from public.transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'INVALID_TRANSFER';
  end if;

  if locked_transfer.status = 'completed' then
    return (
      select jsonb_build_object(
        'transfer', to_jsonb(t),
        'ledger', to_jsonb(tx),
        'idempotent_replay', true
      )
      from public.transfers t
      left join public.transactions tx on tx.id = t.ledger_transaction_id
      where t.id = p_transfer_id
    );
  end if;

  if locked_transfer.status in ('failed', 'cancelled', 'restricted') then
    raise exception 'INVALID_TRANSFER';
  end if;

  if p_require_four_stages then
    if locked_transfer.stages_completed < 4 then
      raise exception 'VERIFICATION_REQUIRED';
    end if;
  end if;

  select * into locked_account
  from public.accounts
  where id = locked_transfer.account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if locked_account.account_status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE';
  end if;

  if p_require_one_time_slot then
    update public.accounts
    set one_time_transfer_used = true
    where id = locked_account.id
      and one_time_transfer_used = false;

    get diagnostics updated_rows = row_count;
    if updated_rows = 0 then
      update public.transfers
      set status = 'failed',
          reason_code = 'TRANSFER_LIMIT_REACHED',
          failure_reason = 'Your transfer could not be completed. Please contact the bank for assistance.'
      where id = locked_transfer.id;

      raise exception 'TRANSFER_LIMIT_REACHED';
    end if;
  end if;

  ledger := public.debit_wallet_atomic(
    locked_transfer.wallet_id,
    locked_transfer.amount,
    locked_transfer.reference,
    'transfer-debit:' || locked_transfer.id::text,
    coalesce(locked_transfer.description, 'External transfer'),
    locked_transfer.user_id,
    jsonb_build_object(
      'source', 'transfer',
      'transfer_id', locked_transfer.id
    )
  );

  update public.transfers
  set status = 'completed',
      ledger_transaction_id = ledger.id,
      completed_at = timezone('utc', now()),
      reason_code = null,
      failure_reason = null
  where id = locked_transfer.id
  returning * into locked_transfer;

  return jsonb_build_object(
    'transfer', to_jsonb(locked_transfer),
    'ledger', to_jsonb(ledger),
    'idempotent_replay', false
  );
exception
  when unique_violation then
    -- Concurrent debit ledger idempotency collision: re-read completed state.
    return (
      select jsonb_build_object(
        'transfer', to_jsonb(t),
        'ledger', to_jsonb(tx),
        'idempotent_replay', true
      )
      from public.transfers t
      left join public.transactions tx on tx.id = t.ledger_transaction_id
      where t.id = p_transfer_id
        and t.status = 'completed'
    );
end;
$$;

revoke all on function public.debit_wallet_atomic(
  uuid, numeric, text, text, text, uuid, jsonb
) from public;
grant execute on function public.debit_wallet_atomic(
  uuid, numeric, text, text, text, uuid, jsonb
) to service_role;

revoke all on function public.complete_transfer_debit_atomic(
  uuid, boolean, boolean
) from public;
grant execute on function public.complete_transfer_debit_atomic(
  uuid, boolean, boolean
) to service_role;

alter table public.transfers enable row level security;
alter table public.transfer_verification_codes enable row level security;
alter table public.transfer_verification_code_reveals enable row level security;

create policy "users_can_read_own_transfers"
on public.transfers
for select
using (auth.uid() = user_id);

create policy "admins_can_read_transfers"
on public.transfers
for select
using (public.is_admin(auth.uid()));

-- Users may see verification metadata for own transfers, never hashes via a narrow view.
-- Direct table select is admin/service only; app exposes sanitized DTOs via services.
create policy "admins_can_read_verification_codes"
on public.transfer_verification_codes
for select
using (public.is_admin(auth.uid()));

create policy "users_can_read_own_verification_code_meta"
on public.transfer_verification_codes
for select
using (
  exists (
    select 1
    from public.transfers
    where transfers.id = transfer_verification_codes.transfer_id
      and transfers.user_id = auth.uid()
  )
);

-- Reveals: no policies for authenticated/anon → deny by default under RLS.
-- Service role bypasses RLS for admin/dev peek tooling.

revoke insert, update, delete on public.transfers from anon, authenticated;
revoke all on public.transfer_verification_codes from anon, authenticated;
revoke all on public.transfer_verification_code_reveals from anon, authenticated;
grant select on public.transfers to authenticated;
grant select (
  id, transfer_id, stage, expires_at, attempts, max_attempts, consumed_at, created_at, updated_at
) on public.transfer_verification_codes to authenticated;
