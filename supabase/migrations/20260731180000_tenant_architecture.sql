-- Phase 1 white-label foundation: tenants, branding, master admins, profile tenant binding.
-- Does not alter transfer/wallet/ledger business rules.

create type public.tenant_status as enum ('active', 'inactive');

-- Deterministic Northline tenant id (first / default application instance).
-- Referenced by application code as NORTHLINE_TENANT_ID.
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status public.tenant_status not null default 'active',
  owner_user_id uuid references auth.users (id) on delete set null,
  subdomain text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tenants_name_check check (char_length(trim(name)) between 2 and 120),
  constraint tenants_slug_check check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  constraint tenants_subdomain_check check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);

create unique index tenants_slug_uidx on public.tenants (slug);
create unique index tenants_subdomain_uidx on public.tenants (subdomain);
create index tenants_status_idx on public.tenants (status);
create index tenants_owner_user_id_idx on public.tenants (owner_user_id);

create trigger set_tenants_updated_at
before update on public.tenants
for each row
execute function public.set_updated_at();

create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  application_name text not null,
  logo_url text,
  favicon_url text,
  primary_color text not null default '#0B3D2E',
  secondary_color text not null default '#1F6F56',
  accent_color text not null default '#C4A35A',
  login_headline text,
  login_subtitle text,
  support_email text,
  support_phone text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tenant_branding_application_name_check
    check (char_length(trim(application_name)) between 2 and 120),
  constraint tenant_branding_primary_color_check
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint tenant_branding_secondary_color_check
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint tenant_branding_accent_color_check
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint tenant_branding_support_email_check
    check (
      support_email is null
      or position('@' in lower(support_email)) > 1
    ),
  constraint tenant_branding_support_phone_check
    check (
      support_phone is null
      or support_phone ~ '^\+?[1-9]\d{7,14}$'
    )
);

create trigger set_tenant_branding_updated_at
before update on public.tenant_branding
for each row
execute function public.set_updated_at();

-- Platform-level privilege distinct from profiles.role (tenant admin / user).
create table public.master_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users (id) on delete set null
);

create or replace function public.is_master_admin(auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.master_admins
    where user_id = auth_user_id
  );
$$;

-- Seed Northline as the first tenant (existing application).
insert into public.tenants (
  id,
  name,
  slug,
  status,
  owner_user_id,
  subdomain
) values (
  'a0000000-0000-4000-8000-000000000001',
  'Northline',
  'northline',
  'active',
  null,
  'northline'
);

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
  'a0000000-0000-4000-8000-000000000001',
  'Northline',
  null,
  null,
  '#0B3D2E',
  '#1F6F56',
  '#C4A35A',
  'Welcome to Northline',
  'Sign in to manage your fictional account.',
  'support@northline.example',
  null
);

-- Bind existing (and future) profiles to a tenant.
alter table public.profiles
  add column if not exists tenant_id uuid references public.tenants (id);

update public.profiles
set tenant_id = 'a0000000-0000-4000-8000-000000000001'
where tenant_id is null;

alter table public.profiles
  alter column tenant_id set default 'a0000000-0000-4000-8000-000000000001';

alter table public.profiles
  alter column tenant_id set not null;

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);
create index if not exists profiles_tenant_role_status_idx
  on public.profiles (tenant_id, role, status);

-- Extend privilege protection: users cannot change tenant membership.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role
      or new.status is distinct from old.status
      or new.user_id is distinct from old.user_id
      or new.email is distinct from old.email
      or new.tenant_id is distinct from old.tenant_id
    then
      if auth.role() <> 'service_role' then
        raise exception 'Changing role, status, user_id, email, or tenant_id is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Keep RLS with-check aligned with protected columns.
drop policy if exists "users_can_update_own_profile_fields" on public.profiles;
create policy "users_can_update_own_profile_fields"
on public.profiles
for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and role = (select p.role from public.profiles p where p.id = profiles.id)
  and status = (select p.status from public.profiles p where p.id = profiles.id)
  and user_id = (select p.user_id from public.profiles p where p.id = profiles.id)
  and email = (select p.email from public.profiles p where p.id = profiles.id)
  and tenant_id = (select p.tenant_id from public.profiles p where p.id = profiles.id)
);

-- Public read of active tenant branding; all writes via service role only.
alter table public.tenants enable row level security;
alter table public.tenant_branding enable row level security;
alter table public.master_admins enable row level security;

create policy "anyone_authenticated_can_read_active_tenants"
on public.tenants
for select
using (status = 'active' or public.is_master_admin(auth.uid()));

create policy "anyone_authenticated_can_read_active_tenant_branding"
on public.tenant_branding
for select
using (
  exists (
    select 1
    from public.tenants t
    where t.id = tenant_branding.tenant_id
      and (t.status = 'active' or public.is_master_admin(auth.uid()))
  )
);

-- master_admins: no client reads/writes; service role bypasses RLS.
-- Intentionally no policies for authenticated/anon writes.

revoke insert, update, delete on public.tenants from anon, authenticated;
revoke insert, update, delete on public.tenant_branding from anon, authenticated;
revoke all on public.master_admins from anon, authenticated;

grant select on public.tenants to authenticated, anon;
grant select on public.tenant_branding to authenticated, anon;
-- master_admins: no grants to anon/authenticated
