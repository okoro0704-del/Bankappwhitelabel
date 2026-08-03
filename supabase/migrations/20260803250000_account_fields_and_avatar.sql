-- Account fields: currency (wallet), country, routing number
-- Profile: avatar_url + storage bucket for customer photos
-- Create-user accepts the new account fields
-- Session includes avatarUrl

alter table public.accounts
  add column if not exists account_country text,
  add column if not exists routing_number text;

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.accounts.account_country is
  'ISO country / display country for the account (set at create).';
comment on column public.accounts.routing_number is
  'Bank routing / sort code for the account (set at create).';
comment on column public.profiles.avatar_url is
  'Public URL of the customer profile photo.';

-- Storage bucket for avatars (public read; owner write).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_upload" on storage.objects;
create policy "avatars_owner_upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

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
    'avatarUrl', p.avatar_url,
    'isMasterAdmin', public.is_master_admin(uid)
  );
end;
$$;

revoke all on function public.get_my_session() from public;
grant execute on function public.get_my_session() to authenticated;

create or replace function public.user_set_avatar_url(p_avatar_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p public.profiles%rowtype;
  v_url text := nullif(trim(coalesce(p_avatar_url, '')), '');
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if v_url is not null and char_length(v_url) > 2000 then
    raise exception 'VALIDATION_ERROR: Avatar URL is too long' using errcode = 'P0001';
  end if;

  update public.profiles
  set avatar_url = v_url, updated_at = timezone('utc', now())
  where user_id = uid
  returning * into p;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', p.id,
    'avatarUrl', p.avatar_url
  );
end;
$$;

revoke all on function public.user_set_avatar_url(text) from public;
grant execute on function public.user_set_avatar_url(text) to authenticated;

drop function if exists public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric
);
drop function if exists public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text
);
drop function if exists public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text, text, text, text
);

