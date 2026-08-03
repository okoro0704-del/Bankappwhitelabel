-- Fix: create-user rejected Escrow because a prior migration
-- accidentally allowed 'unlimited' instead of 'escrow'.

drop function if exists public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric
);
drop function if exists public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text
);

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
  p_product_type text default 'checking'
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
  v_pin constant text := '1111';
  v_activation text[];
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

  -- Accept legacy alias 'unlimited' as escrow (from a bad intermediate migration).
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

  -- Customers: temporary password defaults to username.
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
    one_time_transfer_used
  ) values (
    profile_row.id,
    actor.tenant_id,
    v_account_number,
    v_account_type::public.account_type,
    v_product_type::public.product_account_type,
    'active',
    false
  )
  returning * into account_row;

  if v_activation is not null then
    insert into public.account_activation_codes (account_id, tenant_id, codes)
    values (account_row.id, actor.tenant_id, v_activation)
    on conflict (account_id) do update
    set codes = excluded.codes, updated_at = timezone('utc', now());
  end if;

  insert into public.wallets (account_id, tenant_id, balance, currency)
  values (account_row.id, actor.tenant_id, 0, 'USD')
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
  text, text, text, text, text, text, text, text, numeric, text
) from public;
grant execute on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text
) to authenticated;

notify pgrst, 'reload schema';
