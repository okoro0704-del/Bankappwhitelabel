-- Tenant Home marketing content (admin-editable deliverable for the public landing page).

alter table public.tenant_branding
  add column if not exists home_content jsonb not null default '{}'::jsonb;

comment on column public.tenant_branding.home_content is
  'Public Home page marketing copy edited by tenant admins. Exposed via get_tenant_public_config.';

create or replace function public.default_home_content(p_name text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_name is null then
    v_name := 'Our bank';
  end if;

  return jsonb_build_object(
    'topBarHours', 'M–Th 9:00 – 5:30 · Fri 9:00 – 6:00',
    'tagline', 'Personal & business banking built for everyday goals',
    'heroHeadline', 'Banking that grows with you',
    'heroSupport', 'From helping your community to traveling with perks, discover accounts and cards built for your financial life — with clear balances, secure transfers, and tools that move you forward.',
    'navHome', 'Home',
    'navAbout', 'About',
    'navBanking', 'Banking',
    'navLoans', 'Loans',
    'navInvesting', 'Investing',
    'navCards', 'Credit Cards',
    'navContact', 'Contact',
    'bankingTitle', 'Credit Cards',
    'bankingLead', 'From helping out your community to traveling with perks, we have the credit card built for your financial life.',
    'bankingBody', 'Discover options that let you earn extra rewards points and cash back — all with a great, low rate. Your credit card can be a great way to set up smart financial habits and build credit toward big financial goals, like buying a home or a new vehicle.',
    'bankingSecondary', 'Opening your credit card is just the beginning. Whatever goal you’re trying to achieve — from building credit to paying for your next trip with great perks — our team will connect you with the tools that work best for your lifestyle, and help you plan what’s next.',
    'philosophyTitle', 'We are efficient to make your business rise',
    'philosophyLead', 'Productivity yields growth and money.',
    'philosophyBody', 'We ensure nothing but productivity with your money when you bank with us. Our bank has helped a lot of businesses grow. Be the next.',
    'philosophyHighlight', 'Proven results say it all. Strong outcomes on investment and interest plans. Liquidity and capital accumulation through financial investing is a sound fortress.',
    'whyTitle', 'Best reason',
    'whySubtitle', 'Why choose us',
    'visionTitle', 'Our company vision',
    'visionBody', 'Our vision is to be the undisputed leading and dominant financial services institution globally. Policies and procedural guidelines have been set up by the Bank and are regularly reviewed and revised to ensure they remain relevant, current, and in line with evolving regulatory requirements and leading practices.',
    'missionTitle', 'Our company mission',
    'missionBody', 'We deliver reliable banking, clear guidance, and practical products so individuals and businesses can build credit, grow capital, and move confidently toward their next milestone.',
    'philosophySectionTitle', 'Our philosophy',
    'philosophySectionBody', 'Security, branding excellence, trusted consulting, and business partnership — measured by results, not slogans. We combine disciplined risk practice with a human approach to every account.',
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Security', 'percent', 100),
      jsonb_build_object('label', 'Branding', 'percent', 75),
      jsonb_build_object('label', 'Consulting', 'percent', 90),
      jsonb_build_object('label', 'Business', 'percent', 75)
    ),
    'aboutTitle', 'About us',
    'aboutBody', v_name || ' serves personal and business customers with accounts, transfers, cards, and investment guidance. We focus on clarity, security, and long-term relationships.',
    'hoursOnline', '24 hours · 7 days',
    'hoursSupport', 'Monday–Thursday · 9:00–17:30 · Friday · 9:00–18:00',
    'hoursBranch', 'Monday–Friday · 9:00–16:00',
    'hoursSaturday', 'Support desk · 9:00–13:00',
    'headOfficeTitle', 'Head office',
    'headOfficeAddress', '3367 NW 9th St, Corvallis, OR 97330, USA',
    'footerMission', 'Our Mission',
    'footerBorrowing', 'Borrowing',
    'footerInvestments', 'Investments',
    'footerContact', 'Contact us',
    'footerPolicy', 'Policy',
    'footerTerms', 'Our Terms',
    'footerLogin', 'Login',
    'footerNewAccounts', 'New Accounts',
    'copyrightNote', '© All rights reserved'
  );
