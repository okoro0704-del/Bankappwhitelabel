-- Replace transfer-actions Edge Function with authenticated SECURITY DEFINER RPCs.
-- Also provisions customer transfer PINs and keeps customer-owned workflow writes
-- compatible with the transfer protection triggers.

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column if not exists transfer_pin_hash text,
  add column if not exists handoff_transfer_pin text;

-- Existing customers receive the last four digits of their account number as
-- their initial PIN. handoff_transfer_pin is intentionally retained for admin
-- handoff, matching the existing temporary-password handoff pattern.
update public.profiles p
set
  transfer_pin_hash = extensions.crypt(
    right(a.account_number, 4),
    extensions.gen_salt('bf', 10)
  ),
  handoff_transfer_pin = right(a.account_number, 4),
  updated_at = timezone('utc', now())
from public.accounts a
where a.profile_id = p.id
  and p.role = 'user'
  and p.transfer_pin_hash is null;

create or replace function public.set_default_transfer_pin_from_account()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_pin text;
begin
  v_pin := right(new.account_number, 4);

  update public.profiles
  set
    transfer_pin_hash = extensions.crypt(
      v_pin,
      extensions.gen_salt('bf', 10)
    ),
    handoff_transfer_pin = v_pin,
    updated_at = timezone('utc', now())
  where id = new.profile_id
    and role = 'user'
    and transfer_pin_hash is null;

  return new;
end;
$$;

drop trigger if exists set_default_transfer_pin_after_account_insert
  on public.accounts;
create trigger set_default_transfer_pin_after_account_insert
after insert on public.accounts
for each row
execute function public.set_default_transfer_pin_from_account();

-- ---------------------------------------------------------------------------
-- Trigger guards: permit service/admin mutations and customer-owned workflow
-- mutations. Table DML remains revoked from authenticated, so customer writes
-- still enter through the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------

create or replace function public.protect_wallet_privileges()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  v_account_id uuid;
  v_customer_owns_wallet boolean := false;
begin
  if tg_op = 'DELETE' then
    v_account_id := old.account_id;
  else
    v_account_id := new.account_id;
  end if;

  if auth.uid() is not null then
    select exists (
      select 1
      from public.accounts a
      join public.profiles p on p.id = a.profile_id
      where a.id = v_account_id
        and p.user_id = auth.uid()
    )
    into v_customer_owns_wallet;
  end if;

  if tg_op = 'UPDATE' then
    if new.balance is distinct from old.balance
      or new.account_id is distinct from old.account_id
      or new.currency is distinct from old.currency
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
        and not (
          v_customer_owns_wallet
          and new.account_id = old.account_id
          and new.currency = old.currency
        )
      then
        raise exception 'Direct wallet balance or ownership changes are not permitted';
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if auth.role() <> 'service_role'
      and not public.is_master_admin(auth.uid())
      and not public.is_admin(auth.uid())
    then
      raise exception 'Direct wallet inserts are not permitted';
    end if;
  elsif tg_op = 'DELETE' then
    if auth.role() <> 'service_role'
      and not public.is_master_admin(auth.uid())
      and not public.is_admin(auth.uid())
    then
      raise exception 'Direct wallet deletes are not permitted';
    end if;
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.protect_transaction_privileges()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  v_allowed boolean := false;
begin
  v_allowed :=
    auth.role() = 'service_role'
    or public.is_master_admin(auth.uid())
    or public.is_admin(auth.uid())
    or (
      tg_op = 'INSERT'
      and auth.uid() is not null
      and new.created_by = auth.uid()
      and exists (
        select 1
        from public.accounts a
        join public.profiles p on p.id = a.profile_id
        where a.id = new.account_id
          and p.user_id = auth.uid()
      )
    );

  if not v_allowed then
    raise exception 'Direct transaction mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.protect_transfer_privileges()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  v_allowed boolean := false;
