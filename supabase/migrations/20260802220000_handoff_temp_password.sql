-- Handoff deliverables: temporary password for tenant admin (Master-only via RPC).
-- Also refresh master_get_tenant / master_update_tenant to expose/save it.

alter table public.tenants
  add column if not exists handoff_temp_password text;

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

drop function if exists public.master_update_tenant(uuid, text, text, uuid, boolean, jsonb);

create or replace function public.master_update_tenant(
  p_tenant_id uuid,
  p_name text default null,
  p_subdomain text default null,
  p_owner_user_id uuid default null,
  p_clear_owner boolean default false,
  p_branding jsonb default null,
  p_handoff_temp_password text default null,
  p_clear_handoff_temp_password boolean default false
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
    handoff_temp_password = case
      when p_clear_handoff_temp_password then null
      when p_handoff_temp_password is not null then p_handoff_temp_password
      else handoff_temp_password
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

revoke all on function public.master_update_tenant(uuid, text, text, uuid, boolean, jsonb, text, boolean) from public;
grant execute on function public.master_update_tenant(uuid, text, text, uuid, boolean, jsonb, text, boolean) to authenticated;

-- Clear dns_verified_at when DNS is no longer verified (coalesce alone cannot clear).
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
    dns_status = coalesce(p_dns_status::public.tenant_dns_status, dns_status),
    ssl_status = coalesce(p_ssl_status::public.tenant_ssl_status, ssl_status),
    deployment_status = coalesce(
      p_deployment_status::public.tenant_deployment_status,
      deployment_status
    ),
    dns_checked_at = coalesce(p_dns_checked_at, dns_checked_at),
    dns_verified_at = case
      when p_dns_status is not null and p_dns_status <> 'verified' then null
      else coalesce(p_dns_verified_at, dns_verified_at)
    end,
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
