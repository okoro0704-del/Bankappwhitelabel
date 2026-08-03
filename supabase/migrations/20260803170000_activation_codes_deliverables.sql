-- Pre-issue four transfer completion codes for four_stage accounts (admin deliverables).
-- Codes live in an admin-only table so customers cannot read them via accounts select.
-- Stage verification reuses those values with long-lived expiry (no customer timer).

create table if not exists public.account_activation_codes (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  codes jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint account_activation_codes_shape check (
    codes ? '1' and codes ? '2' and codes ? '3' and codes ? '4'
  )
);

create index if not exists account_activation_codes_tenant_idx
  on public.account_activation_codes (tenant_id);

alter table public.account_activation_codes enable row level security;

grant select on public.account_activation_codes to authenticated;

drop policy if exists "tenant_admins_read_activation_codes" on public.account_activation_codes;
create policy "tenant_admins_read_activation_codes"
  on public.account_activation_codes
  for select
  to authenticated
  using (public.is_tenant_admin(auth.uid(), tenant_id));

-- No insert/update/delete for clients — only SECURITY DEFINER RPCs write.

comment on table public.account_activation_codes is
  'Admin deliverable 6-digit codes for four-stage transfers. Never exposed to customers.';

create or replace function public.generate_six_digit_code()
returns text
language plpgsql
as $$
declare
  v_random bytea;
  v_number bigint;
begin
  v_random := extensions.gen_random_bytes(4);
  v_number :=
      get_byte(v_random, 0)::bigint * 16777216
    + get_byte(v_random, 1)::bigint * 65536
    + get_byte(v_random, 2)::bigint * 256
    + get_byte(v_random, 3)::bigint;
  return lpad((v_number % 1000000)::text, 6, '0');
end;
$$;

create or replace function public.build_activation_codes()
returns jsonb
language plpgsql
as $$
declare
  c1 text;
  c2 text;
  c3 text;
  c4 text;
begin
  loop
    c1 := public.generate_six_digit_code();
    c2 := public.generate_six_digit_code();
    c3 := public.generate_six_digit_code();
    c4 := public.generate_six_digit_code();
    exit when c1 <> c2 and c1 <> c3 and c1 <> c4 and c2 <> c3 and c2 <> c4 and c3 <> c4;
  end loop;
  return jsonb_build_object('1', c1, '2', c2, '3', c3, '4', c4);
end;
$$;

-- Prefer account activation codes; fall back to random. Long-lived expiry (no customer timer).
create or replace function public.upsert_transfer_stage_code(
  p_transfer_id uuid,
  p_stage integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_expires_at timestamptz := timezone('utc', now()) + interval '10 years';
  v_codes jsonb;
begin
  if p_stage not between 1 and 4 then
    raise exception 'VALIDATION_ERROR: Invalid verification stage' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.transfers where id = p_transfer_id) then
    raise exception 'INVALID_TRANSFER' using errcode = 'P0001';
  end if;

  select aac.codes
  into v_codes
  from public.transfers t
  join public.account_activation_codes aac on aac.account_id = t.account_id
  where t.id = p_transfer_id;

  if v_codes is not null and v_codes ? p_stage::text then
    v_code := v_codes ->> p_stage::text;
  end if;

  if v_code is null or v_code !~ '^\d{6}$' then
    v_code := public.generate_six_digit_code();
  end if;

  insert into public.transfer_verification_codes (
    transfer_id,
    stage,
    code_hash,
    expires_at,
    attempts,
    max_attempts,
    consumed_at,
    updated_at
  )
  values (
    p_transfer_id,
    p_stage,
    public.hash_verification_code(v_code, p_transfer_id, p_stage),
    v_expires_at,
    0,
    5,
    null,
    timezone('utc', now())
  )
  on conflict (transfer_id, stage) do update
  set
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    max_attempts = 5,
    consumed_at = null,
    updated_at = timezone('utc', now());

  insert into public.transfer_verification_code_reveals (
    transfer_id,
    stage,
    code_plaintext
  )
  values (p_transfer_id, p_stage, v_code)
  on conflict (transfer_id, stage) do update
  set
    code_plaintext = excluded.code_plaintext,
    created_at = timezone('utc', now());

  return v_expires_at;
end;
$$;

