create extension if not exists "pgcrypto";

create type public.app_role as enum ('admin', 'user');
create type public.account_type as enum (
  'escrow',
  'one_time_transfer',
  'four_stage_verification'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists user_profiles_role_id_idx
  on public.user_profiles (role, id);

create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

create policy "users_can_select_own_profile"
on public.user_profiles
for select
using (auth.uid() = id);

create policy "users_can_insert_own_profile"
on public.user_profiles
for insert
with check (auth.uid() = id);

create policy "users_can_update_own_profile"
on public.user_profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.user_profiles (id) on delete cascade,
  account_type public.account_type not null,
  balance numeric(18,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists wallets_owner_user_id_idx
  on public.wallets (owner_user_id);

create unique index if not exists wallets_owner_account_type_idx
  on public.wallets (owner_user_id, account_type);

create trigger set_wallets_updated_at
before update on public.wallets
for each row
execute function public.set_updated_at();

alter table public.wallets enable row level security;

create policy "users_can_select_own_wallets"
on public.wallets
for select
using (auth.uid() = owner_user_id);

create policy "users_can_insert_own_wallets"
on public.wallets
for insert
with check (auth.uid() = owner_user_id);

create policy "users_can_update_own_wallets"
on public.wallets
for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);
