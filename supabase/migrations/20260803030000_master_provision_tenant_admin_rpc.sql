-- Provision tenant admin login via SQL (no Edge Function required).
-- Creates/updates auth.users + profiles so handoff username/password work at /admin/login.

create extension if not exists pgcrypto with schema extensions;

-- Allow master-admin SECURITY DEFINER flows to sync role/email/tenant on profiles.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.user_id is distinct from old.user_id
      or new.email is distinct from old.email
      or new.tenant_id is distinct from old.tenant_id
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
      then
        raise exception 'Changing role, status, user_id, email, or tenant_id is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  ident text := lower(trim(coalesce(p_identifier, '')));
  sanitized text;
  em text;
begin
  if ident = '' then
    return null;
  end if;

  if position('@' in ident) > 0 then
    return ident;
  end if;

  sanitized := regexp_replace(ident, '[^a-z0-9_]', '_', 'g');

  select lower(p.email) into em
  from public.profiles p
  where lower(p.username) in (ident, sanitized)
  limit 1;

  if em is not null and em <> '' then
    return em;
  end if;

  select lower(coalesce(nullif(p.email, ''), u.email)) into em
  from public.tenants t
  left join public.profiles p on p.user_id = t.owner_user_id
  left join auth.users u on u.id = t.owner_user_id
  where lower(trim(coalesce(t.handoff_admin_username, ''))) in (ident, sanitized)
     or lower(regexp_replace(trim(coalesce(t.handoff_admin_username, '')), '[^a-z0-9_]', '_', 'g')) in (ident, sanitized)
  limit 1;

  if em is null or em = '' then
    return null;
  end if;

  return em;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.master_provision_tenant_admin(
  p_tenant_id uuid,
  p_username text,
  p_password text,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  t public.tenants%rowtype;
  username text := lower(trim(coalesce(p_username, '')));
  password text := coalesce(p_password, '');
  email text := lower(trim(coalesce(p_email, '')));
  owner_id uuid;
  profile_id uuid;
  account_id uuid;
  existing_profile public.profiles%rowtype;
  clash_id uuid;
  hashed text;
  instance uuid := '00000000-0000-0000-0000-000000000000';
  identity_exists boolean := false;
begin
  perform public.require_master_admin();

  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  username := regexp_replace(username, '[^a-z0-9_]', '_', 'g');
  if username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Admin username must be 3–30 characters (letters, numbers, underscore)'
      using errcode = 'P0001';
  end if;

  if char_length(password) < 8 then
    raise exception 'VALIDATION_ERROR: Temporary password must be at least 8 characters'
      using errcode = 'P0001';
  end if;

  owner_id := t.owner_user_id;

  if owner_id is not null then
    select * into existing_profile from public.profiles where user_id = owner_id;
    if email = '' then
      email := lower(trim(coalesce(existing_profile.email, '')));
    end if;
    if email = '' then
      select lower(trim(coalesce(u.email, ''))) into email from auth.users u where u.id = owner_id;
    end if;
  end if;

  if email = '' or position('@' in email) < 2 then
    raise exception 'VALIDATION_ERROR: Admin email is required to enable login'
      using errcode = 'P0001';
  end if;

  hashed := extensions.crypt(password, extensions.gen_salt('bf'));

  if owner_id is null then
    select id into owner_id from auth.users where lower(email) = email limit 1;

    if owner_id is null then
      owner_id := gen_random_uuid();

      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
      ) values (
        instance,
        owner_id,
        'authenticated',
        'authenticated',
        email,
        hashed,
        now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        '{}'::jsonb,
        now(),
        now(),
        '',
        '',
        '',
        ''
      );

      insert into auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      ) values (
        gen_random_uuid(),
        owner_id,
        jsonb_build_object('sub', owner_id::text, 'email', email, 'email_verified', true),
        'email',
        email,
        now(),
        now(),
        now()
      );
    else
      update auth.users set
        encrypted_password = hashed,
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
      where id = owner_id;

      select exists(
        select 1 from auth.identities where user_id = owner_id and provider = 'email'
      ) into identity_exists;

      if not identity_exists then
        insert into auth.identities (
          id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) values (
          gen_random_uuid(),
          owner_id,
          jsonb_build_object('sub', owner_id::text, 'email', email, 'email_verified', true),
          'email',
          email,
          now(), now(), now()
        );
      end if;
    end if;

    update public.tenants
    set owner_user_id = owner_id, updated_at = now()
    where id = p_tenant_id;
  else
    update auth.users set
      encrypted_password = hashed,
      email = email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
    where id = owner_id;

    select exists(
      select 1 from auth.identities where user_id = owner_id and provider = 'email'
    ) into identity_exists;

    if identity_exists then
      update auth.identities set
        provider_id = email,
        identity_data = coalesce(identity_data, '{}'::jsonb)
          || jsonb_build_object('email', email, 'email_verified', true, 'sub', owner_id::text),
        updated_at = now()
      where user_id = owner_id and provider = 'email';
    else
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        owner_id,
        jsonb_build_object('sub', owner_id::text, 'email', email, 'email_verified', true),
        'email',
        email,
        now(), now(), now()
      );
    end if;
  end if;

  select id into clash_id
  from public.profiles
  where lower(username) = username
    and user_id is distinct from owner_id
  limit 1;
  if clash_id is not null then
    raise exception 'VALIDATION_ERROR: That username is already taken' using errcode = 'P0001';
  end if;

  select id into clash_id
  from public.profiles
  where lower(email) = email
    and user_id is distinct from owner_id
  limit 1;
  if clash_id is not null then
    raise exception 'VALIDATION_ERROR: That email is already used by another profile' using errcode = 'P0001';
  end if;

  select * into existing_profile from public.profiles where user_id = owner_id;
  if found then
    update public.profiles set
      username = username,
      email = email,
      role = 'admin',
      tenant_id = p_tenant_id,
      status = 'active',
      updated_at = now()
    where id = existing_profile.id
    returning id into profile_id;
  else
    insert into public.profiles (
      user_id, tenant_id, first_name, last_name, email, username, status, role
    ) values (
      owner_id, p_tenant_id, 'Tenant', 'Admin', email, username, 'active', 'admin'
    )
    returning id into profile_id;

    insert into public.accounts (
      profile_id, tenant_id, account_number, account_type, account_status, one_time_transfer_used
    ) values (
      profile_id,
      p_tenant_id,
      lpad((floor(random() * 9000000000) + 1000000000)::bigint::text, 10, '0'),
      'escrow',
      'active',
      false
    )
    returning id into account_id;

    insert into public.wallets (account_id, tenant_id, balance, currency)
    values (account_id, p_tenant_id, 0, 'USD');
  end if;

  update public.tenants set
    handoff_admin_username = username,
    handoff_temp_password = password,
    owner_user_id = owner_id,
    updated_at = now()
  where id = p_tenant_id;

  return jsonb_build_object(
    'ownerUserId', owner_id,
    'username', username,
    'email', email,
    'message', 'Admin login enabled. Use this username and password at /admin/login.'
  );
end;
$$;

revoke all on function public.master_provision_tenant_admin(uuid, text, text, text) from public;
grant execute on function public.master_provision_tenant_admin(uuid, text, text, text) to authenticated;
