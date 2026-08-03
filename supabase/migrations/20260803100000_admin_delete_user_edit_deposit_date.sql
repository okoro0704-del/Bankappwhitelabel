-- Admin delete user + edit funding/deposit date.

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
  delete from auth.users where id = deleted_user_id;

  return jsonb_build_object(
    'deleted', true,
    'profileId', p_profile_id,
    'userId', deleted_user_id
  );
end;
$$;

revoke all on function public.admin_delete_tenant_user(uuid) from public;
grant execute on function public.admin_delete_tenant_user(uuid) to authenticated;

-- Edit deposit / funding transaction date (created_at) to a later or earlier date.
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

-- Keep profile + account status in sync when suspending/activating.
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

  update public.profiles
  set status = v_status::public.account_status, updated_at = now()
  where id = target.id
  returning * into target;

  update public.accounts
  set account_status = v_status::public.account_status, updated_at = now()
  where profile_id = target.id;

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
    'updatedAt', target.updated_at
  );
end;
$$;

revoke all on function public.admin_set_profile_status(uuid, text) from public;
grant execute on function public.admin_set_profile_status(uuid, text) to authenticated;
