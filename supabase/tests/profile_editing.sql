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

update public.profiles
set nickname = 'FanName'
where id = '00000000-0000-4000-8000-000000001201';

do $$
begin
  begin
    update public.profiles
    set nickname = ' fanname '
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

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

update public.profiles
set nickname = 'ChangedByAnotherUser'
where id = '00000000-0000-4000-8000-000000001202';

update public.profiles
set
  nickname = 'UpdatedFan',
  avatar_path = '00000000-0000-4000-8000-000000001201/profile/avatar.webp'
where id = '00000000-0000-4000-8000-000000001201';

select 1 / case when exists (
  select 1
  from public.public_profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'UpdatedFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/avatar.webp'
) then 1 else 0 end as assert_public_profile_received_nickname_and_avatar;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select 1 / case when (
  select nickname
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001202'
) = 'SecondFan' then 1 else 0 end as assert_user_cannot_update_another_profile;

select 1 / case when exists (
  select 1
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'UpdatedFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/avatar.webp'
) then 1 else 0 end as assert_self_profile_update_succeeds;

rollback;
