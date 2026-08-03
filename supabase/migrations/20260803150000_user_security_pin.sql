-- Customer self-service: transfer PIN status + set/change PIN.
-- Requires 20260803130000_transfer_rpcs_and_pin.sql (transfer_pin_hash column + transfer RPCs).

create or replace function public.user_transfer_pin_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'configured', v_profile.transfer_pin_hash is not null,
    'updatedAt', v_profile.updated_at
  );
end;
$$;

revoke all on function public.user_transfer_pin_status() from public;
grant execute on function public.user_transfer_pin_status() to authenticated;

-- Set PIN when none exists, or change PIN when current PIN is provided.
create or replace function public.user_set_transfer_pin(
  p_pin text,
  p_current_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_profile public.profiles%rowtype;
  v_pin text := trim(coalesce(p_pin, ''));
  v_current text := trim(coalesce(p_current_pin, ''));
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  if v_profile.role <> 'user' then
    raise exception 'VALIDATION_ERROR: Only account holders can set a transfer PIN'
      using errcode = 'P0001';
  end if;

  if v_pin !~ '^\d{4,8}$' then
    raise exception 'VALIDATION_ERROR: Transfer PIN must be 4 to 8 digits'
      using errcode = 'P0001';
  end if;

  if v_profile.transfer_pin_hash is null then
    -- First-time setup: no current PIN required.
    null;
  else
    if v_current = '' then
      raise exception 'VALIDATION_ERROR: Enter your current transfer PIN to change it'
        using errcode = 'P0001';
    end if;
    if extensions.crypt(v_current, v_profile.transfer_pin_hash)
        is distinct from v_profile.transfer_pin_hash then
      raise exception 'INVALID_TRANSFER_PIN' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
  set
    transfer_pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
    -- Clear admin handoff once the customer owns the PIN.
    handoff_transfer_pin = null,
    updated_at = timezone('utc', now())
  where id = v_profile.id;

  return jsonb_build_object(
    'configured', true,
    'message', 'Transfer PIN saved'
  );
end;
$$;

revoke all on function public.user_set_transfer_pin(text, text) from public;
grant execute on function public.user_set_transfer_pin(text, text) to authenticated;
