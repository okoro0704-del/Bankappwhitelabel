-- Apply CIT Bank logo + brand colors to CIT tenants.
-- Logo file is served from the SPA: /cit-bank-logo.png

update public.tenant_branding b
set
  application_name = coalesce(nullif(b.application_name, ''), t.name, 'CIT Bank'),
  logo_url = '/cit-bank-logo.png',
  favicon_url = coalesce(b.favicon_url, '/cit-bank-logo.png'),
  primary_color = '#004B50',
  secondary_color = '#0A6B72',
  accent_color = '#C9A227',
  login_headline = coalesce(b.login_headline, 'Banking built around you'),
  login_subtitle = coalesce(
    b.login_subtitle,
    'Sign in securely to your CIT Bank accounts, transfers, and statements.'
  ),
  updated_at = now()
from public.tenants t
where b.tenant_id = t.id
  and (
    lower(t.subdomain) like '%cit%'
    or lower(t.slug) like '%cit%'
    or lower(t.name) like '%cit%'
  );
