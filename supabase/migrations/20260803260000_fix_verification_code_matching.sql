-- Fix four-stage verification so admin-issued account codes always match submit.
-- Also repair admin_create_tenant_user (v_activation was wrongly typed as text[]).

-- Prefer account activation codes; fall back to random. Long-lived expiry.
create or replace function public.upsert_transfer_stage_code(
  p_transfer_id uuid,
  p_stage integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_expires_at timestamptz := timezone('utc', now()) + interval '10 years';
  v_codes jsonb;
begin
  if p_stage not between 1 and 4 then
    raise exception 'VALIDATION_ERROR: Invalid verification stage' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.transfers where id = p_transfer_id) then
    raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
  end if;

  select aac.codes
  into v_codes
  from public.transfers t
  join public.account_activation_codes aac on aac.account_id = t.account_id
  where t.id = p_transfer_id;

  if v_codes is not null and v_codes ? p_stage::text then
    v_code := v_codes ->> p_stage::text;
  end if;

  if v_code is null or v_code !~ '^\d{6}$' then
    v_code := public.generate_six_digit_code();
  end if;

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

-- Before comparing, resync hash from account deliverable codes when present.
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
  v_account_code text;
  v_submitted text := trim(coalesce(p_code, ''));
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

  if v_submitted !~ '^\d{6}$' then
    raise exception 'INVALID_VERIFICATION_CODE' using errcode = 'P0001';
  end if;

  -- Heal transfers created before codes were issued (or with random hashes).
  select aac.codes ->> v_stage::text
  into v_account_code
  from public.account_activation_codes aac
  where aac.account_id = v_transfer.account_id;

  select * into v_code_row
  from public.transfer_verification_codes
  where transfer_id = v_transfer.id
    and stage = v_stage
  for update;

  if not found then
    perform public.upsert_transfer_stage_code(v_transfer.id, v_stage);
    select * into v_code_row
    from public.transfer_verification_codes
    where transfer_id = v_transfer.id
      and stage = v_stage
    for update;
  elsif v_account_code is not null
    and v_account_code ~ '^\d{6}$'
    and v_code_row.consumed_at is null
    and public.hash_verification_code(v_account_code, v_transfer.id, v_stage)
        is distinct from v_code_row.code_hash then
    update public.transfer_verification_codes
    set
      code_hash = public.hash_verification_code(v_account_code, v_transfer.id, v_stage),
      expires_at = timezone('utc', now()) + interval '10 years',
      updated_at = timezone('utc', now())
    where id = v_code_row.id
    returning * into v_code_row;

    insert into public.transfer_verification_code_reveals (
      transfer_id, stage, code_plaintext
    )
    values (v_transfer.id, v_stage, v_account_code)
    on conflict (transfer_id, stage) do update
    set
      code_plaintext = excluded.code_plaintext,
      created_at = timezone('utc', now());
  end if;

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

  if public.hash_verification_code(v_submitted, v_transfer.id, v_stage)
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

