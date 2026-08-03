-- Customer-facing account product (Checking / Current / Savings / etc.)
-- Separate from account_type behavior (escrow / one_time / four_stage) which stays admin-only.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'product_account_type'
  ) then
    create type public.product_account_type as enum (
      'checking',
      'current',
      'savings',
      'business'
    );
  end if;
end;
$$;

alter table public.accounts
  add column if not exists product_type public.product_account_type;

update public.accounts
set product_type = 'checking'
where product_type is null;

alter table public.accounts
  alter column product_type set default 'checking'::public.product_account_type;

alter table public.accounts
  alter column product_type set not null;

comment on column public.accounts.product_type is
  'Customer-facing account label (Checking, Current, Savings, Business).';
comment on column public.accounts.account_type is
  'Admin-only transfer behavior (escrow, one_time_transfer, four_stage_verification).';

-- Admins may change product_type; behavior (account_type) still master/service only.
create or replace function public.protect_account_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.account_type is distinct from old.account_type
      or new.account_number is distinct from old.account_number
      or new.profile_id is distinct from old.profile_id
      or new.tenant_id is distinct from old.tenant_id
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
      then
        raise exception 'Changing account behavior, number, ownership, or tenant is not permitted';
      end if;
    end if;

    if new.account_status is distinct from old.account_status
      or new.product_type is distinct from old.product_type
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
      then
        raise exception 'Changing account status or product type is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop function if exists public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric
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
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_password text := coalesce(p_password, '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_account_type text := lower(trim(coalesce(p_account_type, 'escrow')));
  v_product_type text := lower(trim(coalesce(p_product_type, 'checking')));
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

  if nullif(trim(v_password), '') is null then
    v_password := v_username;
  end if;

  if char_length(v_password) < 3 then
    raise exception 'VALIDATION_ERROR: Temporary password must be at least 3 characters'
      using errcode = 'P0001';
  end if;

  if v_account_number is null then
    v_account_number := public.generate_account_number();
  elsif v_account_number !~ '^\d{10}$' then
    raise exception 'VALIDATION_ERROR: Account number must be exactly 10 digits' using errcode = 'P0001';
  elsif exists (select 1 from public.accounts a where a.account_number = v_account_number) then
    raise exception 'VALIDATION_ERROR: Account number already exists' using errcode = 'P0001';
  end if;

  hashed := extensions.crypt(v_password, extensions.gen_salt('bf', 10));
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
    user_id, tenant_id, first_name, last_name, email, phone, username, status, role, handoff_temp_password
  ) values (
    new_user_id, actor.tenant_id, v_first, v_last, v_email, v_phone, v_username, 'active', 'user', v_password
  )
  returning * into profile_row;

  insert into public.accounts (
    profile_id, tenant_id, account_number, account_type, product_type, account_status, one_time_transfer_used
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

revoke all on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text
) from public;
grant execute on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text
) to authenticated;

-- Allow admin to change customer-facing product type after create.
create or replace function public.admin_set_account_product_type(
  p_account_id uuid,
  p_product_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  account_row public.accounts%rowtype;
  v_product text := lower(trim(coalesce(p_product_type, '')));
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

  if v_product not in ('checking', 'current', 'savings', 'business') then
    raise exception 'VALIDATION_ERROR: Invalid account type' using errcode = 'P0001';
  end if;

  select * into account_row from public.accounts where id = p_account_id;
  if not found or account_row.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.accounts
  set product_type = v_product::public.product_account_type, updated_at = now()
  where id = account_row.id
  returning * into account_row;

  return jsonb_build_object(
    'id', account_row.id,
    'accountNumber', account_row.account_number,
    'accountType', account_row.account_type,
    'productType', account_row.product_type,
    'accountStatus', account_row.account_status
  );
end;
$$;

revoke all on function public.admin_set_account_product_type(uuid, text) from public;
grant execute on function public.admin_set_account_product_type(uuid, text) to authenticated;
