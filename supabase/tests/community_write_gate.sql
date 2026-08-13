\set ON_ERROR_STOP on

begin;

create temporary table community_write_gate_results (
  name text primary key,
  result jsonb not null
) on commit drop;
grant all on community_write_gate_results to authenticated;

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
  ('00000000-0000-4000-8000-000000001201', 'authenticated', 'authenticated', 'write-gate-author@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000001202', 'authenticated', 'authenticated', 'write-gate-other@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000001203', 'authenticated', 'authenticated', 'write-gate-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000001201', 'write-gate-author@example.test', 'write_gate_author', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000001202', 'write-gate-other@example.test', 'write_gate_other', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000001203', 'write-gate-staff@example.test', 'write_gate_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role,
  suspended_at = null,
  suspension_reason = null;

insert into public.verticals (key, label, color)
values ('community-write-gate', '커뮤니티 쓰기 게이트', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, featured)
values ('community-write-gate-ip', '쓰기 게이트 IP', 'community-write-gate', false)
on conflict (id) do update set
  title = excluded.title,
  vertical_key = excluded.vertical_key,
  featured = excluded.featured,
  archived_at = null;

-- Database-owner fixture writes remain possible for migrations and smoke setup.
-- Application roles and SECURITY DEFINER RPCs are exercised below.
insert into public.posts (id, user_id, ip_id, text, status)
values
  ('00000000-0000-4000-8000-000000001211', '00000000-0000-4000-8000-000000001201', 'community-write-gate-ip', 'public target post', 'visible'),
  ('00000000-0000-4000-8000-000000001212', '00000000-0000-4000-8000-000000001201', 'community-write-gate-ip', 'owner deletion post', 'visible')
on conflict (id) do update set
  user_id = excluded.user_id,
  ip_id = excluded.ip_id,
  text = excluded.text,
  status = excluded.status;

insert into public.comments (id, post_id, user_id, text, status)
values
  ('00000000-0000-4000-8000-000000001221', '00000000-0000-4000-8000-000000001211', '00000000-0000-4000-8000-000000001202', 'moderation target comment', 'visible'),
  ('00000000-0000-4000-8000-000000001222', '00000000-0000-4000-8000-000000001212', '00000000-0000-4000-8000-000000001201', 'owner deletion comment', 'visible')
on conflict (id) do update set
  post_id = excluded.post_id,
  user_id = excluded.user_id,
  text = excluded.text,
  status = excluded.status;

-- Existing community objects remain readable/deletable while new uploads are
-- closed. This row represents an object written before the gate was applied.
insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001201/community/33333333-3333-4333-8333-333333333333.png',
  '00000000-0000-4000-8000-000000001201'
);

set local role service_role;
select 1 / case when public.service_prepare_profile_avatar_claim(
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001201/profile/44444444-4444-4444-8444-444444444444.png'
) then 1 else 0 end as assert_avatar_claim_prepared;
reset role;

-- The authoritative setting is private, RLS-protected, and has no Data API
-- mutation/read grant. Enabling writes therefore requires a reviewed migration.
select 1 / case when exists (
  select 1
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'private'
    and relation.relname = 'community_write_control'
    and relation.relkind = 'r'
    and relation.relrowsecurity
) then 1 else 0 end as assert_private_control_table_rls;

select 1 / case when (
  not has_table_privilege('anon', 'private.community_write_control', 'SELECT')
  and not has_table_privilege('anon', 'private.community_write_control', 'UPDATE')
  and not has_table_privilege('authenticated', 'private.community_write_control', 'SELECT')
  and not has_table_privilege('authenticated', 'private.community_write_control', 'UPDATE')
  and not has_table_privilege('service_role', 'private.community_write_control', 'SELECT')
  and not has_table_privilege('service_role', 'private.community_write_control', 'UPDATE')
) then 1 else 0 end as assert_private_control_table_acl;

select 1 / case when (
  select count(*) = 1
  from private.community_write_control as control
  where control.singleton
    and not control.post_create_enabled
    and not control.post_edit_enabled
    and not control.comment_create_enabled
    and not control.comment_edit_enabled
) then 1 else 0 end as assert_all_community_writes_default_off;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'community_write_capabilities'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
    and procedure.prosecdef
    and procedure.proconfig = array['search_path=""']
) then 1 else 0 end as assert_capability_function_security_contract;

select 1 / case when (
  select count(*) = 1
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname = 'guard_community_write'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
    and procedure.prosecdef
    and procedure.proconfig = array['search_path=""']
) then 1 else 0 end as assert_single_community_write_guard_contract;

