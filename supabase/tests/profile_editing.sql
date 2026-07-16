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
    '00000000-0000-4000-8000-000000001201',
    'authenticated',
    'authenticated',
    'profile-one@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001202',
    'authenticated',
    'authenticated',
    'profile-two@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

do $$
begin
  begin
    update public.profiles
    set nickname = '   '
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'blank nickname should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = ' untrimmed '
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'untrimmed nickname should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = repeat('a', 513)
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'nickname longer than the raw ceiling should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set avatar_path = '00000000-0000-4000-8000-000000001202/profile/11111111-1111-4111-8111-111111111111.jpg'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'non-owned avatar path should violate the profile identity constraint';
end;
$$;

update public.profiles
set
  nickname = 'FanName',
  avatar_path = '00000000-0000-4000-8000-000000001201/profile/11111111-1111-4111-8111-111111111111.jpg'
where id = '00000000-0000-4000-8000-000000001201';

do $$
begin
  begin
    update public.profiles
    set nickname = 'fanname'
    where id = '00000000-0000-4000-8000-000000001202';
  exception
    when unique_violation then
      return;
  end;

  raise exception 'normalized duplicate nickname should raise unique_violation';
end;
$$;

update public.profiles
set nickname = 'SecondFan'
where id = '00000000-0000-4000-8000-000000001202';

select 1 / case when not has_column_privilege(
  'authenticated',
  'public.profiles',
  'nickname',
  'UPDATE'
) then 1 else 0 end as assert_authenticated_cannot_update_nickname_directly;

select 1 / case when not has_column_privilege(
  'authenticated',
  'public.profiles',
  'avatar_path',
  'UPDATE'
) then 1 else 0 end as assert_authenticated_cannot_update_avatar_directly;

select 1 / case when has_column_privilege(
  'authenticated',
  'public.profiles',
  'birth_date',
  'UPDATE'
) and has_column_privilege(
  'authenticated',
  'public.profiles',
  'consents',
  'UPDATE'
) and has_column_privilege(
  'authenticated',
  'public.profiles',
  'onboarded_at',
  'UPDATE'
) then 1 else 0 end as assert_unrelated_profile_update_grants_remain;

select 1 / case when not has_function_privilege(
  'public',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) and not has_function_privilege(
  'anon',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) and not has_function_privilege(
  'authenticated',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) and has_function_privilege(
  'service_role',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) then 1 else 0 end as assert_identity_rpc_is_service_role_only;

select 1 / case when exists (
  select 1
  from pg_proc
  where oid = 'public.service_update_profile_identity(uuid,text,text,boolean)'::regprocedure
    and prosecdef
    and proconfig = array['search_path=""']
    and pg_get_functiondef(oid) ~* 'for update'
) then 1 else 0 end as assert_identity_rpc_is_hardened_and_locks_row;

create temporary table profile_rpc_result (previous_avatar_path text);
grant insert, select on profile_rpc_result to service_role;

set local role service_role;

insert into profile_rpc_result (previous_avatar_path)
select previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'UpdatedFan',
  '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
  true
);

reset role;

select 1 / case when (
  select previous_avatar_path
  from profile_rpc_result
) = '00000000-0000-4000-8000-000000001201/profile/11111111-1111-4111-8111-111111111111.jpg'
then 1 else 0 end as assert_rpc_returns_locked_previous_avatar;

select 1 / case when exists (
  select 1
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'UpdatedFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
) then 1 else 0 end as assert_service_rpc_updates_identity;

select 1 / case when exists (
  select 1
  from public.public_profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'UpdatedFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
) then 1 else 0 end as assert_public_profile_trigger_syncs_identity;

select 1 / case when exists (
  select 1
  from storage.buckets
  where id = 'user-uploads'
    and file_size_limit = 5 * 1024 * 1024
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
) then 1 else 0 end as assert_user_upload_bucket_limits;

select 1 / case when exists (
  select 1
  from pg_policy as policy
  join pg_class as relation on relation.oid = policy.polrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'storage'
    and relation.relname = 'objects'
    and policy.polname = 'user_uploads_write'
    and policy.polcmd = 'a'
    and policy.polroles = array[0::oid]
    and policy.polpermissive
    and policy.polqual is null
    and position(
      'bucket_id = ''user-uploads''::text'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'SELECT auth.uid() AS uid'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'community/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      ''')$''::text'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
) then 1 else 0 end as assert_user_upload_insert_policy_catalog_contract;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    update public.profiles
    set nickname = 'DirectNicknameChange'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'authenticated nickname update should be denied';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set avatar_path = '00000000-0000-4000-8000-000000001201/profile/88888888-8888-4888-8888-888888888888.jpg'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'authenticated avatar update should be denied';
end;
$$;

update public.profiles
set birth_date = '1999-01-01'
where id = '00000000-0000-4000-8000-000000001202';

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select 1 / case when (
  select birth_date
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001202'
) is null then 1 else 0 end as assert_other_user_update_remains_blocked_by_rls;

rollback;