-- When admin rotates codes, refresh in-flight transfer hashes for the current stage.
create or replace function public.admin_issue_activation_codes(
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  account_row public.accounts%rowtype;
  v_codes jsonb;
  r record;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor
  from public.profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into account_row
  from public.accounts
  where id = p_account_id
    and tenant_id = actor.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if account_row.account_type <> 'four_stage_verification' then
    raise exception 'VALIDATION_ERROR: Activation codes are only for four-stage verification accounts'
      using errcode = 'P0001';
  end if;

  v_codes := public.build_activation_codes();

  insert into public.account_activation_codes (account_id, tenant_id, codes, updated_at)
  values (account_row.id, account_row.tenant_id, v_codes, timezone('utc', now()))
  on conflict (account_id) do update
  set
    codes = excluded.codes,
    updated_at = timezone('utc', now());

  for r in
    select t.id, t.current_stage
    from public.transfers t
    where t.account_id = account_row.id
      and t.current_stage between 1 and 4
      and t.status::text = 'verification_stage_' || t.current_stage::text
  loop
    perform public.upsert_transfer_stage_code(r.id, r.current_stage);
  end loop;

  return jsonb_build_object(
    'accountId', account_row.id,
    'activationCodes', v_codes,
    'message', 'Four-stage verification codes created'
  );
end;
$$;

revoke all on function public.admin_issue_activation_codes(uuid) from public;
grant execute on function public.admin_issue_activation_codes(uuid) to authenticated;

-- Repair create-user: codes must be jsonb (text[] broke four-stage account creation).
create or replace function public.admin_create_tenant_user(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_username text,
  p_password text default null,
  p_phone text default null,
  p_account_type text default 'escrow',
  p_account_number text default null,
  p_initial_balance numeric default 0,
  p_product_type text default 'checking',
  p_currency text default 'USD',
  p_account_country text default null,
  p_routing_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_account_number text := nullif(trim(coalesce(p_account_number, '')), '');
  v_account_type text := lower(trim(coalesce(p_account_type, 'escrow')));
  v_product_type text := lower(trim(coalesce(p_product_type, 'checking')));
  v_balance numeric(18, 2) := coalesce(p_initial_balance, 0);
  v_password text := nullif(trim(coalesce(p_password, '')), '');
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
  v_country text := nullif(trim(coalesce(p_account_country, '')), '');
  v_routing text := nullif(trim(coalesce(p_routing_number, '')), '');
  v_pin constant text := '1111';
  v_activation jsonb := null;
  hashed text;
  new_user_id uuid;
  profile_row public.profiles%rowtype;
  account_row public.accounts%rowtype;
  wallet_row public.wallets%rowtype;
  fund_ref text;
  instance uuid := '00000000-0000-0000-0000-000000000000';
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor from public.profiles where user_id = auth.uid();
  if not found or actor.status <> 'active' or actor.tenant_id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_first = '' or v_last = '' then
    raise exception 'VALIDATION_ERROR: First and last name are required' using errcode = 'P0001';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'VALIDATION_ERROR: A valid email is required' using errcode = 'P0001';
  end if;
  v_username := regexp_replace(v_username, '[^a-z0-9_]', '_', 'g');
  if v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Username must be 3–30 characters (letters, numbers, underscore)'
      using errcode = 'P0001';
  end if;
  if v_account_type = 'unlimited' then
    v_account_type := 'escrow';
  end if;
  if v_account_type not in ('escrow', 'one_time_transfer', 'four_stage_verification') then
    raise exception 'VALIDATION_ERROR: Invalid account behavior' using errcode = 'P0001';
  end if;
  if v_product_type not in ('checking', 'current', 'savings', 'business') then
    raise exception 'VALIDATION_ERROR: Invalid account type' using errcode = 'P0001';
  end if;
  if v_balance < 0 then
    raise exception 'VALIDATION_ERROR: Initial balance cannot be negative' using errcode = 'P0001';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'VALIDATION_ERROR: Currency must be a 3-letter code (e.g. USD)' using errcode = 'P0001';
  end if;
  if v_country is not null and char_length(v_country) > 80 then
    raise exception 'VALIDATION_ERROR: Account country is too long' using errcode = 'P0001';
  end if;
  if v_routing is not null and v_routing !~ '^[0-9A-Za-z\-]{4,20}$' then
    raise exception 'VALIDATION_ERROR: Routing number must be 4–20 letters or digits'
      using errcode = 'P0001';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[1-9]\d{7,14}$' then
    raise exception 'VALIDATION_ERROR: Phone must be an international number (e.g. +15551234567)'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'VALIDATION_ERROR: That email is already in use' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = v_username) then
    raise exception 'VALIDATION_ERROR: That username is already taken' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'VALIDATION_ERROR: That email already has an auth login' using errcode = 'P0001';
  end if;

  if v_password is null then
    v_password := v_username;
  end if;

  if v_account_number is null then
    v_account_number := public.generate_account_number();
  elsif v_account_number !~ '^\d{10}$' then
    raise exception 'VALIDATION_ERROR: Account number must be exactly 10 digits' using errcode = 'P0001';
  elsif exists (select 1 from public.accounts a where a.account_number = v_account_number) then
    raise exception 'VALIDATION_ERROR: Account number already exists' using errcode = 'P0001';
  end if;

  if v_account_type = 'four_stage_verification' then
    v_activation := public.build_activation_codes();
  end if;

  hashed := extensions.crypt(v_password, extensions.gen_salt('bf'));
  new_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    instance, new_user_id, 'authenticated', 'authenticated', v_email, hashed, now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb, now(), now(), '', '', '', ''
  );

  perform public.ensure_email_identity(new_user_id, v_email);

  insert into public.profiles (
    user_id, tenant_id, first_name, last_name, email, phone, username, status, role,
    handoff_temp_password, transfer_pin_hash, handoff_transfer_pin
  ) values (
    new_user_id, actor.tenant_id, v_first, v_last, v_email, v_phone, v_username, 'active', 'user',
    v_password,
    extensions.crypt(v_pin, extensions.gen_salt('bf')),
    v_pin
  )
  returning * into profile_row;

  insert into public.accounts (
    profile_id, tenant_id, account_number, account_type, product_type, account_status,
    one_time_transfer_used, account_country, routing_number
  ) values (
    profile_row.id,
    actor.tenant_id,
    v_account_number,
    v_account_type::public.account_type,
    v_product_type::public.product_account_type,
    'active',
    false,
    v_country,
    v_routing
  )
  returning * into account_row;

  if v_activation is not null then
    insert into public.account_activation_codes (account_id, tenant_id, codes)
    values (account_row.id, actor.tenant_id, v_activation)
    on conflict (account_id) do update
    set codes = excluded.codes, updated_at = timezone('utc', now());
  end if;

  insert into public.wallets (account_id, tenant_id, balance, currency)
  values (account_row.id, actor.tenant_id, 0, v_currency)
  returning * into wallet_row;

  if v_balance > 0 then
    fund_ref := 'FND' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    update public.wallets
    set balance = v_balance, updated_at = now()
    where id = wallet_row.id
    returning * into wallet_row;

    insert into public.transactions (
      wallet_id, account_id, tenant_id, transaction_type, status, amount,
      balance_before, balance_after, reference, idempotency_key, description, created_by, metadata
    ) values (
      wallet_row.id, account_row.id, actor.tenant_id, 'funding', 'completed', v_balance,
      0, v_balance, fund_ref, 'create-user-' || new_user_id::text,
      'Initial balance on account creation', auth.uid(), '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile_row.id,
      'userId', profile_row.user_id,
      'firstName', profile_row.first_name,
      'lastName', profile_row.last_name,
      'email', profile_row.email,
      'phone', profile_row.phone,
      'username', profile_row.username,
      'status', profile_row.status,
      'role', profile_row.role,
      'avatarUrl', profile_row.avatar_url,
      'handoffTempPassword', profile_row.handoff_temp_password,
      'handoffTransferPin', profile_row.handoff_transfer_pin,
      'createdAt', profile_row.created_at,
      'updatedAt', profile_row.updated_at
    ),
    'account', jsonb_build_object(
      'id', account_row.id,
      'accountNumber', account_row.account_number,
      'accountType', account_row.account_type,
      'productType', account_row.product_type,
      'accountStatus', account_row.account_status,
      'accountCountry', account_row.account_country,
      'routingNumber', account_row.routing_number,
      'balance', wallet_row.balance,
      'currency', wallet_row.currency,
      'oneTimeTransferUsed', account_row.one_time_transfer_used,
      'walletId', wallet_row.id,
      'activationCodes', v_activation
    ),
    'temporaryPassword', v_password,
    'transferPin', v_pin,
    'activationCodes', v_activation
  );
exception
  when others then
    if new_user_id is not null then
      delete from auth.users where id = new_user_id;
    end if;
    raise;
end;
$$;

revoke all on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text, text, text, text
) from public;
grant execute on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text, text, text, text
) to authenticated;

-- Heal existing open transfers so stage hashes match account codes now.
do $$
declare
  r record;
begin
  for r in
    select t.id, t.current_stage
    from public.transfers t
    join public.account_activation_codes aac on aac.account_id = t.account_id
    where t.current_stage between 1 and 4
      and t.status::text = 'verification_stage_' || t.current_stage::text
  loop
    perform public.upsert_transfer_stage_code(r.id, r.current_stage);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
