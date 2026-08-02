-- Supabase-only: RPCs callable by authenticated/anon for session, public tenant config,
-- and elevated master/admin paths. Money mutations still use existing service_role atomics
-- via SECURITY DEFINER wrappers that check auth.uid().

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Session context (replaces GET /api/session)
-- ---------------------------------------------------------------------------
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

  return jsonb_build_object(
    'userId', p.user_id,
    'role', p.role,
    'accountStatus', p.status,
    'email', p.email,
    'username', p.username,
    'firstName', p.first_name,
    'lastName', p.last_name,
    'tenantId', p.tenant_id,
    'isMasterAdmin', public.is_master_admin(uid)
  );
end;
$$;

revoke all on function public.get_my_session() from public;
grant execute on function public.get_my_session() to authenticated;

-- ---------------------------------------------------------------------------
-- Public tenant config by subdomain label (replaces hostname resolver + GET /api/tenant/config)
-- ---------------------------------------------------------------------------
create or replace function public.get_tenant_public_config(p_subdomain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  label text := lower(trim(p_subdomain));
  t public.tenants%rowtype;
  b public.tenant_branding%rowtype;
begin
  if label is null or label = '' or label ~ '[^a-z0-9-]' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into t from public.tenants
  where subdomain = label or slug = label
  limit 1;

  if not found or t.status <> 'active' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into b from public.tenant_branding where tenant_id = t.id;

  return jsonb_build_object(
    'tenantId', t.id,
    'name', t.name,
    'slug', t.slug,
    'status', t.status,
    'subdomain', t.subdomain,
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
      'supportPhone', b.support_phone
    )
  );
end;
$$;

revoke all on function public.get_tenant_public_config(text) from public;
grant execute on function public.get_tenant_public_config(text) to anon, authenticated;

-- Admin fund / profile status / transfers / verification: Edge Functions + service_role
-- (protect_* triggers require auth.role() = service_role).

-- ---------------------------------------------------------------------------
-- Master: require helper
-- ---------------------------------------------------------------------------
create or replace function public.require_master_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_master_admin(uid) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return uid;
end;
$$;

revoke all on function public.require_master_admin() from public;
grant execute on function public.require_master_admin() to authenticated;

