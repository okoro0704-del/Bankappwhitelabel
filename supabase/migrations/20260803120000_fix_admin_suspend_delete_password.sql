-- Fix admin suspend/unsuspend, delete user, and username-as-password.
-- Root cause: protect_account_privileges only allowed service_role to change
-- account_status, so SECURITY DEFINER admin RPCs were blocked.

-- ---------------------------------------------------------------------------
-- Allow tenant admins to change account_status (suspend / activate)
-- ---------------------------------------------------------------------------
create or replace function public.protect_account_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.account_type is distinct from old.account_type
      or new.account_number is distinct from old.account_number
      or new.profile_id is distinct from old.profile_id
      or new.tenant_id is distinct from old.tenant_id
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
      then
        raise exception 'Changing account type, number, ownership, or tenant is not permitted';
      end if;
    elsif new.account_status is distinct from old.account_status then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
      then
        raise exception 'Changing account status is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Keep profile status changes allowed for tenant admins (reassert).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role is distinct from old.role
      or new.user_id is distinct from old.user_id
      or new.email is distinct from old.email
      or new.tenant_id is distinct from old.tenant_id
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
      then
        raise exception 'Changing role, user_id, email, or tenant_id is not permitted';
      end if;
    elsif new.status is distinct from old.status then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
      then
        raise exception 'Changing profile status is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Suspend / unsuspend: sync profile + account
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_profile_status(
  p_profile_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  account_row public.accounts%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
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

  if v_status not in ('active', 'suspended') then
    raise exception 'VALIDATION_ERROR: Status must be active or suspended' using errcode = 'P0001';
  end if;

  select * into target from public.profiles where id = p_profile_id;
  if not found or target.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if target.user_id = auth.uid() then
    raise exception 'VALIDATION_ERROR: You cannot suspend your own admin account' using errcode = 'P0001';
  end if;

  update public.profiles
  set status = v_status::public.account_status, updated_at = now()
  where id = target.id
  returning * into target;

  update public.accounts
  set account_status = v_status::public.account_status, updated_at = now()
  where profile_id = target.id
  returning * into account_row;

  return jsonb_build_object(
    'id', target.id,
    'userId', target.user_id,
    'firstName', target.first_name,
    'lastName', target.last_name,
    'email', target.email,
    'phone', target.phone,
    'username', target.username,
    'status', target.status,
    'role', target.role,
    'handoffTempPassword', target.handoff_temp_password,
    'createdAt', target.created_at,
    'updatedAt', target.updated_at,
    'accountStatus', account_row.account_status
  );
end;
$$;

revoke all on function public.admin_set_profile_status(uuid, text) from public;
grant execute on function public.admin_set_profile_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Delete customer (not self, not other admins)
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_tenant_user(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  deleted_user_id uuid;
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

  select * into target from public.profiles where id = p_profile_id;
  if not found or target.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if target.user_id = auth.uid() then
    raise exception 'VALIDATION_ERROR: You cannot delete your own admin account' using errcode = 'P0001';
  end if;

  if target.role = 'admin' then
    raise exception 'VALIDATION_ERROR: Tenant admin accounts cannot be deleted here' using errcode = 'P0001';
  end if;

  deleted_user_id := target.user_id;

  -- Remove auth identity + user; profiles/accounts/wallets cascade.
  delete from auth.identities where user_id = deleted_user_id;
  delete from auth.users where id = deleted_user_id;

  -- If auth row was already gone, still remove the profile.
  if exists (select 1 from public.profiles where id = p_profile_id) then
    delete from public.profiles where id = p_profile_id;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'profileId', p_profile_id,
    'userId', deleted_user_id
  );
end;
$$;

revoke all on function public.admin_delete_tenant_user(uuid) from public;
grant execute on function public.admin_delete_tenant_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Set Auth password = username (bcrypt cost 10, GoTrue-compatible)
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_password_to_username(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  hashed text;
  v_password text;
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

  select * into target from public.profiles where id = p_profile_id;
  if not found or target.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if target.role = 'admin' then
    raise exception 'VALIDATION_ERROR: Use master console to reset tenant admin passwords'
      using errcode = 'P0001';
  end if;

  v_password := lower(trim(coalesce(target.username, '')));
  if v_password !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: Username is missing or too short to use as a password'
      using errcode = 'P0001';
  end if;

  hashed := extensions.crypt(v_password, extensions.gen_salt('bf', 10));

  update auth.users
  set
    encrypted_password = hashed,
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
  where id = target.user_id;

  if not found then
    raise exception 'VALIDATION_ERROR: Auth login row is missing for this user' using errcode = 'P0001';
  end if;

  update public.profiles
  set handoff_temp_password = v_password, updated_at = now()
  where id = target.id
  returning * into target;

  return jsonb_build_object(
    'id', target.id,
    'username', target.username,
    'temporaryPassword', v_password,
    'handoffTempPassword', target.handoff_temp_password,
    'message', 'Login password set to the username. Sign in with username + username as password.'
  );
end;
$$;

revoke all on function public.admin_reset_password_to_username(uuid) from public;
grant execute on function public.admin_reset_password_to_username(uuid) to authenticated;

-- Edit deposit / funding transaction date (reassert if earlier migration was skipped).
create or replace function public.admin_update_transaction_created_at(
  p_transaction_id uuid,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  txn public.transactions%rowtype;
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

  if p_created_at is null then
    raise exception 'VALIDATION_ERROR: A deposit date is required' using errcode = 'P0001';
  end if;

  select * into txn from public.transactions where id = p_transaction_id;
  if not found or txn.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if txn.transaction_type <> 'funding' then
    raise exception 'VALIDATION_ERROR: Only funding (deposit) dates can be edited' using errcode = 'P0001';
  end if;

  update public.transactions
  set created_at = p_created_at, updated_at = now()
  where id = txn.id
  returning * into txn;

  return jsonb_build_object(
    'id', txn.id,
    'accountId', txn.account_id,
    'walletId', txn.wallet_id,
    'type', txn.transaction_type,
    'status', txn.status,
    'amount', txn.amount,
    'balanceBefore', txn.balance_before,
    'balanceAfter', txn.balance_after,
    'reference', txn.reference,
    'description', txn.description,
    'createdAt', txn.created_at
  );
end;
$$;

revoke all on function public.admin_update_transaction_created_at(uuid, timestamptz) from public;
grant execute on function public.admin_update_transaction_created_at(uuid, timestamptz) to authenticated;
