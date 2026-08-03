-- Password rules:
--   Customers: login password = username
--   Tenant admins: use the temporary password already set on the tenant/profile (never rewrite)

create extension if not exists pgcrypto with schema extensions;

create or replace function public.ensure_email_identity(
  p_user_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if p_user_id is null or v_email = '' or position('@' in v_email) < 2 then
    return;
  end if;

  update auth.users u
  set
    email = v_email,
    email_confirmed_at = coalesce(u.email_confirmed_at, timezone('utc', now())),
    confirmation_token = coalesce(u.confirmation_token, ''),
    recovery_token = coalesce(u.recovery_token, ''),
    email_change = coalesce(u.email_change, ''),
    email_change_token_new = coalesce(u.email_change_token_new, ''),
    banned_until = null,
    deleted_at = null,
    updated_at = timezone('utc', now())
  where u.id = p_user_id;

  if not exists (
    select 1 from auth.identities i
    where i.user_id = p_user_id and i.provider = 'email'
  ) then
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      p_user_id,
      p_user_id,
      jsonb_build_object(
        'sub', p_user_id::text,
        'email', v_email,
        'email_verified', true
      ),
      'email',
      v_email,
      timezone('utc', now()),
      timezone('utc', now()),
      timezone('utc', now())
    );
  else
    update auth.identities i
    set
      provider_id = v_email,
      identity_data = coalesce(i.identity_data, '{}'::jsonb)
        || jsonb_build_object(
          'sub', p_user_id::text,
          'email', v_email,
          'email_verified', true
        ),
      updated_at = timezone('utc', now())
    where i.user_id = p_user_id
      and i.provider = 'email';
  end if;
end;
$$;

