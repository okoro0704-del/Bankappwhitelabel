-- Web Finance branding cleanup: remove fictional / simulation copy from seeded data
-- and ledger default descriptions. Banking rules unchanged.

update public.tenant_branding
set login_subtitle = 'Sign in to manage your account.'
where login_subtitle ilike '%fictional%';

update public.transactions
set description = 'External transfer'
where description = 'External fictional transfer';

-- Same body as 20260731120000, with default description copy updated only.
create or replace function public.complete_transfer_debit_atomic(
  p_transfer_id uuid,
  p_require_one_time_slot boolean default false,
  p_require_four_stages boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_transfer public.transfers%rowtype;
  locked_account public.accounts%rowtype;
  ledger public.transactions%rowtype;
  updated_rows integer;
begin
  select * into locked_transfer
  from public.transfers
  where id = p_transfer_id
  for update;

  if not found then
    raise exception 'INVALID_TRANSFER';
  end if;

  if locked_transfer.status = 'completed' then
    return (
      select jsonb_build_object(
        'transfer', to_jsonb(t),
        'ledger', to_jsonb(tx),
        'idempotent_replay', true
      )
      from public.transfers t
      left join public.transactions tx on tx.id = t.ledger_transaction_id
      where t.id = p_transfer_id
    );
  end if;

  if locked_transfer.status in ('failed', 'cancelled', 'restricted') then
    raise exception 'INVALID_TRANSFER';
  end if;

  if p_require_four_stages then
    if locked_transfer.stages_completed < 4 then
      raise exception 'VERIFICATION_REQUIRED';
    end if;
  end if;

  select * into locked_account
  from public.accounts
  where id = locked_transfer.account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if locked_account.account_status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE';
  end if;

  if p_require_one_time_slot then
    update public.accounts
    set one_time_transfer_used = true
    where id = locked_account.id
      and one_time_transfer_used = false;

    get diagnostics updated_rows = row_count;
    if updated_rows = 0 then
      update public.transfers
      set status = 'failed',
          reason_code = 'TRANSFER_LIMIT_REACHED',
          failure_reason = 'Your transfer could not be completed. Please contact the bank for assistance.'
      where id = locked_transfer.id;

      raise exception 'TRANSFER_LIMIT_REACHED';
    end if;
  end if;

  ledger := public.debit_wallet_atomic(
    locked_transfer.wallet_id,
    locked_transfer.amount,
    locked_transfer.reference,
    'transfer-debit:' || locked_transfer.id::text,
    coalesce(locked_transfer.description, 'External transfer'),
    locked_transfer.user_id,
    jsonb_build_object(
      'source', 'transfer',
      'transfer_id', locked_transfer.id
    )
  );

  update public.transfers
  set status = 'completed',
      ledger_transaction_id = ledger.id,
      completed_at = timezone('utc', now()),
      reason_code = null,
      failure_reason = null
  where id = locked_transfer.id
  returning * into locked_transfer;

  return jsonb_build_object(
    'transfer', to_jsonb(locked_transfer),
    'ledger', to_jsonb(ledger),
    'idempotent_replay', false
  );
exception
  when unique_violation then
    -- Concurrent debit ledger idempotency collision: re-read completed state.
    return (
      select jsonb_build_object(
        'transfer', to_jsonb(t),
        'ledger', to_jsonb(tx),
        'idempotent_replay', true
      )
      from public.transfers t
      left join public.transactions tx on tx.id = t.ledger_transaction_id
      where t.id = p_transfer_id
        and t.status = 'completed'
    );
end;
$$;