begin
  v_allowed :=
    auth.role() = 'service_role'
    or public.is_master_admin(auth.uid())
    or public.is_admin(auth.uid())
    or (
      auth.uid() is not null
      and (
        (tg_op = 'INSERT' and new.user_id = auth.uid())
        or (tg_op in ('UPDATE', 'DELETE') and old.user_id = auth.uid())
      )
    );

  if not v_allowed then
    raise exception 'Direct transfer mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.protect_verification_code_privileges()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
  v_transfer_id uuid;
  v_allowed boolean := false;
begin
  if tg_op = 'DELETE' then
    v_transfer_id := old.transfer_id;
  else
    v_transfer_id := new.transfer_id;
  end if;

  v_allowed :=
    auth.role() = 'service_role'
    or public.is_master_admin(auth.uid())
    or public.is_admin(auth.uid())
    or (
      auth.uid() is not null
      and exists (
        select 1
        from public.transfers t
        where t.id = v_transfer_id
          and t.user_id = auth.uid()
      )
    );

  if not v_allowed then
    raise exception 'Direct verification code mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- DTO and verification helpers
-- ---------------------------------------------------------------------------

create or replace function public.transfer_json(t public.transfers)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'reference', t.reference,
    'status', t.status,
    'amount', t.amount,
    'recipient', jsonb_build_object(
      'name', t.recipient_name,
      'account', t.recipient_account,
      'bank', t.recipient_bank
    ),
    'description', t.description,
    'currentStage', t.current_stage,
    'stagesCompleted', t.stages_completed,
    'reasonCode', t.reason_code,
    'failureReason', t.failure_reason,
    'createdAt', t.created_at,
    'updatedAt', t.updated_at,
    'completedAt', t.completed_at
  );
$$;