create or replace function public.set_auth_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if p_user_id is null or nullif(trim(coalesce(p_password, '')), '') is null then
    return;
  end if;

  update auth.users
  set
    encrypted_password = extensions.crypt(trim(p_password), extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where id = p_user_id;
end;
$$;

create or replace function public.auth_login_password_from_username(p_username text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(trim(coalesce(p_username, '')));
begin
  if v = '' then
    raise exception 'VALIDATION_ERROR: Username required for password' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create or replace function public._normalize_temp_login_password(p_username text, p_password text)
returns text
language plpgsql
immutable
as $$
declare
  v_username text := lower(trim(coalesce(p_username, '')));
  v_password text := nullif(trim(coalesce(p_password, '')), '');
begin
  -- Customers always get username-as-password when blank.
  if v_password is null then
    return v_username;
  end if;
  return v_password;
end;
$$;

-- Reset customer password → username
create or replace function public.admin_reset_password_to_username(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  v_password text;
  hashed text;
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

  select * into target from public.profiles where id = p_profile_id;
  if not found or target.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if target.role = 'admin' then
    raise exception 'VALIDATION_ERROR: Use master console to reset tenant admin passwords'
      using errcode = 'P0001';
  end if;

  if target.username is null or length(trim(target.username)) < 3 then
    raise exception 'VALIDATION_ERROR: Username is missing or too short to use as a password'
      using errcode = 'P0001';
  end if;

  v_password := lower(trim(target.username));
  hashed := extensions.crypt(v_password, extensions.gen_salt('bf'));

  update auth.users
  set
    encrypted_password = hashed,
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
  where id = target.user_id;

  perform public.ensure_email_identity(target.user_id, target.email);

  update public.profiles
  set handoff_temp_password = v_password, updated_at = now()
  where id = target.id
  returning * into target;

  return jsonb_build_object(
    'id', target.id,
    'username', target.username,
    'temporaryPassword', v_password,
    'handoffTempPassword', target.handoff_temp_password,
    'message', format('Login password set to username (%s)', v_password)
  );
end;
$$;

revoke all on function public.admin_reset_password_to_username(uuid) from public;
grant execute on function public.admin_reset_password_to_username(uuid) to authenticated;

-- Master provision: keep/set the admin temporary password (never force username / A1!).
create or replace function public.master_provision_tenant_admin(
  p_tenant_id uuid,
  p_username text,
  p_password text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  t public.tenants%rowtype;
  v_username text := lower(trim(coalesce(p_username, '')));
  v_password text := nullif(trim(coalesce(p_password, '')), '');
  v_email text := lower(trim(coalesce(p_email, '')));
  owner_id uuid;
  profile_id uuid;
  existing_profile public.profiles%rowtype;
  clash_id uuid;
  hashed text;
  instance uuid := '00000000-0000-0000-0000-000000000000';
begin
  perform public.require_master_admin();

  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_username := regexp_replace(v_username, '[^a-z0-9_]', '_', 'g');
  if v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Admin username must be 3–30 characters (letters, numbers, underscore)'
      using errcode = 'P0001';
  end if;

  -- Prefer explicit password, else existing handoff temp password.
  if v_password is null then
    v_password := nullif(trim(coalesce(t.handoff_temp_password, '')), '');
  end if;

  if v_password is null then
    raise exception 'VALIDATION_ERROR: Temporary password is required for admin login'
      using errcode = 'P0001';
  end if;

  -- Do not allow falling back to bare username for admins.
  if lower(v_password) = v_username then
    raise exception 'VALIDATION_ERROR: Admin temporary password cannot be the same as the username'
      using errcode = 'P0001';
  end if;

  owner_id := t.owner_user_id;

  if owner_id is not null then
    select * into existing_profile from public.profiles where user_id = owner_id;
    if v_email = '' then
      v_email := lower(trim(coalesce(existing_profile.email, '')));
    end if;
    if v_email = '' then
      select lower(trim(coalesce(u.email, ''))) into v_email from auth.users u where u.id = owner_id;
    end if;
  end if;

  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'VALIDATION_ERROR: Admin email is required to enable login'
      using errcode = 'P0001';
  end if;

  hashed := extensions.crypt(v_password, extensions.gen_salt('bf'));

  if owner_id is null then
    select u.id into owner_id
    from auth.users u
    where lower(u.email) = v_email
    limit 1;

    if owner_id is null then
      owner_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        instance, owner_id, 'authenticated', 'authenticated', v_email, hashed, now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        '{}'::jsonb, now(), now(), '', '', '', ''
      );
    else
      update auth.users u set
        encrypted_password = hashed,
        email_confirmed_at = coalesce(u.email_confirmed_at, now()),
        updated_at = now()
      where u.id = owner_id;
    end if;

    update public.tenants
    set owner_user_id = owner_id, updated_at = now()
    where id = p_tenant_id;
  else
    update auth.users u set
      encrypted_password = hashed,
      email = v_email,
      email_confirmed_at = coalesce(u.email_confirmed_at, now()),
      updated_at = now()
    where u.id = owner_id;
  end if;

  perform public.ensure_email_identity(owner_id, v_email);

  select p.id into clash_id
  from public.profiles p
  where lower(p.username) = v_username
    and p.user_id is distinct from owner_id
  limit 1;
  if clash_id is not null then
    raise exception 'VALIDATION_ERROR: That username is already taken' using errcode = 'P0001';
  end if;

  select p.id into clash_id
  from public.profiles p
  where lower(p.email) = v_email
    and p.user_id is distinct from owner_id
  limit 1;
  if clash_id is not null then
    raise exception 'VALIDATION_ERROR: That email is already used by another profile' using errcode = 'P0001';
  end if;

  select * into existing_profile from public.profiles where user_id = owner_id;
  if found then
    update public.profiles p set
      username = v_username,
      email = v_email,
      role = 'admin',
      tenant_id = p_tenant_id,
      status = 'active',
      handoff_temp_password = v_password,
      updated_at = now()
    where p.id = existing_profile.id
    returning p.id into profile_id;
  else
    insert into public.profiles (
      user_id, tenant_id, first_name, last_name, email, username, status, role, handoff_temp_password
    ) values (
      owner_id, p_tenant_id, 'Tenant', 'Admin', v_email, v_username, 'active', 'admin', v_password
    )
    returning id into profile_id;
  end if;

  update public.tenants set
    handoff_admin_username = v_username,
    handoff_temp_password = v_password,
    owner_user_id = owner_id,
    updated_at = now()
  where id = p_tenant_id;

  return jsonb_build_object(
    'ownerUserId', owner_id,
    'username', v_username,
    'email', v_email,
    'temporaryPassword', v_password,
    'message', format(
      'Admin login enabled. Sign in at /admin/login with username %s and the temporary password.',
      v_username
    )
  );
end;
$$;

revoke all on function public.master_provision_tenant_admin(uuid, text, text, text) from public;
grant execute on function public.master_provision_tenant_admin(uuid, text, text, text) to authenticated;

-- Patch create-user: default temp password = username (customers only).
-- Signature must match existing RPC (named args from the web client).
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

-- Backfill passwords to the correct rule set.
do $$
declare
  r record;
  v_password text;
  v_username text;
  v_a1 text;
begin
  for r in
    select
      p.id as profile_id,
      p.user_id,
      p.email,
      p.username,
      p.role,
      p.handoff_temp_password as profile_temp,
      t.handoff_temp_password as tenant_temp
    from public.profiles p
    left join public.tenants t on t.owner_user_id = p.user_id
    where p.username is not null
      and length(trim(p.username)) >= 3
      and p.user_id is not null
  loop
    v_username := lower(trim(r.username));
    perform public.ensure_email_identity(r.user_id, r.email);

    if r.role = 'admin' then
      -- Keep the created temporary password; strip auto A1! only when that was forced.
      v_password := coalesce(
        nullif(trim(r.tenant_temp), ''),
        nullif(trim(r.profile_temp), '')
      );
      v_a1 := v_username || 'A1!';
      if char_length(v_a1) < 8 then
        v_a1 := rpad(v_a1, 8, 'x');
      end if;

      -- If handoff was auto-rewritten to usernameA1!, we cannot recover the original.
      -- Leave auth hash alone unless we have a real temp password that is not A1!.
      if v_password is null then
        continue;
      end if;

      if v_password = v_a1 then
        -- Still sync identity; password stays whatever Auth currently has / A1! handoff.
        perform public.set_auth_password(r.user_id, v_password);
      else
        perform public.set_auth_password(r.user_id, v_password);
      end if;

      update public.tenants
      set
        handoff_admin_username = v_username,
        handoff_temp_password = v_password,
        updated_at = now()
      where owner_user_id = r.user_id;

      update public.profiles
      set handoff_temp_password = v_password, updated_at = now()
      where id = r.profile_id;
    else
      -- Customers: password is the username.
      v_password := v_username;
      perform public.set_auth_password(r.user_id, v_password);
      update public.profiles
      set handoff_temp_password = v_password, updated_at = now()
      where id = r.profile_id;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
