-- Tenant admin can create customer accounts via RPC (no Edge Function required).

create extension if not exists pgcrypto with schema extensions;

-- Allow tenant admins to create wallets/ledger rows through SECURITY DEFINER RPCs.
-- Authenticated clients still have no direct INSERT/UPDATE grants on these tables.
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
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
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
as $$
begin
  if auth.role() <> 'service_role'
    and not public.is_master_admin(auth.uid())
    and not public.is_admin(auth.uid())
  then
    raise exception 'Direct transaction mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.admin_create_tenant_user(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_username text,
  p_password text default null,
  p_phone text default null,
  p_account_type text default 'escrow',
  p_account_number text default null,
  p_initial_balance numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_password text := coalesce(p_password, '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_account_type text := lower(trim(coalesce(p_account_type, 'escrow')));
  v_account_number text := nullif(trim(coalesce(p_account_number, '')), '');
  v_balance numeric(18, 2) := coalesce(p_initial_balance, 0);
  new_user_id uuid;
  profile_row public.profiles%rowtype;
  account_row public.accounts%rowtype;
  wallet_row public.wallets%rowtype;
  hashed text;
  instance uuid := '00000000-0000-0000-0000-000000000000';
  fund_ref text;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor from public.profiles where user_id = auth.uid();
  if not found or actor.status <> 'active' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_username := regexp_replace(v_username, '[^a-z0-9_]', '_', 'g');

  if v_first = '' or v_last = '' then
    raise exception 'VALIDATION_ERROR: First and last name are required' using errcode = 'P0001';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'VALIDATION_ERROR: A valid email is required' using errcode = 'P0001';
  end if;
  if v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Username must be 3–30 characters (letters, numbers, underscore)'
      using errcode = 'P0001';
  end if;
  if v_account_type not in ('escrow', 'one_time_transfer', 'four_stage_verification') then
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

  if char_length(v_password) < 8 then
    v_password := substr(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', 'x'), 1, 16);
  end if;

  if v_account_number is null then
    v_account_number := public.generate_account_number();
  elsif v_account_number !~ '^\d{10}$' then
    raise exception 'VALIDATION_ERROR: Account number must be exactly 10 digits' using errcode = 'P0001';
  elsif exists (select 1 from public.accounts a where a.account_number = v_account_number) then
    raise exception 'VALIDATION_ERROR: Account number already exists' using errcode = 'P0001';
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

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    v_email,
    now(), now(), now()
  );

  insert into public.profiles (
    user_id, tenant_id, first_name, last_name, email, phone, username, status, role
  ) values (
    new_user_id, actor.tenant_id, v_first, v_last, v_email, v_phone, v_username, 'active', 'user'
  )
  returning * into profile_row;

  insert into public.accounts (
    profile_id, tenant_id, account_number, account_type, account_status, one_time_transfer_used
  ) values (
    profile_row.id, actor.tenant_id, v_account_number, v_account_type::public.account_type, 'active', false
  )
  returning * into account_row;

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
    ) values (
      wallet_row.id,
      account_row.id,
      actor.tenant_id,
      'funding',
      'completed',
      v_balance,
      0,
      v_balance,
      fund_ref,
      'create-user-' || new_user_id::text,
      'Initial balance on account creation',
      auth.uid(),
      '{}'::jsonb
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
      'createdAt', profile_row.created_at,
      'updatedAt', profile_row.updated_at
    ),
    'account', jsonb_build_object(
      'id', account_row.id,
      'accountNumber', account_row.account_number,
      'accountType', account_row.account_type,
      'accountStatus', account_row.account_status,
      'balance', wallet_row.balance,
      'currency', wallet_row.currency,
      'oneTimeTransferUsed', account_row.one_time_transfer_used,
      'walletId', wallet_row.id
    ),
    'temporaryPassword', v_password
  );
exception
  when others then
    if new_user_id is not null then
      delete from auth.users where id = new_user_id;
    end if;
    raise;
end;
$$;

revoke all on function public.admin_create_tenant_user(text, text, text, text, text, text, text, text, numeric) from public;
grant execute on function public.admin_create_tenant_user(text, text, text, text, text, text, text, text, numeric) to authenticated;
