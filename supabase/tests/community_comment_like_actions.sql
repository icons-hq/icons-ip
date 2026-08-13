\set ON_ERROR_STOP on

begin;

update private.community_write_control
set
  post_create_enabled = true,
  comment_create_enabled = true;

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
    '00000000-0000-4000-8000-000000000014',
    'authenticated',
    'authenticated',
    'community-author@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000015',
    'authenticated',
    'authenticated',
    'community-fan@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  )
on conflict (id) do nothing;

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000000014' then 'smoke_author'
    else 'smoke_fan'
  end,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb,
  onboarded_at = now()
where id in (
  '00000000-0000-4000-8000-000000000014',
  '00000000-0000-4000-8000-000000000015'
);

insert into public.posts (id, user_id, ip_id, text, tag, status)
values (
  '00000000-0000-4000-8000-000000000016',
  '00000000-0000-4000-8000-000000000014',
  'rilakkuma',
  'community smoke post',
  'smoke',
  'visible'
)
on conflict (id) do update set
  status = excluded.status,
  text = excluded.text;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000015', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.set_post_like('00000000-0000-4000-8000-000000000016', true);
select public.set_post_like('00000000-0000-4000-8000-000000000016', true);
select 1 / case when (
  select count(*)
  from public.likes
  where post_id = '00000000-0000-4000-8000-000000000016'
    and user_id = '00000000-0000-4000-8000-000000000015'
) = 1 then 1 else 0 end as assert_like_idempotent;

select public.create_post_comment('00000000-0000-4000-8000-000000000016', '  smoke comment  ');
select 1 / case when (
  select count(*)
  from public.comments
  where post_id = '00000000-0000-4000-8000-000000000016'
    and user_id = '00000000-0000-4000-8000-000000000015'
    and text = 'smoke comment'
) = 1 then 1 else 0 end as assert_comment_created;

do $$
declare
  direct_insert_succeeded boolean := false;
begin
  begin
    insert into public.comments (post_id, user_id, text)
    values (
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000015',
      'direct comment'
    );
    direct_insert_succeeded := true;
  exception
    when insufficient_privilege or check_violation then
      direct_insert_succeeded := false;
  end;

  if direct_insert_succeeded then
    raise exception 'direct comments insert should be blocked';
  end if;
end;
$$;

do $$
declare
  direct_delete_succeeded boolean := false;
begin
  begin
    delete from public.comments
    where post_id = '00000000-0000-4000-8000-000000000016'
      and user_id = '00000000-0000-4000-8000-000000000015';
    direct_delete_succeeded := found;
  exception
    when insufficient_privilege then
      direct_delete_succeeded := false;
  end;

  if direct_delete_succeeded then
    raise exception 'direct comments delete should be blocked';
  end if;
end;
$$;

select 1 / case when (
  select count(*)
  from public.comments
  where post_id = '00000000-0000-4000-8000-000000000016'
    and user_id = '00000000-0000-4000-8000-000000000015'
    and text = 'smoke comment'
) = 1 then 1 else 0 end as assert_comment_survives_blocked_direct_delete;

select public.set_post_like('00000000-0000-4000-8000-000000000016', false);
select public.set_post_like('00000000-0000-4000-8000-000000000016', false);
select 1 / case when (
  select count(*)
  from public.likes
  where post_id = '00000000-0000-4000-8000-000000000016'
    and user_id = '00000000-0000-4000-8000-000000000015'
) = 0 then 1 else 0 end as assert_unlike_idempotent;

do $$
declare
  direct_insert_succeeded boolean := false;
begin
  begin
    insert into public.likes (post_id, user_id)
    values (
      '00000000-0000-4000-8000-000000000016',
      '00000000-0000-4000-8000-000000000015'
    );
    direct_insert_succeeded := true;
  exception
    when insufficient_privilege or check_violation then
      direct_insert_succeeded := false;
  end;

  if direct_insert_succeeded then
    raise exception 'direct likes insert should be blocked';
  end if;
end;
$$;

select public.set_post_like('00000000-0000-4000-8000-000000000016', true);

do $$
declare
  direct_delete_succeeded boolean := false;
begin
  begin
    delete from public.likes
    where post_id = '00000000-0000-4000-8000-000000000016'
      and user_id = '00000000-0000-4000-8000-000000000015';
    direct_delete_succeeded := found;
  exception
    when insufficient_privilege then
      direct_delete_succeeded := false;
  end;

  if direct_delete_succeeded then
    raise exception 'direct likes delete should be blocked';
  end if;
end;
$$;

select 1 / case when (
  select count(*)
  from public.likes
  where post_id = '00000000-0000-4000-8000-000000000016'
    and user_id = '00000000-0000-4000-8000-000000000015'
) = 1 then 1 else 0 end as assert_like_survives_blocked_direct_delete;

rollback;
