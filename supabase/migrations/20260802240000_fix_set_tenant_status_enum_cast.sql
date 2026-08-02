-- Fix Activate/Deactivate: cast text status to tenant_status enum.

create or replace function public.master_set_tenant_status(
  p_tenant_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id uuid;
begin
  perform public.require_master_admin();

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001';
  end if;

  update public.tenants
  set
    status = p_status::public.tenant_status,
    updated_at = timezone('utc', now())
  where id = p_tenant_id
  returning id into updated_id;

  if updated_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return public.master_get_tenant(p_tenant_id);
end;
$$;

revoke all on function public.master_set_tenant_status(uuid, text) from public;
grant execute on function public.master_set_tenant_status(uuid, text) to authenticated;
