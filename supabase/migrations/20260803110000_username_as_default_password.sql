-- When no temporary password is set, the username is the password.
-- Admins can also reset Auth login to match the username.

create or replace function public.admin_reset_password_to_username(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
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

  hashed := extensions.crypt(target.username, extensions.gen_salt('bf'));

  update auth.users
  set encrypted_password = hashed, updated_at = now()
  where id = target.user_id;

  update public.profiles
  set handoff_temp_password = target.username, updated_at = now()
  where id = target.id
  returning * into target;

  return jsonb_build_object(
    'id', target.id,
    'username', target.username,
    'temporaryPassword', target.username,
    'handoffTempPassword', target.handoff_temp_password,
    'message', 'Login password set to the username'
  );
end;
$$;

revoke all on function public.admin_reset_password_to_username(uuid) from public;
grant execute on function public.admin_reset_password_to_username(uuid) to authenticated;

-- Master: empty password → use username (same body as 20260803050000 with that default).
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
  identity_exists boolean := false;
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

  if nullif(trim(v_password), '') is null then
    v_password := v_username;
  end if;

  if char_length(v_password) < 3 then
    raise exception 'VALIDATION_ERROR: Temporary password must be at least 3 characters'
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
        v_email,
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
        jsonb_build_object('sub', owner_id::text, 'email', v_email, 'email_verified', true),
        'email',
        v_email,
        now(),
        now(),
        now()
      );
    else
      update auth.users u set
        encrypted_password = hashed,
        email_confirmed_at = coalesce(u.email_confirmed_at, now()),
        updated_at = now()
      where u.id = owner_id;

      select exists(
        select 1 from auth.identities i where i.user_id = owner_id and i.provider = 'email'
      ) into identity_exists;

      if not identity_exists then
        insert into auth.identities (
          id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
        ) values (
          gen_random_uuid(),
          owner_id,
          jsonb_build_object('sub', owner_id::text, 'email', v_email, 'email_verified', true),
          'email',
          v_email,
          now(), now(), now()
        );
      end if;
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

    select exists(
      select 1 from auth.identities i where i.user_id = owner_id and i.provider = 'email'
    ) into identity_exists;

    if identity_exists then
      update auth.identities i set
        provider_id = v_email,
        identity_data = coalesce(i.identity_data, '{}'::jsonb)
          || jsonb_build_object('email', v_email, 'email_verified', true, 'sub', owner_id::text),
        updated_at = now()
      where i.user_id = owner_id and i.provider = 'email';
    else
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(),
        owner_id,
        jsonb_build_object('sub', owner_id::text, 'email', v_email, 'email_verified', true),
        'email',
        v_email,
        now(), now(), now()
      );
    end if;
  end if;

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
    'message', 'Admin login enabled. Use this username and password at /admin/login.'
  );
end;
$$;

revoke all on function public.master_provision_tenant_admin(uuid, text, text, text) from public;
grant execute on function public.master_provision_tenant_admin(uuid, text, text, text) to authenticated;
