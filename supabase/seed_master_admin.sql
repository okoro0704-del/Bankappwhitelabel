-- One-shot: promote an existing auth user to Web Finance (Master Admin) console access.
-- Replace the UUID with auth.users.id from the Supabase Auth dashboard.
--
-- insert into public.master_admins (user_id, created_by)
-- values ('00000000-0000-4000-8000-000000000000', null)
-- on conflict (user_id) do nothing;

select 1;
