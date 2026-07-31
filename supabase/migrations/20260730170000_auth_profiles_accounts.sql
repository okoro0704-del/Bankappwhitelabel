-- Evolve the Prompt 1 foundation into authenticated profiles + application accounts.
-- Safe for early environments: replaces placeholder user_profiles/wallets structures.

create type public.account_status as enum ('active', 'suspended');

-- Remove Prompt 1 placeholder tables (no production data expected at this stage).
drop policy if exists "users_can_select_own_wallets" on public.wallets;
drop policy if exists "users_can_insert_own_wallets" on public.wallets;
drop policy if exists "users_can_update_own_wallets" on public.wallets;
drop table if exists public.wallets cascade;

drop policy if exists "users_can_select_own_profile" on public.user_profiles;
drop policy if exists "users_can_insert_own_profile" on public.user_profiles;
drop policy if exists "users_can_update_own_profile" on public.user_profiles;
drop table if exists public.user_profiles cascade;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role public.app_role not null default 'user',
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  username text not null unique,
  status public.account_status not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_email_check check (position('@' in lower(email)) > 1),
  constraint profiles_username_check check (username ~ '^[a-z0-9_]{3,30}$'),
  constraint profiles_phone_check check (
    phone is null or phone ~ '^\+?[1-9]\d{7,14}$'
  )
);

create index profiles_user_id_idx on public.profiles (user_id);
create index profiles_role_status_idx on public.profiles (role, status);
create index profiles_username_idx on public.profiles (username);
create index profiles_email_idx on public.profiles (email);

create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  account_number text not null unique,
  account_type public.account_type not null,
  account_status public.account_status not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint accounts_account_number_check check (account_number ~ '^\d{10}$')
);

create index accounts_profile_id_idx on public.accounts (profile_id);
create index accounts_number_idx on public.accounts (account_number);
create index accounts_type_status_idx on public.accounts (account_type, account_status);

create trigger set_accounts_updated_at
before update on public.accounts
for each row
execute function public.set_updated_at();

-- Cryptographically random 10-digit fictional account numbers (server/DB only).
create or replace function public.generate_account_number()
returns text
language plpgsql
as $$
declare
  candidate text;
  attempts integer := 0;
  raw bytea;
  n numeric;
begin
  loop
    attempts := attempts + 1;
    raw := gen_random_bytes(8);
    n := get_byte(raw, 0)::numeric;
    n := n * 256 + get_byte(raw, 1);
    n := n * 256 + get_byte(raw, 2);
    n := n * 256 + get_byte(raw, 3);
    n := n * 256 + get_byte(raw, 4);
    n := n * 256 + get_byte(raw, 5);
    candidate := lpad(((n % 9000000000) + 1000000000)::bigint::text, 10, '0');

    exit when not exists (
      select 1 from public.accounts where account_number = candidate
    );

    if attempts >= 25 then
      raise exception 'Unable to generate a unique account number';
    end if;
  end loop;

  return candidate;
end;
$$;

create or replace function public.is_admin(auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth_user_id
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.is_active_account(auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    join public.accounts on accounts.profile_id = profiles.id
    where profiles.user_id = auth_user_id
      and profiles.status = 'active'
      and accounts.account_status = 'active'
  );
$$;

-- Prevent non-service-role callers from elevating privileges or mutating protected fields.
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
    then
      if auth.role() <> 'service_role' then
        raise exception 'Changing role, status, user_id, or email is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_profile_privileges
before update on public.profiles
for each row
execute function public.protect_profile_privileges();

create or replace function public.protect_account_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.account_type is distinct from old.account_type
      or new.account_number is distinct from old.account_number
      or new.account_status is distinct from old.account_status
      or new.profile_id is distinct from old.profile_id
    then
      if auth.role() <> 'service_role' then
        raise exception 'Changing account type, number, status, or ownership is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_account_privileges
before update on public.accounts
for each row
execute function public.protect_account_privileges();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;

-- Profiles: users read/update own permitted fields; inserts only via service role.
create policy "users_can_read_own_profile"
on public.profiles
for select
using (auth.uid() = user_id);

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
);

create policy "admins_can_read_profiles"
on public.profiles
for select
using (public.is_admin(auth.uid()));

-- Accounts: users may only read their own account; mutations via service role.
create policy "users_can_read_own_account"
on public.accounts
for select
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = accounts.profile_id
      and profiles.user_id = auth.uid()
  )
);

create policy "admins_can_read_accounts"
on public.accounts
for select
using (public.is_admin(auth.uid()));

revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.accounts from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.accounts to authenticated;
grant update (first_name, last_name, phone, username) on public.profiles to authenticated;
