\set ON_ERROR_STOP on

begin;

create temporary table community_post_editing_results (
  name text primary key,
  result jsonb not null
) on commit drop;
grant all on community_post_editing_results to authenticated;

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
  ('00000000-0000-4000-8000-000000000108', 'authenticated', 'authenticated', 'post-edit-owner@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000118', 'authenticated', 'authenticated', 'post-edit-other@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000128', 'authenticated', 'authenticated', 'post-edit-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000000108', 'post-edit-owner@example.test', 'post_edit_owner', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000000118', 'post-edit-other@example.test', 'post_edit_other', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000000128', 'post-edit-staff@example.test', 'post_edit_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.verticals (key, label, color)
values ('community-post-edit-smoke', '포스트 수정 스모크', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, featured)
values
  ('community-post-edit-old', '수정 전 IP', 'community-post-edit-smoke', false),
  ('community-post-edit-new', '수정 후 IP', 'community-post-edit-smoke', false)
on conflict (id) do update set
  title = excluded.title,
  vertical_key = excluded.vertical_key,
  featured = excluded.featured;

insert into public.posts (
  id,
  user_id,
  ip_id,
  text,
  tag,
  image_path,
  status,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001081',
    '00000000-0000-4000-8000-000000000108',
    'community-post-edit-old',
    'original visible post',
    'original',
    '00000000-0000-4000-8000-000000000108/community/original.png',
    'visible',
    '2026-01-01 00:00:00+00',
    '2026-01-01 00:00:00+00'
  ),
  (
    '00000000-0000-4000-8000-000000001082',
    '00000000-0000-4000-8000-000000000108',
    'community-post-edit-old',
    'hidden post',
    'hidden',
    null,
    'hidden',
    '2026-01-01 00:00:00+00',
    '2026-01-01 00:00:00+00'
  )
on conflict (id) do update set
  user_id = excluded.user_id,
  ip_id = excluded.ip_id,
  text = excluded.text,
  tag = excluded.tag,
  image_path = excluded.image_path,
  status = excluded.status,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'edit_own_post'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_post_id uuid, post_text text, post_ip_id text, post_tag text'
    and proc.prosecdef
    and proc.proconfig = array['search_path=""']
) then 1 else 0 end as assert_edit_function_security_contract;

select 1 / case when (
  not has_table_privilege('anon', 'public.posts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.posts', 'UPDATE')
  and not has_table_privilege('service_role', 'public.posts', 'UPDATE')
) then 1 else 0 end as assert_direct_post_update_acl_removed;

select 1 / case when (
  not has_function_privilege('anon', 'public.edit_own_post(uuid,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.edit_own_post(uuid,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.edit_own_post(uuid,text,text,text)', 'execute')
) then 1 else 0 end as assert_edit_function_acl;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000001081',
      'missing auth edit',
      'community-post-edit-old',
      null
    );
  exception
    when invalid_authorization_specification then return;
  end;

  raise exception 'authenticated role without auth uid should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000108', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  direct_update_succeeded boolean := false;
begin
  begin
    update public.posts
    set text = 'forbidden direct update'
    where id = '00000000-0000-4000-8000-000000001081';
    direct_update_succeeded := found;
  exception
    when insufficient_privilege then
      direct_update_succeeded := false;
  end;

  if direct_update_succeeded then
    raise exception 'direct post update should be blocked';
  end if;
end;
$$;

insert into community_post_editing_results (name, result)
values (
  'first-edit',
  public.edit_own_post(
    '00000000-0000-4000-8000-000000001081',
    '  edited visible post  ',
    ' community-post-edit-new ',
    '  edited-tag  '
  )
);

select 1 / case when exists (
  select 1
  from public.posts
  where id = '00000000-0000-4000-8000-000000001081'
    and user_id = '00000000-0000-4000-8000-000000000108'
    and ip_id = 'community-post-edit-new'
    and text = 'edited visible post'
    and tag = 'edited-tag'
    and image_path = '00000000-0000-4000-8000-000000000108/community/original.png'
    and status = 'visible'
    and created_at = '2026-01-01 00:00:00+00'::timestamptz
    and updated_at > created_at
) then 1 else 0 end as assert_visible_owner_edit_preserves_locked_fields;

select 1 / case when exists (
  select 1
  from community_post_editing_results as edit
  join public.posts as post on post.id = '00000000-0000-4000-8000-000000001081'
  where edit.name = 'first-edit'
    and edit.result ->> 'previousIpId' = 'community-post-edit-old'
    and edit.result ->> 'ipId' = 'community-post-edit-new'
    and (edit.result ->> 'updatedAt')::timestamptz = post.updated_at
) then 1 else 0 end as assert_edit_return_matches_row;

insert into community_post_editing_results (name, result)
values (
  'clear-tag',
  public.edit_own_post(
    '00000000-0000-4000-8000-000000001081',
    'edited without tag',
    'community-post-edit-new',
    '   '
  )
);

select 1 / case when (
  select tag is null
  from public.posts
  where id = '00000000-0000-4000-8000-000000001081'
) then 1 else 0 end as assert_blank_tag_becomes_null;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000118', true);

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000001081',
      'other user edit',
      'community-post-edit-old',
      null
    );
  exception
    when insufficient_privilege then return;
  end;

  raise exception 'non-owner edit should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000108', true);

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000001082',
      'hidden edit',
      'community-post-edit-old',
      null
    );
  exception
    when insufficient_privilege then return;
  end;

  raise exception 'hidden post edit should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000001081',
      '   ',
      'community-post-edit-old',
      null
    );
  exception
    when invalid_parameter_value then return;
  end;

  raise exception 'empty post text should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000001081',
      'missing IP edit',
      'community-post-edit-missing',
      null
    );
  exception
    when invalid_parameter_value then return;
  end;

  raise exception 'missing IP edit should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000128', true);

select public.admin_hide_community_post(
  '00000000-0000-4000-8000-000000001081',
  null
);

select 1 / case when exists (
  select 1
  from public.posts
  where id = '00000000-0000-4000-8000-000000001081'
    and status = 'hidden'
) then 1 else 0 end as assert_staff_moderation_still_updates_posts;

select 1 / case when exists (
  select 1
  from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000000128'
    and action = 'community_post_hide'
    and target = 'post:00000000-0000-4000-8000-000000001081'
) then 1 else 0 end as assert_staff_moderation_audit_preserved;

rollback;
