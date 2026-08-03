-- Admin RPC to create or rotate four-stage transfer verification codes.

create or replace function public.admin_issue_activation_codes(
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  account_row public.accounts%rowtype;
  v_codes jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor
  from public.profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into account_row
  from public.accounts
  where id = p_account_id
    and tenant_id = actor.tenant_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if account_row.account_type <> 'four_stage_verification' then
    raise exception 'VALIDATION_ERROR: Activation codes are only for four-stage verification accounts'
      using errcode = 'P0001';
  end if;

  v_codes := public.build_activation_codes();

  insert into public.account_activation_codes (account_id, tenant_id, codes, updated_at)
  values (account_row.id, account_row.tenant_id, v_codes, timezone('utc', now()))
  on conflict (account_id) do update
  set
    codes = excluded.codes,
    updated_at = timezone('utc', now());

  return jsonb_build_object(
    'accountId', account_row.id,
    'activationCodes', v_codes,
    'message', 'Four-stage verification codes created'
  );
end;
$$;

revoke all on function public.admin_issue_activation_codes(uuid) from public;
grant execute on function public.admin_issue_activation_codes(uuid) to authenticated;

-- Create codes for every existing four-stage account in the admin's tenant that is missing them.
create or replace function public.admin_backfill_activation_codes()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  v_created integer := 0;
  r record;
  v_codes jsonb;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into actor
  from public.profiles
  where user_id = auth.uid()
    and status = 'active';
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  for r in
    select a.id, a.tenant_id
    from public.accounts a
    where a.tenant_id = actor.tenant_id
      and a.account_type = 'four_stage_verification'
      and not exists (
        select 1
        from public.account_activation_codes aac
        where aac.account_id = a.id
      )
  loop
    v_codes := public.build_activation_codes();
    insert into public.account_activation_codes (account_id, tenant_id, codes)
    values (r.id, r.tenant_id, v_codes);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'message', case
      when v_created = 0 then 'All four-stage accounts already have verification codes'
      when v_created = 1 then 'Created verification codes for 1 existing account'
      else format('Created verification codes for %s existing accounts', v_created)
    end
  );
end;
$$;

revoke all on function public.admin_backfill_activation_codes() from public;
grant execute on function public.admin_backfill_activation_codes() to authenticated;

-- One-time SQL backfill for every four-stage account still missing codes (all tenants).
insert into public.account_activation_codes (account_id, tenant_id, codes)
select a.id, a.tenant_id, public.build_activation_codes()
from public.accounts a
where a.account_type = 'four_stage_verification'
  and not exists (
    select 1 from public.account_activation_codes aac where aac.account_id = a.id
  );
