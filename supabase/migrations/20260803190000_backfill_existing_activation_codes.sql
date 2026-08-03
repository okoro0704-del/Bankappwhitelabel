-- Ensure existing four-stage accounts get verification codes (safe to re-run).
-- Also refreshes the tenant backfill RPC if 20260803180000 was applied earlier without it.

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

insert into public.account_activation_codes (account_id, tenant_id, codes)
select a.id, a.tenant_id, public.build_activation_codes()
from public.accounts a
where a.account_type = 'four_stage_verification'
  and not exists (
    select 1 from public.account_activation_codes aac where aac.account_id = a.id
  );