select 1 / case when (
  pg_catalog.to_regprocedure('private.guard_community_post_write()') is null
  and pg_catalog.to_regprocedure('private.guard_community_comment_write()') is null
) then 1 else 0 end as assert_legacy_community_write_guards_removed;

select 1 / case when (
  select count(*) = 2
    and bool_and(trigger.tgfoid = pg_catalog.to_regprocedure('private.guard_community_write()'))
  from pg_catalog.pg_trigger as trigger
  where trigger.tgrelid in ('public.posts'::regclass, 'public.comments'::regclass)
    and trigger.tgname in (
      'trg_community_write_gate_posts',
      'trg_community_write_gate_comments'
    )
) then 1 else 0 end as assert_community_write_triggers_share_one_guard;

select 1 / case when (
  has_function_privilege('anon', 'public.community_write_capabilities()', 'execute')
  and has_function_privilege('authenticated', 'public.community_write_capabilities()', 'execute')
  and not has_function_privilege('service_role', 'public.community_write_capabilities()', 'execute')
  and not has_function_privilege('anon', 'private.guard_community_write()', 'execute')
  and not has_function_privilege('authenticated', 'private.guard_community_write()', 'execute')
  and not has_function_privilege('service_role', 'private.guard_community_write()', 'execute')
  and not has_function_privilege('anon', 'private.can_write_community_storage_object(text)', 'execute')
  and has_function_privilege('authenticated', 'private.can_write_community_storage_object(text)', 'execute')
  and not has_function_privilege('service_role', 'private.can_write_community_storage_object(text)', 'execute')
) then 1 else 0 end as assert_write_gate_function_acls;

select 1 / case when (
  select count(*) = 2
    and bool_and(not policy.polpermissive)
    and bool_and(policy.polroles = array['authenticated'::regrole::oid])
    and bool_and(policy.polcmd in ('a', 'w'))
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'storage.objects'::regclass
    and policy.polname in (
      'user_uploads_community_write_gate_insert',
      'user_uploads_community_write_gate_update'
    )
) then 1 else 0 end as assert_community_storage_restrictive_policies;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select 1 / case when public.community_write_capabilities() = jsonb_build_object(
  'postCreate', false,
  'postEdit', false,
  'commentCreate', false,
  'commentEdit', false
) then 1 else 0 end as assert_public_capabilities_are_off;

select 1 / case when exists (
  select 1
  from public.posts
  where id = '00000000-0000-4000-8000-000000001211'
    and status = 'visible'
) then 1 else 0 end as assert_public_read_remains_available;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-uploads',
      '00000000-0000-4000-8000-000000001201/community/55555555-5555-4555-8555-555555555555.png',
      '00000000-0000-4000-8000-000000001201'
    );
  exception
    when insufficient_privilege then return;
  end;

  raise exception 'community Storage insert must be disabled';
end;
$$;

do $$
begin
  update storage.objects
  set metadata = '{"must":"stay blocked"}'::jsonb
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/community/33333333-3333-4333-8333-333333333333.png';

  if found then
    raise exception 'community Storage update must be disabled';
  end if;
end;
$$;

insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001201/profile/44444444-4444-4444-8444-444444444444.png',
  '00000000-0000-4000-8000-000000001201'
);

select 1 / case when exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/community/33333333-3333-4333-8333-333333333333.png'
) and exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/profile/44444444-4444-4444-8444-444444444444.png'
) then 1 else 0 end as assert_existing_read_and_avatar_insert_remain_available;

-- Match the Storage service's guarded delete transaction while exercising the
-- authenticated owner RLS policy directly.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'user-uploads'
  and name = '00000000-0000-4000-8000-000000001201/community/33333333-3333-4333-8333-333333333333.png';

select 1 / case when not exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/community/33333333-3333-4333-8333-333333333333.png'
) then 1 else 0 end as assert_existing_community_storage_delete_remains_available;

