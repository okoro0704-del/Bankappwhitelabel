-- Fix master_patch_tenant_deployment: cast text args to enum columns (COALESCE type mismatch).

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