end;
$$;

update public.tenant_branding b
set home_content = public.default_home_content(coalesce(b.application_name, t.name))
from public.tenants t
where t.id = b.tenant_id
  and (b.home_content is null or b.home_content = '{}'::jsonb);

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
  v_home jsonb;
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

  v_home := coalesce(
    nullif(b.home_content, '{}'::jsonb),
    public.default_home_content(coalesce(b.application_name, t.name))
  );

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
      'supportPhone', b.support_phone,
      'homeContent', v_home
    )
  );
end;
$$;

revoke all on function public.get_tenant_public_config(text) from public;
grant execute on function public.get_tenant_public_config(text) to anon, authenticated;

create or replace function public.admin_get_home_content()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor public.profiles%rowtype;
  b public.tenant_branding%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor
  from public.profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found or actor.tenant_id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into b from public.tenant_branding where tenant_id = actor.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'applicationName', b.application_name,
    'supportEmail', b.support_email,
    'supportPhone', b.support_phone,
    'homeContent', coalesce(
      nullif(b.home_content, '{}'::jsonb),
      public.default_home_content(b.application_name)
    )
  );
end;
$$;

revoke all on function public.admin_get_home_content() from public;
grant execute on function public.admin_get_home_content() to authenticated;

create or replace function public.admin_update_home_content(p_home jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.profiles%rowtype;
  b public.tenant_branding%rowtype;
  v_home jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_home is null or jsonb_typeof(p_home) <> 'object' then
    raise exception 'VALIDATION_ERROR: Home content is required' using errcode = 'P0001';
  end if;

  select * into actor
  from public.profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found or actor.tenant_id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into b from public.tenant_branding where tenant_id = actor.tenant_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_home := coalesce(nullif(b.home_content, '{}'::jsonb), public.default_home_content(b.application_name))
    || p_home;

  update public.tenant_branding
  set
    home_content = v_home,
    updated_at = timezone('utc', now())
  where tenant_id = actor.tenant_id
  returning * into b;

  return jsonb_build_object(
    'applicationName', b.application_name,
    'supportEmail', b.support_email,
    'supportPhone', b.support_phone,
    'homeContent', b.home_content,
    'message', 'Home deliverables saved'
  );
end;
$$;

revoke all on function public.admin_update_home_content(jsonb) from public;
grant execute on function public.admin_update_home_content(jsonb) to authenticated;

-- Also allow tenant admins to update support contact shown on Home.
create or replace function public.admin_update_home_support(
  p_support_email text default null,
  p_support_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.profiles%rowtype;
  b public.tenant_branding%rowtype;
  v_email text := nullif(trim(coalesce(p_support_email, '')), '');
  v_phone text := nullif(trim(coalesce(p_support_phone, '')), '');
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor
  from public.profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found or actor.tenant_id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_email is not null and position('@' in v_email) < 2 then
    raise exception 'VALIDATION_ERROR: Enter a valid support email' using errcode = 'P0001';
  end if;

  update public.tenant_branding
  set
    support_email = case when p_support_email is null then support_email else v_email end,
    support_phone = case when p_support_phone is null then support_phone else v_phone end,
    updated_at = timezone('utc', now())
  where tenant_id = actor.tenant_id
  returning * into b;

  return jsonb_build_object(
    'supportEmail', b.support_email,
    'supportPhone', b.support_phone,
    'message', 'Home contact details saved'
  );
end;
$$;

revoke all on function public.admin_update_home_support(text, text) from public;
grant execute on function public.admin_update_home_support(text, text) to authenticated;

notify pgrst, 'reload schema';