do $$
begin
  begin
    insert into public.posts (user_id, ip_id, text)
    values (
      '00000000-0000-4000-8000-000000001201',
      'community-write-gate-ip',
      'must stay disabled'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'community_writes_disabled' then
        return;
      end if;
      raise;
  end;

  raise exception 'direct post creation must be disabled';
end;
$$;

do $$
begin
  begin
    perform public.create_post_comment(
      '00000000-0000-4000-8000-000000001211',
      'must stay disabled'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'community_writes_disabled' then
        return;
      end if;
      raise;
  end;

  raise exception 'comment creation RPC must be disabled';
end;
$$;

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000001211',
      'must stay disabled',
      'community-write-gate-ip',
      null
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'community_writes_disabled' then
        return;
      end if;
      raise;
  end;

  raise exception 'post edit RPC must be disabled';
end;
$$;

-- Like, report, block, and owner deletion remain available while writes are off.
select public.set_post_like('00000000-0000-4000-8000-000000001211', true);
select 1 / case when exists (
  select 1
  from public.likes
  where post_id = '00000000-0000-4000-8000-000000001211'
    and user_id = '00000000-0000-4000-8000-000000001201'
) then 1 else 0 end as assert_like_remains_available;

insert into community_write_gate_results (name, result)
values (
  'report',
  public.submit_community_report(
    'post',
    '00000000-0000-4000-8000-000000001211',
    'write gate report smoke'
  )
);

select 1 / case when exists (
  select 1
  from community_write_gate_results as result
  join public.reports as report
    on report.id = (result.result ->> 'reportId')::uuid
  where result.name = 'report'
    and report.target_type = 'post'
    and report.target_id = '00000000-0000-4000-8000-000000001211'
) then 1 else 0 end as assert_report_remains_available;

select public.block_community_user('00000000-0000-4000-8000-000000001202');
select 1 / case when exists (
  select 1
  from public.blocks
  where user_id = '00000000-0000-4000-8000-000000001201'
    and blocked_user_id = '00000000-0000-4000-8000-000000001202'
) then 1 else 0 end as assert_block_remains_available;

select public.delete_own_comment('00000000-0000-4000-8000-000000001222');
select public.delete_own_post('00000000-0000-4000-8000-000000001212');
select 1 / case when (
  not exists (
    select 1 from public.comments
    where id = '00000000-0000-4000-8000-000000001222'
  )
  and not exists (
    select 1 from public.posts
    where id = '00000000-0000-4000-8000-000000001212'
  )
) then 1 else 0 end as assert_owner_deletion_remains_available;

-- Moderation status-only updates remain available to active staff.
reset role;
alter table public.posts disable trigger trg_community_write_gate_posts;
alter table public.comments disable trigger trg_community_write_gate_comments;
update public.posts
set status = 'visible', text = 'public target post'
where id = '00000000-0000-4000-8000-000000001211';
update public.comments
set status = 'visible', text = 'moderation target comment'
where id = '00000000-0000-4000-8000-000000001221';
alter table public.posts enable trigger trg_community_write_gate_posts;
alter table public.comments enable trigger trg_community_write_gate_comments;

create function public.__community_write_gate_test_hide_post_with_text(target_post_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.posts
  set status = 'hidden', text = 'moderator must not rewrite content'
  where id = target_post_id;
$$;

create function public.__community_write_gate_test_hide_comment_with_text(target_comment_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.comments
  set status = 'hidden', text = 'moderator must not rewrite content'
  where id = target_comment_id;
$$;

revoke all on function public.__community_write_gate_test_hide_post_with_text(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.__community_write_gate_test_hide_post_with_text(uuid)
  to authenticated;
revoke all on function public.__community_write_gate_test_hide_comment_with_text(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.__community_write_gate_test_hide_comment_with_text(uuid)
  to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001203', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    perform public.__community_write_gate_test_hide_post_with_text(
      '00000000-0000-4000-8000-000000001211'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'community_writes_disabled' then
        return;
      end if;
      raise;
  end;

  raise exception 'post moderation hide must not bypass content edit gate';
end;
$$;

do $$
begin
  begin
    perform public.__community_write_gate_test_hide_comment_with_text(
      '00000000-0000-4000-8000-000000001221'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'community_writes_disabled' then
        return;
      end if;
      raise;
  end;

  raise exception 'comment moderation hide must not bypass content edit gate';
end;
$$;

select public.admin_hide_community_comment(
  '00000000-0000-4000-8000-000000001221',
  null
);
select public.admin_hide_community_post(
  '00000000-0000-4000-8000-000000001211',
  null
);

select 1 / case when (
  (select status from public.comments where id = '00000000-0000-4000-8000-000000001221') = 'hidden'
  and (select status from public.posts where id = '00000000-0000-4000-8000-000000001211') = 'hidden'
) then 1 else 0 end as assert_moderation_hide_remains_available;

-- A future reviewed activation migration can enable post uploads without
-- exposing a runtime toggle to application roles.
reset role;
update private.community_write_control
set post_create_enabled = true;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001201/community/66666666-6666-4666-8666-666666666666.png',
  '00000000-0000-4000-8000-000000001201'
);

select 1 / case when exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/community/66666666-6666-4666-8666-666666666666.png'
) then 1 else 0 end as assert_approved_migration_can_enable_community_storage_insert;

rollback;
