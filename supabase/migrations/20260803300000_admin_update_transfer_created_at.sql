-- Allow tenant admins to edit the transfer date shown in history.
-- Also syncs completed_at (when set) and the linked ledger transaction date.

create or replace function public.admin_update_transfer_created_at(
  p_transfer_id uuid,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  xfer public.transfers%rowtype;
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
    raise exception 'VALIDATION_ERROR: A transfer date is required' using errcode = 'P0001';
  end if;

  select * into xfer from public.transfers where id = p_transfer_id;
  if not found or xfer.tenant_id is distinct from actor.tenant_id then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.transfers
  set
    created_at = p_created_at,
    completed_at = case
      when completed_at is not null then p_created_at
      else completed_at
    end,
    updated_at = now()
  where id = xfer.id
  returning * into xfer;

  if xfer.ledger_transaction_id is not null then
    update public.transactions
    set created_at = p_created_at, updated_at = now()
    where id = xfer.ledger_transaction_id
      and tenant_id is not distinct from actor.tenant_id;
  end if;

  return public.transfer_json(xfer);
end;
$$;

revoke all on function public.admin_update_transfer_created_at(uuid, timestamptz) from public;
grant execute on function public.admin_update_transfer_created_at(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
