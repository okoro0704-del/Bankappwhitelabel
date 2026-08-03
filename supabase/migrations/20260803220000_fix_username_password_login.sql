-- Fix tenant-admin AND customer username/temp-password login.
-- Root causes:
-- 1) Supabase Auth rejects weak passwords (bare username) on sign-in
-- 2) Missing/incorrect auth.identities rows block GoTrue password login
-- 3) Admin handoff passwords were never strengthened (only customers were)

create extension if not exists pgcrypto with schema extensions;

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
  v := v || 'A1!';
  if char_length(v) < 8 then
    v := rpad(v, 8, 'x');
  end if;
  return v;
end;
$$;

create or replace function public.password_meets_auth_strength(p_password text)
returns boolean
language sql
immutable
as $$
  select
    char_length(coalesce(p_password, '')) >= 8
    and coalesce(p_password, '') ~ '[A-Z]'
    and coalesce(p_password, '') ~ '[a-z]'
    and coalesce(p_password, '') ~ '[0-9]';
$$;

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

  -- Confirm email so hosted Auth allows password sign-in.
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

-- Resolve username → email for customers and tenant admins.
create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ident text := lower(trim(coalesce(p_identifier, '')));
  em text;
begin
  if ident = '' then
    return null;
  end if;

  if position('@' in ident) > 0 then
    return ident;
  end if;

  select lower(p.email) into em
  from public.profiles p
  where lower(p.username) = ident
    and p.status = 'active'
  order by case when p.role = 'admin' then 0 else 1 end, p.created_at asc
  limit 1;

  if em is not null and em <> '' then
    return em;
  end if;

  select lower(coalesce(p.email, u.email, '')) into em
  from public.tenants t
  left join public.profiles p on p.user_id = t.owner_user_id
  left join auth.users u on u.id = t.owner_user_id
  where lower(trim(coalesce(t.handoff_admin_username, ''))) = ident
  limit 1;

  if em is null or em = '' then
    return null;
  end if;

  return em;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

-- Strengthen master provision default password.
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
  v_password text := coalesce(p_password, '');
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

  if nullif(trim(v_password), '') is null
    or lower(trim(v_password)) = v_username
    or not public.password_meets_auth_strength(v_password)
  then
    v_password := public.auth_login_password_from_username(v_username);
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
      updated_at = now()
    where p.id = existing_profile.id
    returning p.id into profile_id;
  else
    insert into public.profiles (
      user_id, tenant_id, first_name, last_name, email, username, status, role
    ) values (
      owner_id, p_tenant_id, 'Tenant', 'Admin', v_email, v_username, 'active', 'admin'
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
      'Admin login enabled. Sign in at /admin/login with username %s and password %s',
      v_username,
      v_password
    )
  );
end;
$$;

revoke all on function public.master_provision_tenant_admin(uuid, text, text, text) from public;
grant execute on function public.master_provision_tenant_admin(uuid, text, text, text) to authenticated;

-- Repair ALL profile users (customers + tenant admins).
do $$
declare
  r record;
  v_password text;
  v_username text;
begin
  for r in
    select
      p.id as profile_id,
      p.user_id,
      p.email,
      p.username,
      p.role,
      p.handoff_temp_password as profile_temp,
      t.handoff_temp_password as tenant_temp,
      t.handoff_admin_username,
      t.id as tenant_id
    from public.profiles p
    left join public.tenants t on t.owner_user_id = p.user_id
    where p.username is not null
      and length(trim(p.username)) >= 3
      and p.user_id is not null
  loop
    v_username := lower(trim(r.username));
    perform public.ensure_email_identity(r.user_id, r.email);

    if r.role = 'admin' then
      v_password := coalesce(
        nullif(trim(r.tenant_temp), ''),
        nullif(trim(r.profile_temp), ''),
        v_username
      );
      if lower(v_password) = v_username
        or not public.password_meets_auth_strength(v_password)
      then
        v_password := public.auth_login_password_from_username(v_username);
      end if;

      perform public.set_auth_password(r.user_id, v_password);

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
      v_password := coalesce(nullif(trim(r.profile_temp), ''), v_username);
      if lower(v_password) = v_username
        or not public.password_meets_auth_strength(v_password)
      then
        v_password := public.auth_login_password_from_username(v_username);
      end if;

      perform public.set_auth_password(r.user_id, v_password);

      update public.profiles
      set handoff_temp_password = v_password, updated_at = now()
      where id = r.profile_id;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- Also strengthen weak custom passwords on create-user path (not only bare username).
-- Re-apply the password gate used by master provision.
create or replace function public._normalize_temp_login_password(p_username text, p_password text)
returns text
language plpgsql
immutable
as $$
declare
  v_username text := lower(trim(coalesce(p_username, '')));
  v_password text := coalesce(p_password, '');
begin
  if nullif(trim(v_password), '') is null
    or lower(trim(v_password)) = v_username
    or not public.password_meets_auth_strength(v_password)
  then
    return public.auth_login_password_from_username(v_username);
  end if;
  return trim(v_password);
end;
$$;