create or replace function public.master_list_tenants(
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  off int := greatest(0, coalesce(p_offset, 0));
  total_count int;
  items jsonb;
begin
  perform public.require_master_admin();

  select count(*)::int into total_count from public.tenants;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  into items
  from (
    select
      t.id,
      t.name,
      t.slug,
      t.status,
      t.subdomain,
      t.owner_user_id as "ownerUserId",
      (t.owner_user_id is not null) as "ownerAssigned",
      coalesce(b.application_name, t.name) as "applicationName",
      t.dns_status as "dnsStatus",
      t.ssl_status as "sslStatus",
      t.deployment_status as "deploymentStatus",
      t.created_at as "createdAt",
      t.updated_at as "updatedAt"
    from public.tenants t
    left join public.tenant_branding b on b.tenant_id = t.id
    order by t.created_at desc
    limit lim offset off
  ) x;

  return jsonb_build_object(
    'items', items,
    'limit', lim,
    'offset', off,
    'total', total_count
  );
end;
$$;

revoke all on function public.master_list_tenants(int, int) from public;
grant execute on function public.master_list_tenants(int, int) to authenticated;

create or replace function public.master_get_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
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
      'supportPhone', b.support_phone
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

revoke all on function public.master_get_tenant(uuid) from public;
grant execute on function public.master_get_tenant(uuid) to authenticated;

create or replace function public.master_create_tenant(
  p_name text,
  p_slug text,
  p_subdomain text default null,
  p_owner_user_id uuid default null,
  p_branding jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  slug text := lower(trim(p_slug));
  sub text := lower(trim(coalesce(nullif(p_subdomain, ''), p_slug)));
  t public.tenants%rowtype;
begin
  perform public.require_master_admin();

  if length(trim(p_name)) < 2 then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  insert into public.tenants (name, slug, subdomain, status, owner_user_id)
  values (trim(p_name), slug, sub, 'inactive', p_owner_user_id)
  returning * into t;

  insert into public.tenant_branding (
    tenant_id,
    application_name,
    logo_url,
    favicon_url,
    primary_color,
    secondary_color,
    accent_color,
    login_headline,
    login_subtitle,
    support_email,
    support_phone
  ) values (
    t.id,
    coalesce(p_branding->>'applicationName', trim(p_name)),
    nullif(p_branding->>'logoUrl', ''),
    nullif(p_branding->>'faviconUrl', ''),
    coalesce(p_branding->>'primaryColor', '#0B1F3A'),
    coalesce(p_branding->>'secondaryColor', '#1F6FEB'),
    coalesce(p_branding->>'accentColor', '#C9A227'),
    nullif(p_branding->>'loginHeadline', ''),
    nullif(p_branding->>'loginSubtitle', ''),
    nullif(p_branding->>'supportEmail', ''),
    nullif(p_branding->>'supportPhone', '')
  );

  return public.master_get_tenant(t.id);
end;
$$;

revoke all on function public.master_create_tenant(text, text, text, uuid, jsonb) from public;
grant execute on function public.master_create_tenant(text, text, text, uuid, jsonb) to authenticated;

create or replace function public.master_update_tenant(
  p_tenant_id uuid,
  p_name text default null,
  p_subdomain text default null,
  p_owner_user_id uuid default null,
  p_clear_owner boolean default false,
  p_branding jsonb default null
)
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

  update public.tenants set
    name = coalesce(nullif(trim(p_name), ''), name),
    subdomain = coalesce(nullif(lower(trim(p_subdomain)), ''), subdomain),
    owner_user_id = case
      when p_clear_owner then null
      when p_owner_user_id is not null then p_owner_user_id
      else owner_user_id
    end,
    updated_at = now()
  where id = p_tenant_id;

  if p_branding is not null then
    update public.tenant_branding set
      application_name = coalesce(p_branding->>'applicationName', application_name),
      logo_url = case when p_branding ? 'logoUrl' then nullif(p_branding->>'logoUrl', '') else logo_url end,
      favicon_url = case when p_branding ? 'faviconUrl' then nullif(p_branding->>'faviconUrl', '') else favicon_url end,
      primary_color = coalesce(p_branding->>'primaryColor', primary_color),
      secondary_color = coalesce(p_branding->>'secondaryColor', secondary_color),
      accent_color = coalesce(p_branding->>'accentColor', accent_color),
      login_headline = case when p_branding ? 'loginHeadline' then nullif(p_branding->>'loginHeadline', '') else login_headline end,
      login_subtitle = case when p_branding ? 'loginSubtitle' then nullif(p_branding->>'loginSubtitle', '') else login_subtitle end,
      support_email = case when p_branding ? 'supportEmail' then nullif(p_branding->>'supportEmail', '') else support_email end,
      support_phone = case when p_branding ? 'supportPhone' then nullif(p_branding->>'supportPhone', '') else support_phone end,
      updated_at = now()
    where tenant_id = p_tenant_id;
  end if;

  return public.master_get_tenant(p_tenant_id);
end;
$$;

revoke all on function public.master_update_tenant(uuid, text, text, uuid, boolean, jsonb) from public;
grant execute on function public.master_update_tenant(uuid, text, text, uuid, boolean, jsonb) to authenticated;

create or replace function public.master_set_tenant_status(
  p_tenant_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_master_admin();
  if p_status not in ('active', 'inactive') then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  update public.tenants
  set status = p_status, updated_at = now()
  where id = p_tenant_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return public.master_get_tenant(p_tenant_id);
end;
$$;

revoke all on function public.master_set_tenant_status(uuid, text) from public;
grant execute on function public.master_set_tenant_status(uuid, text) to authenticated;

-- Master deploy status updates (called from Edge Functions with user JWT after Netlify work)
create or replace function public.master_patch_tenant_deployment(
  p_tenant_id uuid,
  p_dns_status text default null,
  p_ssl_status text default null,
  p_deployment_status text default null,
  p_dns_checked_at timestamptz default null,
  p_dns_verified_at timestamptz default null,
  p_ssl_checked_at timestamptz default null,
  p_last_provisioned_at timestamptz default null,
  p_last_provision_error text default null,
  p_clear_provision_error boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_master_admin();

  update public.tenants set
    dns_status = coalesce(p_dns_status, dns_status),
    ssl_status = coalesce(p_ssl_status, ssl_status),
    deployment_status = coalesce(p_deployment_status, deployment_status),
    dns_checked_at = coalesce(p_dns_checked_at, dns_checked_at),
    dns_verified_at = coalesce(p_dns_verified_at, dns_verified_at),
    ssl_checked_at = coalesce(p_ssl_checked_at, ssl_checked_at),
    last_provisioned_at = coalesce(p_last_provisioned_at, last_provisioned_at),
    last_provision_error = case
      when p_clear_provision_error then null
      when p_last_provision_error is not null then p_last_provision_error
      else last_provision_error
    end,
    updated_at = now()
  where id = p_tenant_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return public.master_get_tenant(p_tenant_id);
end;
$$;

revoke all on function public.master_patch_tenant_deployment(uuid, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, boolean) from public;
grant execute on function public.master_patch_tenant_deployment(uuid, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, boolean) to authenticated;
