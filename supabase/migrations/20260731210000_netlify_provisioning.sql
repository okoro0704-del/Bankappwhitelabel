-- Phase 7: Netlify provisioning metadata (backwards-compatible)
-- Does not change financial tables, RLS isolation, or transfer rules.

alter table public.tenants
  add column if not exists last_provisioned_at timestamptz,
  add column if not exists ssl_checked_at timestamptz,
  add column if not exists last_provision_error text;

comment on column public.tenants.last_provisioned_at is
  'Last Master provisioning attempt timestamp (Netlify or manual verify).';
comment on column public.tenants.ssl_checked_at is
  'Last SSL verification attempt timestamp.';
comment on column public.tenants.last_provision_error is
  'Safe, non-secret human-readable last provisioning/verification error.';
