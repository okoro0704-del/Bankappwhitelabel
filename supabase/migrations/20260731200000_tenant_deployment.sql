-- Phase 5: tenant deployment / DNS / SSL provisioning metadata
-- Does not change financial tables, RLS isolation, or transfer rules.

create type public.tenant_dns_status as enum (
  'not_configured',
  'pending',
  'verified',
  'failed'
);

create type public.tenant_ssl_status as enum (
  'not_configured',
  'pending',
  'verified',
  'failed'
);

create type public.tenant_deployment_status as enum (
  'not_configured',
  'waiting_for_dns',
  'dns_configured',
  'ssl_pending',
  'ready'
);

alter table public.tenants
  add column if not exists dns_status public.tenant_dns_status not null default 'not_configured',
  add column if not exists ssl_status public.tenant_ssl_status not null default 'not_configured',
  add column if not exists deployment_status public.tenant_deployment_status not null default 'not_configured',
  add column if not exists dns_checked_at timestamptz,
  add column if not exists dns_verified_at timestamptz;

-- Existing seeded Northline remains active; new tenants should start inactive (app default).
-- Backfill deployment status for rows that already have a subdomain label.
update public.tenants
set
  dns_status = 'pending',
  deployment_status = 'waiting_for_dns'
where subdomain is not null
  and trim(subdomain) <> ''
  and dns_status = 'not_configured';

create index if not exists tenants_dns_status_idx on public.tenants (dns_status);
create index if not exists tenants_deployment_status_idx on public.tenants (deployment_status);
