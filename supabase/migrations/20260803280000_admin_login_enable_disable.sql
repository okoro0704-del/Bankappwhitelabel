-- Persistent tenant admin login enable/disable + repair Auth password sync from handoff.

alter table public.tenants
  add column if not exists admin_login_enabled boolean not null default false;

comment on column public.tenants.admin_login_enabled is
  'When true, tenant admin may sign in at /admin/login. Only Enable/Disable toggles this; other app updates must not clear it.';

-- Existing tenants that already have an owner + admin username were effectively enabled.
update public.tenants
set admin_login_enabled = true
where owner_user_id is not null
  and nullif(trim(coalesce(handoff_admin_username, '')), '') is not null
  and admin_login_enabled = false;

-- Re-sync Auth passwords to match stored admin handoff passwords (common login failure cause).
do $$
declare
  r record;
  hashed text;
begin
  for r in
    select
      t.id as tenant_id,
      t.owner_user_id,
      t.handoff_temp_password,
      coalesce(p.email, u.email) as email
    from public.tenants t
    join auth.users u on u.id = t.owner_user_id
    left join public.profiles p on p.user_id = t.owner_user_id
    where t.admin_login_enabled = true
      and nullif(trim(coalesce(t.handoff_temp_password, '')), '') is not null
  loop
    hashed := extensions.crypt(trim(r.handoff_temp_password), extensions.gen_salt('bf'));
    update auth.users
    set
      encrypted_password = hashed,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
    where id = r.owner_user_id;

    if r.email is not null and position('@' in r.email) > 1 then
      perform public.ensure_email_identity(r.owner_user_id, lower(trim(r.email)));
    end if;

    update public.profiles
    set
      handoff_temp_password = trim(r.handoff_temp_password),
      role = 'admin',
      status = 'active',
      updated_at = now()
    where user_id = r.owner_user_id;
  end loop;
end;
$$;

create or replace function public.master_get_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tenants%rowtype;
  b public.tenant_branding%rowtype;
begin
  perform public.require_master_admin();

  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into b from public.tenant_branding where tenant_id = t.id;

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'slug', t.slug,
      'status', t.status,
      'ownerUserId', t.owner_user_id,
      'subdomain', t.subdomain,
      'handoffTempPassword', t.handoff_temp_password,
      'handoffAdminUsername', t.handoff_admin_username,
      'adminLoginEnabled', t.admin_login_enabled,
      'createdAt', t.created_at,
      'updatedAt', t.updated_at
    ),
    'branding', jsonb_build_object(
      'applicationName', coalesce(b.application_name, t.name),
      'logoUrl', b.logo_url,
      'faviconUrl', b.favicon_url,
      'primaryColor', coalesce(b.primary_color, '#0B1F3A'),
      'secondaryColor', coalesce(b.secondary_color, '#1F6FEB'),
      'accentColor', coalesce(b.accent_color, '#C9A227'),
      'loginHeadline', b.login_headline,
      'loginSubtitle', b.login_subtitle,
      'supportEmail', b.support_email,
      'supportPhone', b.support_phone,
      'homeContent', coalesce(
        nullif(b.home_content, '{}'::jsonb),
        public.default_home_content(coalesce(b.application_name, t.name))
      )
    ),
    'deploymentRaw', jsonb_build_object(
      'dnsStatus', t.dns_status,
      'sslStatus', t.ssl_status,
      'deploymentStatus', t.deployment_status,
      'dnsCheckedAt', t.dns_checked_at,
      'dnsVerifiedAt', t.dns_verified_at,
      'lastProvisionedAt', t.last_provisioned_at,
      'sslCheckedAt', t.ssl_checked_at,
      'lastProvisionError', t.last_provision_error,
      'ownerAssigned', t.owner_user_id is not null,
      'subdomain', t.subdomain
    )
  );
end;
$$;

-- Enable (or re-sync) admin login — always sets admin_login_enabled = true.
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

  if v_password is null then
    v_password := nullif(trim(coalesce(t.handoff_temp_password, '')), '');
  end if;

  if v_password is null then
    raise exception 'VALIDATION_ERROR: Temporary password is required for admin login'
      using errcode = 'P0001';
  end if;

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
    admin_login_enabled = true,
    updated_at = now()
  where id = p_tenant_id;

  return jsonb_build_object(
    'ownerUserId', owner_id,
    'username', v_username,
    'email', v_email,
    'temporaryPassword', v_password,
    'adminLoginEnabled', true,
    'message', format(
      'Admin login enabled. Sign in at /admin/login with username %s and the temporary password.',
      v_username
    )
  );
end;
$$;

revoke all on function public.master_provision_tenant_admin(uuid, text, text, text) from public;
grant execute on function public.master_provision_tenant_admin(uuid, text, text, text) to authenticated;

create or replace function public.master_disable_tenant_admin_login(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tenants%rowtype;
begin
  perform public.require_master_admin();

  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.tenants
  set
    admin_login_enabled = false,
    updated_at = now()
  where id = p_tenant_id;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'adminLoginEnabled', false,
    'message', 'Admin login disabled. /admin/login will reject this tenant admin until Enable is used again.'
  );
end;
$$;

revoke all on function public.master_disable_tenant_admin_login(uuid) from public;
grant execute on function public.master_disable_tenant_admin_login(uuid) to authenticated;

create or replace function public.get_my_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  v_enabled boolean;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into p from public.profiles where user_id = uid;
  if not found then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if p.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;

  if p.role = 'admin' and p.tenant_id is not null then
    select coalesce(t.admin_login_enabled, false) into v_enabled
    from public.tenants t
    where t.id = p.tenant_id;
    if not coalesce(v_enabled, false) then
      raise exception 'ADMIN_LOGIN_DISABLED' using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'userId', p.user_id,
    'role', p.role,
    'accountStatus', p.status,
    'email', p.email,
    'username', p.username,
    'firstName', p.first_name,
    'lastName', p.last_name,
    'tenantId', p.tenant_id,
    'avatarUrl', p.avatar_url,
    'isMasterAdmin', public.is_master_admin(uid)
  );
end;
$$;

revoke all on function public.get_my_session() from public;
grant execute on function public.get_my_session() to authenticated;

notify pgrst, 'reload schema';
