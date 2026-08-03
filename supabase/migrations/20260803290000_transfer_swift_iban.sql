-- Optional SWIFT / IBAN on transfers + expose in transfer_json / create RPC.

alter table public.transfers
  add column if not exists recipient_swift text,
  add column if not exists recipient_iban text;

alter table public.transfers
  drop constraint if exists transfers_recipient_swift_check;
alter table public.transfers
  add constraint transfers_recipient_swift_check
  check (
    recipient_swift is null
    or recipient_swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'
  );

alter table public.transfers
  drop constraint if exists transfers_recipient_iban_check;
alter table public.transfers
  add constraint transfers_recipient_iban_check
  check (
    recipient_iban is null
    or recipient_iban ~ '^[A-Z]{2}[0-9A-Z]{13,32}$'
  );

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
      'bank', t.recipient_bank,
      'swift', t.recipient_swift,
      'iban', t.recipient_iban
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

drop function if exists public.user_create_transfer(
  text, text, text, numeric, text, text, text
);

create or replace function public.user_create_transfer(
  p_recipient_name text,
  p_recipient_account text,
  p_recipient_bank text,
  p_amount numeric,
  p_idempotency_key text,
  p_description text default null,
  p_pin text default null,
  p_recipient_swift text default null,
  p_recipient_iban text default null
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
  v_swift text := nullif(upper(regexp_replace(trim(coalesce(p_recipient_swift, '')), '\s+', '', 'g')), '');
  v_iban text := nullif(upper(regexp_replace(trim(coalesce(p_recipient_iban, '')), '\s+', '', 'g')), '');
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

  if v_swift is not null and v_swift !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then
    raise exception 'VALIDATION_ERROR: SWIFT/BIC must be 8 or 11 letters or digits'
      using errcode = 'P0001';
  end if;

  if v_iban is not null and v_iban !~ '^[A-Z]{2}[0-9A-Z]{13,32}$' then
    raise exception 'VALIDATION_ERROR: Enter a valid IBAN'
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
      recipient_name, recipient_account, recipient_bank, recipient_swift, recipient_iban,
      amount, description, status, current_stage, stages_completed, reason_code, failure_reason
    )
    values (
      v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
      v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank, v_swift, v_iban,
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
      recipient_name, recipient_account, recipient_bank, recipient_swift, recipient_iban,
      amount, description, status, current_stage, stages_completed, reason_code, failure_reason
    )
    values (
      v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
      v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank, v_swift, v_iban,
      p_amount, v_description, 'failed', 0, 0,
      'TRANSFER_LIMIT_REACHED', v_one_time_failure
    )
    returning * into v_transfer;

    return public.result_from_existing_transfer(v_transfer, false);
  end if;

  if v_account.account_type = 'one_time_transfer' then
    insert into public.transfers (
      account_id, user_id, wallet_id, tenant_id, reference, idempotency_key,
      recipient_name, recipient_account, recipient_bank, recipient_swift, recipient_iban,
      amount, description, status, current_stage, stages_completed
    )
    values (
      v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
      v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank, v_swift, v_iban,
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
    recipient_name, recipient_account, recipient_bank, recipient_swift, recipient_iban,
    amount, description, status, current_stage, stages_completed
  )
  values (
    v_account.id, v_user_id, v_wallet.id, v_account.tenant_id,
    v_reference, v_idempotency_key, v_name, v_recipient_account, v_bank, v_swift, v_iban,
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

revoke all on function public.user_create_transfer(
  text, text, text, numeric, text, text, text, text, text
) from public;
grant execute on function public.user_create_transfer(
  text, text, text, numeric, text, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