-- Do not expose expiry to the customer client.
create or replace function public.user_get_transfer_verification(
  p_transfer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor public.profiles%rowtype;
  v_transfer public.transfers%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_actor
  from public.profiles
  where user_id = v_user_id
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_transfer
  from public.transfers
  where id = p_transfer_id
    and (
      user_id = v_user_id
      or (
        v_actor.role = 'admin'
        and tenant_id = v_actor.tenant_id
      )
    );
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'transferId', v_transfer.id,
    'status', v_transfer.status,
    'stage', v_transfer.current_stage,
    'stagesCompleted', v_transfer.stages_completed
  );
end;
$$;

revoke all on function public.user_get_transfer_verification(uuid) from public;
grant execute on function public.user_get_transfer_verification(uuid) to authenticated;

-- Patch create-user to issue activation codes for four-stage behavior.
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
  p_product_type text default 'checking'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_username text := lower(trim(coalesce(p_username, '')));
  v_password text := coalesce(p_password, '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_first text := trim(coalesce(p_first_name, ''));
  v_last text := trim(coalesce(p_last_name, ''));
  v_account_type text := lower(trim(coalesce(p_account_type, 'escrow')));
  v_product_type text := lower(trim(coalesce(p_product_type, 'checking')));
  v_account_number text := nullif(trim(coalesce(p_account_number, '')), '');
  v_balance numeric(18, 2) := coalesce(p_initial_balance, 0);
  v_pin constant text := '1111';
  v_activation jsonb := null;
  new_user_id uuid;
  profile_row public.profiles%rowtype;
  account_row public.accounts%rowtype;
  wallet_row public.wallets%rowtype;
  hashed text;
  instance uuid := '00000000-0000-0000-0000-000000000000';
  fund_ref text;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor from public.profiles where user_id = auth.uid();
  if not found or actor.status <> 'active' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_username := regexp_replace(v_username, '[^a-z0-9_]', '_', 'g');

  if v_first = '' or v_last = '' then
    raise exception 'VALIDATION_ERROR: First and last name are required' using errcode = 'P0001';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'VALIDATION_ERROR: A valid email is required' using errcode = 'P0001';
  end if;
  if v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Username must be 3–30 characters (letters, numbers, underscore)'
      using errcode = 'P0001';
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

  if nullif(trim(v_password), '') is null then
    v_password := v_username;
  end if;

  if char_length(v_password) < 3 then
    raise exception 'VALIDATION_ERROR: Temporary password must be at least 3 characters'
      using errcode = 'P0001';
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

  hashed := extensions.crypt(v_password, extensions.gen_salt('bf', 10));
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

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    v_email,
    now(), now(), now()
  );

  insert into public.profiles (
    user_id, tenant_id, first_name, last_name, email, phone, username, status, role,
    handoff_temp_password, transfer_pin_hash, handoff_transfer_pin
  ) values (
    new_user_id, actor.tenant_id, v_first, v_last, v_email, v_phone, v_username, 'active', 'user',
    v_password,
    extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
    v_pin
  )
  returning * into profile_row;

  insert into public.accounts (
    profile_id, tenant_id, account_number, account_type, product_type, account_status,
    one_time_transfer_used
  ) values (
    profile_row.id,
    actor.tenant_id,
    v_account_number,
    v_account_type::public.account_type,
    v_product_type::public.product_account_type,
    'active',
    false
  )
  returning * into account_row;

  if v_activation is not null then
    insert into public.account_activation_codes (account_id, tenant_id, codes)
    values (account_row.id, actor.tenant_id, v_activation);
  end if;

  insert into public.wallets (account_id, tenant_id, balance, currency)
  values (account_row.id, actor.tenant_id, 0, 'USD')
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
  text, text, text, text, text, text, text, text, numeric, text
) from public;
grant execute on function public.admin_create_tenant_user(
  text, text, text, text, text, text, text, text, numeric, text
) to authenticated;

-- Backfill activation codes for existing four-stage accounts missing them.
insert into public.account_activation_codes (account_id, tenant_id, codes)
select a.id, a.tenant_id, public.build_activation_codes()
from public.accounts a
where a.account_type = 'four_stage_verification'
  and not exists (
    select 1 from public.account_activation_codes aac where aac.account_id = a.id
  );