create or replace function public.hash_verification_code(
  p_code text,
  p_transfer_id uuid,
  p_stage integer
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        'web-finance-dev-pepper'
          || ':' || p_transfer_id::text
          || ':' || p_stage::text
          || ':' || coalesce(p_code, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.upsert_transfer_stage_code(
  p_transfer_id uuid,
  p_stage integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_random bytea;
  v_number bigint;
  v_code text;
  v_expires_at timestamptz := timezone('utc', now()) + interval '15 minutes';
begin
  if p_stage not between 1 and 4 then
    raise exception 'VALIDATION_ERROR: Verification stage must be between 1 and 4'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.transfers where id = p_transfer_id
  ) then
    raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
  end if;

  v_random := extensions.gen_random_bytes(4);
  v_number :=
      get_byte(v_random, 0)::bigint * 16777216
    + get_byte(v_random, 1)::bigint * 65536
    + get_byte(v_random, 2)::bigint * 256
    + get_byte(v_random, 3)::bigint;
  v_code := lpad((v_number % 1000000)::text, 6, '0');

  insert into public.transfer_verification_codes (
    transfer_id,
    stage,
    code_hash,
    expires_at,
    attempts,
    max_attempts,
    consumed_at,
    updated_at
  )
  values (
    p_transfer_id,
    p_stage,
    public.hash_verification_code(v_code, p_transfer_id, p_stage),
    v_expires_at,
    0,
    5,
    null,
    timezone('utc', now())
  )
  on conflict (transfer_id, stage) do update
  set
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    max_attempts = 5,
    consumed_at = null,
    updated_at = timezone('utc', now());

  insert into public.transfer_verification_code_reveals (
    transfer_id,
    stage,
    code_plaintext
  )
  values (p_transfer_id, p_stage, v_code)
  on conflict (transfer_id, stage) do update
  set
    code_plaintext = excluded.code_plaintext,
    created_at = timezone('utc', now());

  return v_expires_at;
end;
$$;

create or replace function public.result_from_existing_transfer(
  t public.transfers,
  replay boolean
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_status text;
  v_transaction_id uuid;
begin
  if t.status = 'restricted' then
    v_status := 'restricted';
  elsif t.status = 'failed' then
    v_status := 'failed';
  elsif t.status::text like 'verification_stage_%' then
    v_status := 'verification_required';
  else
    v_status := 'completed';
  end if;

  v_transaction_id := t.ledger_transaction_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', v_status,
    'transferId', t.id,
    'reference', t.reference,
    'amount', t.amount,
    'transactionId', v_transaction_id,
    'stage', case
      when v_status = 'verification_required' then t.current_stage
      else null
    end,
    'reasonCode', t.reason_code,
    'reason', t.failure_reason,
    'idempotentReplay', replay,
    'transfer', public.transfer_json(t)
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer transfer RPCs
-- ---------------------------------------------------------------------------

create or replace function public.user_create_transfer(
  p_recipient_name text,
  p_recipient_account text,
  p_recipient_bank text,
  p_amount numeric,
  p_idempotency_key text,
  p_description text default null,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_account public.accounts%rowtype;
  v_wallet public.wallets%rowtype;
  v_existing public.transfers%rowtype;
  v_transfer public.transfers%rowtype;
  v_completed jsonb;
  v_reference text;
  v_name text := trim(coalesce(p_recipient_name, ''));
  v_recipient_account text := trim(coalesce(p_recipient_account, ''));
  v_bank text := trim(coalesce(p_recipient_bank, ''));
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_escrow_reason constant text :=
    'External transfers are unavailable for this account type.';
  v_one_time_failure constant text :=
    'Your transfer could not be completed. Please contact the bank for assistance.';
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select *
  into v_profile
  from public.profiles
  where user_id = v_user_id;

  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;

  if v_profile.transfer_pin_hash is null then
    raise exception 'VALIDATION_ERROR: Transfer PIN is not set'
      using errcode = 'P0001';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4,8}$' then
    raise exception 'VALIDATION_ERROR: Transfer PIN must be 4 to 8 digits'
      using errcode = 'P0001';
  end if;
  if extensions.crypt(p_pin, v_profile.transfer_pin_hash)
      is distinct from v_profile.transfer_pin_hash then
    raise exception 'INVALID_TRANSFER_PIN' using errcode = 'P0001';
  end if;

  if char_length(v_name) not between 2 and 100
    or v_recipient_account !~ '^\d{8,20}$'
    or char_length(v_bank) not between 2 and 100
    or v_idempotency_key = ''
    or p_amount is null
    or p_amount <= 0
  then
    raise exception 'VALIDATION_ERROR: Invalid transfer input'
      using errcode = 'P0001';
  end if;

  select *
  into v_existing
  from public.transfers
  where idempotency_key = v_idempotency_key;

  if found then
    if v_existing.user_id <> v_user_id then
      raise exception 'VALIDATION_ERROR: Idempotency key is already in use'
        using errcode = 'P0001';
    end if;
    return public.result_from_existing_transfer(v_existing, true);
  end if;

  select *
  into v_account
  from public.accounts
  where profile_id = v_profile.id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_account.account_status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;

  select *
  into v_wallet
  from public.wallets
  where account_id = v_account.id
  for update;

  if not found then
    raise exception 'NOT_FOUND: Wallet not found' using errcode = 'P0001';
  end if;
  if v_wallet.balance < p_amount then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  v_reference :=
    'TRF' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  if v_account.account_type = 'escrow' then
    insert into public.transfers (
      account_id, user_id, wallet_id, tenant_id, reference, idempotency_key,
      recipient_name, recipient_account, recipient_bank, amount, description,
      status, current_stage, stages_completed, reason_code, failure_reason
    )
    values (
      v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
      v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank,
      p_amount, v_description, 'restricted', 0, 0,
      'EXTERNAL_TRANSFER_NOT_ALLOWED', v_escrow_reason
    )
    returning * into v_transfer;

    return public.result_from_existing_transfer(v_transfer, false);
  end if;

  if v_account.account_type = 'one_time_transfer'
    and v_account.one_time_transfer_used then
    insert into public.transfers (
      account_id, user_id, wallet_id, tenant_id, reference, idempotency_key,
      recipient_name, recipient_account, recipient_bank, amount, description,
      status, current_stage, stages_completed, reason_code, failure_reason
    )
    values (
      v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
      v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank,
      p_amount, v_description, 'failed', 0, 0,
      'TRANSFER_LIMIT_REACHED', v_one_time_failure
    )
    returning * into v_transfer;

    return public.result_from_existing_transfer(v_transfer, false);
  end if;

  if v_account.account_type = 'one_time_transfer' then
    insert into public.transfers (
      account_id, user_id, wallet_id, tenant_id, reference, idempotency_key,
      recipient_name, recipient_account, recipient_bank, amount, description,
      status, current_stage, stages_completed
    )
    values (
      v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
      v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank,
      p_amount, v_description, 'processing', 0, 0
    )
    returning * into v_transfer;

    begin
      v_completed := public.complete_transfer_debit_atomic(
        v_transfer.id, true, false
      );
    exception
      when others then
        if sqlerrm = 'TRANSFER_LIMIT_REACHED' then
          update public.transfers
          set
            status = 'failed',
            reason_code = 'TRANSFER_LIMIT_REACHED',
            failure_reason = v_one_time_failure
          where id = v_transfer.id
          returning * into v_transfer;
          return public.result_from_existing_transfer(v_transfer, false);
        elsif sqlerrm = 'INSUFFICIENT_BALANCE' then
          raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
        elsif sqlerrm = 'ACCOUNT_INACTIVE' then
          raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
        else
          raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
        end if;
    end;

    select * into v_transfer
    from public.transfers
    where id = v_transfer.id;

    return jsonb_build_object(
      'status', 'completed',
      'transferId', v_transfer.id,
      'reference', v_transfer.reference,
      'amount', v_transfer.amount,
      'transactionId', v_transfer.ledger_transaction_id,
      'idempotentReplay',
        coalesce((v_completed ->> 'idempotent_replay')::boolean, false),
      'transfer', public.transfer_json(v_transfer)
    );
  end if;

  if v_account.account_type <> 'four_stage_verification' then
    raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
  end if;

  insert into public.transfers (
    account_id, user_id, wallet_id, tenant_id, reference, idempotency_key,
    recipient_name, recipient_account, recipient_bank, amount, description,
    status, current_stage, stages_completed
  )
  values (
    v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
    v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank,
    p_amount, v_description, 'verification_stage_1', 1, 0
  )
  returning * into v_transfer;

  perform public.upsert_transfer_stage_code(v_transfer.id, 1);

  return jsonb_build_object(
    'status', 'verification_required',
    'transferId', v_transfer.id,
    'reference', v_transfer.reference,
    'amount', v_transfer.amount,
    'stage', 1,
    'idempotentReplay', false,
    'transfer', public.transfer_json(v_transfer)
  );
exception
  when unique_violation then
    select *
    into v_existing
    from public.transfers
    where idempotency_key = v_idempotency_key;

    if found and v_existing.user_id = v_user_id then
      return public.result_from_existing_transfer(v_existing, true);
    end if;
    raise;
end;
$$;

create or replace function public.user_get_transfer_verification(
  p_transfer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_transfer public.transfers%rowtype;
  v_expires_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_actor
  from public.profiles
  where user_id = v_user_id
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_transfer
  from public.transfers
  where id = p_transfer_id
    and (
      user_id = v_user_id
      or (
        v_actor.role = 'admin'
        and tenant_id = v_actor.tenant_id
      )
    );
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select expires_at into v_expires_at
  from public.transfer_verification_codes
  where transfer_id = v_transfer.id
    and stage = v_transfer.current_stage;

  return jsonb_build_object(
    'transferId', v_transfer.id,
    'status', v_transfer.status,
    'stage', v_transfer.current_stage,
    'stagesCompleted', v_transfer.stages_completed,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.user_submit_transfer_verification(
  p_transfer_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_transfer public.transfers%rowtype;
  v_code_row public.transfer_verification_codes%rowtype;
  v_stage integer;
  v_next_stage integer;
  v_completed jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_actor
  from public.profiles
  where user_id = v_user_id
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_transfer
  from public.transfers
  where id = p_transfer_id
    and (
      user_id = v_user_id
      or (
        v_actor.role = 'admin'
        and tenant_id = v_actor.tenant_id
      )
    )
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_stage := v_transfer.current_stage;
  if v_stage not between 1 and 4
    or v_transfer.status::text <> 'verification_stage_' || v_stage::text then
    raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_code), '') !~ '^\d{6}$' then
    raise exception 'INVALID_VERIFICATION_CODE' using errcode = 'P0001';
  end if;

  select * into v_code_row
  from public.transfer_verification_codes
  where transfer_id = v_transfer.id
    and stage = v_stage
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_code_row.consumed_at is not null then
    raise exception 'INVALID_VERIFICATION_CODE' using errcode = 'P0001';
  end if;
  if v_code_row.expires_at < timezone('utc', now()) then
    raise exception 'VERIFICATION_EXPIRED' using errcode = 'P0001';
  end if;
  if v_code_row.attempts >= v_code_row.max_attempts then
    raise exception 'TOO_MANY_VERIFICATION_ATTEMPTS' using errcode = 'P0001';
  end if;

  if public.hash_verification_code(trim(p_code), v_transfer.id, v_stage)
      is distinct from v_code_row.code_hash then
    update public.transfer_verification_codes
    set attempts = attempts + 1
    where id = v_code_row.id;
    raise exception 'INVALID_VERIFICATION_CODE' using errcode = 'P0001';
  end if;

  update public.transfer_verification_codes
  set consumed_at = timezone('utc', now())
  where id = v_code_row.id;

  if v_stage < 4 then
    v_next_stage := v_stage + 1;

    update public.transfers
    set
      stages_completed = v_stage,
      current_stage = v_next_stage,
      status = ('verification_stage_' || v_next_stage::text)::public.transfer_status,
      updated_at = timezone('utc', now())
    where id = v_transfer.id
    returning * into v_transfer;

    perform public.upsert_transfer_stage_code(v_transfer.id, v_next_stage);

    return jsonb_build_object(
      'status', 'verification_required',
      'transferId', v_transfer.id,
      'reference', v_transfer.reference,
      'amount', v_transfer.amount,
      'stage', v_next_stage,
      'idempotentReplay', false,
      'transfer', public.transfer_json(v_transfer)
    );
  end if;

  update public.transfers
  set
    stages_completed = 4,
    updated_at = timezone('utc', now())
  where id = v_transfer.id;

  begin
    v_completed := public.complete_transfer_debit_atomic(
      v_transfer.id, false, true
    );
  exception
    when others then
      if sqlerrm = 'INSUFFICIENT_BALANCE' then
        raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
      elsif sqlerrm = 'ACCOUNT_INACTIVE' then
        raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
      elsif sqlerrm = 'VERIFICATION_REQUIRED' then
        raise exception 'VERIFICATION_REQUIRED' using errcode = 'P0001';
      else
        raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
      end if;
  end;

  select * into v_transfer
  from public.transfers
  where id = p_transfer_id;

  return jsonb_build_object(
    'status', 'completed',
    'transferId', v_transfer.id,
    'reference', v_transfer.reference,
    'amount', v_transfer.amount,
    'transactionId', v_transfer.ledger_transaction_id,
    'idempotentReplay',
      coalesce((v_completed ->> 'idempotent_replay')::boolean, false),
    'transfer', public.transfer_json(v_transfer)
  );
end;
$$;

create or replace function public.user_complete_transfer(
  p_transfer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_transfer public.transfers%rowtype;
  v_completed jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_actor
  from public.profiles
  where user_id = v_user_id
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_transfer
  from public.transfers
  where id = p_transfer_id
    and (
      user_id = v_user_id
      or (
        v_actor.role = 'admin'
        and tenant_id = v_actor.tenant_id
      )
    );
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_transfer.stages_completed < 4 then
    raise exception 'VERIFICATION_REQUIRED' using errcode = 'P0001';
  end if;

  begin
    v_completed := public.complete_transfer_debit_atomic(
      v_transfer.id, false, true
    );
  exception
    when others then
      if sqlerrm = 'INSUFFICIENT_BALANCE' then
        raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
      elsif sqlerrm = 'ACCOUNT_INACTIVE' then
        raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
      elsif sqlerrm = 'VERIFICATION_REQUIRED' then
        raise exception 'VERIFICATION_REQUIRED' using errcode = 'P0001';
      else
        raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
      end if;
  end;

  select * into v_transfer
  from public.transfers
  where id = p_transfer_id;

  return jsonb_build_object(
    'status', 'completed',
    'transferId', v_transfer.id,
    'reference', v_transfer.reference,
    'amount', v_transfer.amount,
    'transactionId', v_transfer.ledger_transaction_id,
    'idempotentReplay',
      coalesce((v_completed ->> 'idempotent_replay')::boolean, false),
    'transfer', public.transfer_json(v_transfer)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenant admin transfer-PIN handoff RPC
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_transfer_pin(
  p_profile_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin(v_user_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_actor
  from public.profiles
  where user_id = v_user_id
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if coalesce(p_pin, '') !~ '^\d{4,8}$' then
    raise exception 'VALIDATION_ERROR: Transfer PIN must be 4 to 8 digits'
      using errcode = 'P0001';
  end if;

  select * into v_target
  from public.profiles
  where id = p_profile_id;
  if not found
    or v_target.tenant_id is distinct from v_actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target.role <> 'user' then
    raise exception 'VALIDATION_ERROR: Transfer PINs can only be set for customer accounts'
      using errcode = 'P0001';
  end if;

  update public.profiles
  set
    transfer_pin_hash = extensions.crypt(
      p_pin,
      extensions.gen_salt('bf', 10)
    ),
    handoff_transfer_pin = p_pin,
    updated_at = timezone('utc', now())
  where id = v_target.id
  returning * into v_target;

  return jsonb_build_object(
    'profileId', v_target.id,
    'transferPin', v_target.handoff_transfer_pin,
    'handoffTransferPin', v_target.handoff_transfer_pin,
    'updatedAt', v_target.updated_at
  );
end;
$$;

-- Helpers are internal-only. Authenticated clients receive only the five RPCs.
revoke all on function public.set_default_transfer_pin_from_account() from public;
revoke all on function public.transfer_json(public.transfers) from public;
revoke all on function public.hash_verification_code(text, uuid, integer) from public;
revoke all on function public.upsert_transfer_stage_code(uuid, integer) from public;
revoke all on function public.result_from_existing_transfer(
  public.transfers, boolean
) from public;

revoke all on function public.user_create_transfer(
  text, text, text, numeric, text, text, text
) from public;
revoke all on function public.user_get_transfer_verification(uuid) from public;
revoke all on function public.user_submit_transfer_verification(uuid, text)
  from public;
revoke all on function public.user_complete_transfer(uuid) from public;
revoke all on function public.admin_set_transfer_pin(uuid, text) from public;

grant execute on function public.user_create_transfer(
  text, text, text, numeric, text, text, text
) to authenticated;
grant execute on function public.user_get_transfer_verification(uuid)
  to authenticated;
grant execute on function public.user_submit_transfer_verification(uuid, text)
  to authenticated;
grant execute on function public.user_complete_transfer(uuid)
  to authenticated;
grant execute on function public.admin_set_transfer_pin(uuid, text)
  to authenticated;
