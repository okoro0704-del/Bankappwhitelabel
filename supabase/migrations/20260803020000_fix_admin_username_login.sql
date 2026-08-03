-- Resolve handoff admin username → owner email when profiles.username is not yet synced.
-- Prefer profile username match; fall back to tenants.handoff_admin_username.

create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ident text := lower(trim(coalesce(p_identifier, '')));
  em text;
begin
  if ident = '' then
    return null;
  end if;

  if position('@' in ident) > 0 then
    return ident;
  end if;

  select lower(p.email) into em
  from public.profiles p
  where lower(p.username) = ident
  limit 1;

  if em is not null then
    return em;
  end if;

  select lower(coalesce(p.email, '')) into em
  from public.tenants t
  left join public.profiles p on p.user_id = t.owner_user_id
  where lower(trim(coalesce(t.handoff_admin_username, ''))) = ident
  limit 1;

  if em is null or em = '' then
    return null;
  end if;

  return em;
end;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
