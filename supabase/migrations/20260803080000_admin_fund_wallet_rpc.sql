-- Tenant admin wallet funding + profile status via RPC (no Edge Function required).

-- Allow tenant admins to mutate wallets/ledger via SECURITY DEFINER RPCs.
create or replace function public.protect_wallet_privileges()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.balance is distinct from old.balance
      or new.account_id is distinct from old.account_id
      or new.currency is distinct from old.currency
    then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
      then
        raise exception 'Direct wallet balance or ownership changes are not permitted';
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if auth.role() <> 'service_role'
      and not public.is_master_admin(auth.uid())
      and not public.is_admin(auth.uid())
    then
      raise exception 'Direct wallet inserts are not permitted';
    end if;
  elsif tg_op = 'DELETE' then
    if auth.role() <> 'service_role'
      and not public.is_master_admin(auth.uid())
      and not public.is_admin(auth.uid())
    then
      raise exception 'Direct wallet deletes are not permitted';
    end if;
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.protect_transaction_privileges()
returns trigger
language plpgsql
as $$
begin
  if auth.role() <> 'service_role'
    and not public.is_master_admin(auth.uid())
    and not public.is_admin(auth.uid())
  then
    raise exception 'Direct transaction mutations are not permitted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

-- Allow tenant admins to change profile status (suspend/activate) via SECURITY DEFINER RPCs.
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
        raise exception 'Changing role, status, user_id, email, or tenant_id is not permitted';
      end if;
    elsif new.status is distinct from old.status then
      if auth.role() <> 'service_role'
        and not public.is_master_admin(auth.uid())
        and not public.is_admin(auth.uid())
      then
        raise exception 'Changing role, status, user_id, email, or tenant_id is not permitted';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.admin_fund_wallet(
  p_amount numeric,
  p_wallet_id uuid default null,
  p_account_id uuid default null,
  p_reference text default null,
  p_idempotency_key text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  wallet_row public.wallets%rowtype;
  txn_row public.transactions%rowtype;
  existing public.transactions%rowtype;
  v_amount numeric(18, 2) := coalesce(p_amount, 0);
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_idempotency text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  balance_before numeric(18, 2);
  balance_after numeric(18, 2);
  replay boolean := false;
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

  if v_amount <= 0 then
    raise exception 'VALIDATION_ERROR: Funding amount must be greater than zero' using errcode = 'P0001';
  end if;

  if p_wallet_id is not null then
    select * into wallet_row from public.wallets where id = p_wallet_id;
  elsif p_account_id is not null then
    select * into wallet_row from public.wallets where account_id = p_account_id;
  else
    raise exception 'VALIDATION_ERROR: walletId or accountId is required' using errcode = 'P0001';
  end if;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if wallet_row.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_idempotency is not null then
    select * into existing
    from public.transactions
    where idempotency_key = v_idempotency;
    if found then
      replay := true;
      txn_row := existing;
      select * into wallet_row from public.wallets where id = wallet_row.id;
      return jsonb_build_object(
        'wallet', jsonb_build_object(
          'id', wallet_row.id,
          'accountId', wallet_row.account_id,
          'balance', wallet_row.balance,
          'currency', wallet_row.currency,
          'updatedAt', wallet_row.updated_at
        ),
        'transaction', jsonb_build_object(
          'id', txn_row.id,
          'accountId', txn_row.account_id,
          'walletId', txn_row.wallet_id,
          'type', txn_row.transaction_type,
          'status', txn_row.status,
          'amount', txn_row.amount,
          'balanceBefore', txn_row.balance_before,
          'balanceAfter', txn_row.balance_after,
          'reference', txn_row.reference,
          'description', txn_row.description,
          'createdAt', txn_row.created_at
        ),
        'idempotentReplay', true
      );
    end if;
  end if;

  if v_reference is null then
    v_reference := 'FND' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  end if;

  if exists (select 1 from public.transactions t where t.reference = v_reference) then
    raise exception 'VALIDATION_ERROR: Funding reference already exists' using errcode = 'P0001';
  end if;

  select * into wallet_row from public.wallets where id = wallet_row.id for update;
  balance_before := wallet_row.balance;
  balance_after := balance_before + v_amount;

  update public.wallets
  set balance = balance_after, updated_at = now()
  where id = wallet_row.id
  returning * into wallet_row;

  insert into public.transactions (
    wallet_id,
    account_id,
    tenant_id,
    transaction_type,
    status,
    amount,
    balance_before,
    balance_after,
    reference,
    idempotency_key,
    description,
    created_by,
    metadata
  ) values (
    wallet_row.id,
    wallet_row.account_id,
    wallet_row.tenant_id,
    'funding',
    'completed',
    v_amount,
    balance_before,
    balance_after,
    v_reference,
    v_idempotency,
    v_description,
    auth.uid(),
    '{}'::jsonb
  )
  returning * into txn_row;

  return jsonb_build_object(
    'wallet', jsonb_build_object(
      'id', wallet_row.id,
      'accountId', wallet_row.account_id,
      'balance', wallet_row.balance,
      'currency', wallet_row.currency,
      'updatedAt', wallet_row.updated_at
    ),
    'transaction', jsonb_build_object(
      'id', txn_row.id,
      'accountId', txn_row.account_id,
      'walletId', txn_row.wallet_id,
      'type', txn_row.transaction_type,
      'status', txn_row.status,
      'amount', txn_row.amount,
      'balanceBefore', txn_row.balance_before,
      'balanceAfter', txn_row.balance_after,
      'reference', txn_row.reference,
      'description', txn_row.description,
      'createdAt', txn_row.created_at
    ),
    'idempotentReplay', replay
  );
end;
$$;

revoke all on function public.admin_fund_wallet(numeric, uuid, uuid, text, text, text) from public;
grant execute on function public.admin_fund_wallet(numeric, uuid, uuid, text, text, text) to authenticated;

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
    'createdAt', target.created_at,
    'updatedAt', target.updated_at
  );
end;
$$;

revoke all on function public.admin_set_profile_status(uuid, text) from public;
grant execute on function public.admin_set_profile_status(uuid, text) to authenticated;
