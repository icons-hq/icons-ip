\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    'authenticated',
    'authenticated',
    'role-admin@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'authenticated',
    'authenticated',
    'role-staff@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'authenticated',
    'authenticated',
    'role-fan@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000301',
    'role-admin@example.test',
    'role_admin',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'admin'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    'role-staff@example.test',
    'role_staff',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000303',
    'role-fan@example.test',
    'role_fan',
    '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb,
    now(),
    'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

-- The two-argument system-role setter cannot express a manager capability.
-- It stays sealed for every external API role; positive changes are covered by
-- operator_manager_lifecycle.sql with revision and explicit manager roles.
select 1 / case when not has_function_privilege('anon','public.admin_set_user_role(uuid,public.user_role)','execute')
 and not has_function_privilege('authenticated','public.admin_set_user_role(uuid,public.user_role)','execute')
 and not has_function_privilege('service_role','public.admin_set_user_role(uuid,public.user_role)','execute') then 1 else 0 end;
set local role authenticated;
do $$ declare actor uuid;begin
 foreach actor in array array['00000000-0000-4000-8000-000000000301'::uuid,'00000000-0000-4000-8000-000000000302'::uuid,'00000000-0000-4000-8000-000000000303'::uuid] loop
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin perform public.admin_set_user_role('00000000-0000-4000-8000-000000000303','admin');raise exception 'retired role setter reopened';
  exception when insufficient_privilege then null;end;
 end loop;
end $$;
reset role;
select 1 / case when (select role from public.profiles where id='00000000-0000-4000-8000-000000000303')='user'
 and not exists(select 1 from public.audit_log where actor_id in ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000303') and action='admin_user_role_update') then 1 else 0 end;
rollback;