create or replace function public.admin_create_tenant_user(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_username text,
  p_password text default null,
  p_phone text default null,
  p_account_type text default 'escrow',
  p_account_number text default null,
  p_initial_balance numeric default 0,
  p_product_type text default 'checking',
  p_currency text default 'USD',
  p_account_country text default null,
  p_routing_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_account_number text := nullif(trim(coalesce(p_account_number, '')), '');
  v_account_type text := lower(trim(coalesce(p_account_type, 'escrow')));
  v_product_type text := lower(trim(coalesce(p_product_type, 'checking')));
  v_balance numeric(18, 2) := coalesce(p_initial_balance, 0);
  v_password text := nullif(trim(coalesce(p_password, '')), '');
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
  v_country text := nullif(trim(coalesce(p_account_country, '')), '');
  v_routing text := nullif(trim(coalesce(p_routing_number, '')), '');
  v_pin constant text := '1111';
  v_activation text[];
  hashed text;
  new_user_id uuid;
  profile_row public.profiles%rowtype;
  account_row public.accounts%rowtype;
  wallet_row public.wallets%rowtype;
  fund_ref text;
  instance uuid := '00000000-0000-0000-0000-000000000000';
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor from public.profiles where user_id = auth.uid();
  if not found or actor.status <> 'active' or actor.tenant_id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_first = '' or v_last = '' then
    raise exception 'VALIDATION_ERROR: First and last name are required' using errcode = 'P0001';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'VALIDATION_ERROR: A valid email is required' using errcode = 'P0001';
  end if;
  v_username := regexp_replace(v_username, '[^a-z0-9_]', '_', 'g');
  if v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Username must be 3–30 characters (letters, numbers, underscore)'
      using errcode = 'P0001';
  end if;
  if v_account_type = 'unlimited' then
    v_account_type := 'escrow';
  end if;
  if v_account_type not in ('escrow', 'one_time_transfer', 'four_stage_verification') then
    raise exception 'VALIDATION_ERROR: Invalid account behavior' using errcode = 'P0001';
  end if;
  if v_product_type not in ('checking', 'current', 'savings', 'business') then
    raise exception 'VALIDATION_ERROR: Invalid account type' using errcode = 'P0001';
  end if;
  if v_balance < 0 then
    raise exception 'VALIDATION_ERROR: Initial balance cannot be negative' using errcode = 'P0001';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'VALIDATION_ERROR: Currency must be a 3-letter code (e.g. USD)' using errcode = 'P0001';
  end if;
  if v_country is not null and char_length(v_country) > 80 then
    raise exception 'VALIDATION_ERROR: Account country is too long' using errcode = 'P0001';
  end if;
  if v_routing is not null and v_routing !~ '^[0-9A-Za-z\-]{4,20}$' then
    raise exception 'VALIDATION_ERROR: Routing number must be 4–20 letters or digits'
      using errcode = 'P0001';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[1-9]\d{7,14}$' then
    raise exception 'VALIDATION_ERROR: Phone must be an international number (e.g. +15551234567)'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'VALIDATION_ERROR: That email is already in use' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = v_username) then
    raise exception 'VALIDATION_ERROR: That username is already taken' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'VALIDATION_ERROR: That email already has an auth login' using errcode = 'P0001';
  end if;

  if v_password is null then
    v_password := v_username;
  end if;

  if v_account_number is null then
    v_account_number := public.generate_account_number();
  elsif v_account_number !~ '^\d{10}$' then
    raise exception 'VALIDATION_ERROR: Account number must be exactly 10 digits' using errcode = 'P0001';
  elsif exists (select 1 from public.accounts a where a.account_number = v_account_number) then
    raise exception 'VALIDATION_ERROR: Account number already exists' using errcode = 'P0001';
  end if;

  if v_account_type = 'four_stage_verification' then
    v_activation := public.build_activation_codes();
  end if;

  hashed := extensions.crypt(v_password, extensions.gen_salt('bf'));
  new_user_id := gen_random_uuid();

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    instance, new_user_id, 'authenticated', 'authenticated', v_email, hashed, now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb, now(), now(), '', '', '', ''
  );

  perform public.ensure_email_identity(new_user_id, v_email);

  insert into public.profiles (
    user_id, tenant_id, first_name, last_name, email, phone, username, status, role,
    handoff_temp_password, transfer_pin_hash, handoff_transfer_pin
  ) values (
    new_user_id, actor.tenant_id, v_first, v_last, v_email, v_phone, v_username, 'active', 'user',
    v_password,
    extensions.crypt(v_pin, extensions.gen_salt('bf')),
    v_pin
  )
  returning * into profile_row;

  insert into public.accounts (
    profile_id, tenant_id, account_number, account_type, product_type, account_status,
    one_time_transfer_used, account_country, routing_number
  ) values (
    profile_row.id,
    actor.tenant_id,
    v_account_number,
    v_account_type::public.account_type,
    v_product_type::public.product_account_type,
    'active',
    false,
    v_country,
    v_routing
  )
  returning * into account_row;

  if v_activation is not null then
    insert into public.account_activation_codes (account_id, tenant_id, codes)
    values (account_row.id, actor.tenant_id, v_activation)
    on conflict (account_id) do update
    set codes = excluded.codes, updated_at = timezone('utc', now());
  end if;

  insert into public.wallets (account_id, tenant_id, balance, currency)
  values (account_row.id, actor.tenant_id, 0, v_currency)
  returning * into wallet_row;

  if v_balance > 0 then
    fund_ref := 'FND' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    update public.wallets
    set balance = v_balance, updated_at = now()
    where id = wallet_row.id
    returning * into wallet_row;

    insert into public.transactions (
      wallet_id, account_id, tenant_id, transaction_type, status, amount,
      balance_before, balance_after, reference, idempotency_key, description, created_by, metadata
    ) values (
      wallet_row.id, account_row.id, actor.tenant_id, 'funding', 'completed', v_balance,
      0, v_balance, fund_ref, 'create-user-' || new_user_id::text,
      'Initial balance on account creation', auth.uid(), '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile_row.id,
      'userId', profile_row.user_id,
      'firstName', profile_row.first_name,
      'lastName', profile_row.last_name,
      'email', profile_row.email,
      'phone', profile_row.phone,
      'username', profile_row.username,
      'status', profile_row.status,
      'role', profile_row.role,
      'avatarUrl', profile_row.avatar_url,
      'handoffTempPassword', profile_row.handoff_temp_password,
      'handoffTransferPin', profile_row.handoff_transfer_pin,
      'createdAt', profile_row.created_at,
      'updatedAt', profile_row.updated_at
    ),
    'account', jsonb_build_object(
      'id', account_row.id,
      'accountNumber', account_row.account_number,
      'accountType', account_row.account_type,
      'productType', account_row.product_type,
      'accountStatus', account_row.account_status,
      'accountCountry', account_row.account_country,
      'routingNumber', account_row.routing_number,
      'balance', wallet_row.balance,
      'currency', wallet_row.currency,
      'oneTimeTransferUsed', account_row.one_time_transfer_used,
      'walletId', wallet_row.id,
      'activationCodes', v_activation
    ),
    'temporaryPassword', v_password,
    'transferPin', v_pin,
    'activationCodes', v_activation
  );
exception
  when others then
    if new_user_id is not null then
      delete from auth.users where id = new_user_id;
    end if;
    raise;
end;
$$;

revoke all on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text, text, text, text
) from public;
grant execute on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
