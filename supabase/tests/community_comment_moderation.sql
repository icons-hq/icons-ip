\set ON_ERROR_STOP on

begin;

create temporary table comment_moderation_results (
  name text primary key,
  id uuid not null
) on commit drop;
grant all on comment_moderation_results to authenticated;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000001091', 'authenticated', 'authenticated', 'comment-author@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000001092', 'authenticated', 'authenticated', 'post-author@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000001093', 'authenticated', 'authenticated', 'reporter@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000001094', 'authenticated', 'authenticated', 'comment-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000001091', 'comment-author@example.test', 'comment_author', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000001092', 'post-author@example.test', 'post_author', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000001093', 'reporter@example.test', 'comment_reporter', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000001094', 'comment-staff@example.test', 'comment_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.verticals (key, label, color)
values ('comment-moderation-smoke', '댓글 모더레이션 스모크', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, featured)
values ('comment-moderation-ip', '댓글 모더레이션 IP', 'comment-moderation-smoke', false)
on conflict (id) do update set
  title = excluded.title,
  vertical_key = excluded.vertical_key,
  featured = excluded.featured;

insert into public.posts (id, user_id, ip_id, text, status)
values
  ('00000000-0000-4000-8000-000000001095', '00000000-0000-4000-8000-000000001092', 'comment-moderation-ip', 'visible parent post', 'visible'),
  ('00000000-0000-4000-8000-000000001096', '00000000-0000-4000-8000-000000001092', 'comment-moderation-ip', 'hidden parent post', 'hidden'),
  ('00000000-0000-4000-8000-000000001097', '00000000-0000-4000-8000-000000001092', 'comment-moderation-ip', 'post moderation regression', 'visible')
on conflict (id) do update set
  user_id = excluded.user_id,
  ip_id = excluded.ip_id,
  text = excluded.text,
  status = excluded.status;

insert into public.comments (id, post_id, user_id, text, status)
values
  ('00000000-0000-4000-8000-000000001098', '00000000-0000-4000-8000-000000001095', '00000000-0000-4000-8000-000000001091', 'visible public comment', 'visible'),
  ('00000000-0000-4000-8000-000000001099', '00000000-0000-4000-8000-000000001095', '00000000-0000-4000-8000-000000001091', 'secret hidden comment text', 'hidden'),
  ('00000000-0000-4000-8000-000000001100', '00000000-0000-4000-8000-000000001095', '00000000-0000-4000-8000-000000001093', 'target comment to hide', 'visible'),
  ('00000000-0000-4000-8000-000000001101', '00000000-0000-4000-8000-000000001096', '00000000-0000-4000-8000-000000001093', 'hidden comment under hidden post', 'hidden'),
  ('00000000-0000-4000-8000-000000001102', '00000000-0000-4000-8000-000000001097', '00000000-0000-4000-8000-000000001091', 'post regression comment', 'visible')
on conflict (id) do update set
  post_id = excluded.post_id,
  user_id = excluded.user_id,
  text = excluded.text,
  status = excluded.status;

-- Column/default/index and callable security contracts.
select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'comments'
    and column_name = 'status'
    and is_nullable = 'NO'
    and column_default = '''visible''::post_status'
) then 1 else 0 end as assert_comment_status_default_not_null;

insert into public.comments (id, post_id, user_id, text)
values (
  '00000000-0000-4000-8000-000000001103',
  '00000000-0000-4000-8000-000000001095',
  '00000000-0000-4000-8000-000000001091',
  'default status comment'
);

select 1 / case when (
  select status
  from public.comments
  where id = '00000000-0000-4000-8000-000000001103'
) = 'visible' then 1 else 0 end as assert_comment_status_default;

select 1 / case when not exists (
  select 1 from public.comments where status is null
) then 1 else 0 end as assert_comment_status_backfilled;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = 'comments'
    and indexname = 'comments_visible_post_created_idx'
    and indexdef like '%WHERE (status = ''visible''::post_status)%'
) then 1 else 0 end as assert_visible_preview_partial_index;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_hide_community_comment'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_comment_id uuid, target_report_id uuid'
    and proc.prosecdef
    and proc.proconfig = array['search_path=""']
) then 1 else 0 end as assert_hide_comment_security_contract;

select 1 / case when (
  not has_table_privilege('anon', 'public.comments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.comments', 'UPDATE')
  and not has_table_privilege('service_role', 'public.comments', 'UPDATE')
  and not has_function_privilege('anon', 'public.admin_hide_community_comment(uuid,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_hide_community_comment(uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_hide_community_comment(uuid,uuid)', 'execute')
) then 1 else 0 end as assert_hide_comment_acl;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname in ('submit_community_report', 'community_post_reaction_counts')
    and proc.prosecdef
    and proc.proconfig = array['search_path=""']
) = 2 then 1 else 0 end as assert_redefined_function_search_paths;

select 1 / case when (
  not has_function_privilege('anon', 'public.submit_community_report(report_target,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.submit_community_report(report_target,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.submit_community_report(report_target,text,text)', 'execute')
  and has_function_privilege('anon', 'public.community_post_reaction_counts(uuid[],uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.community_post_reaction_counts(uuid[],uuid[])', 'execute')
  and not has_function_privilege('service_role', 'public.community_post_reaction_counts(uuid[],uuid[])', 'execute')
) then 1 else 0 end as assert_redefined_function_acls;

select 1 / case when (
  (
    select pg_catalog.pg_get_functiondef(proc.oid)
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'submit_community_report'
      and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_type report_target, target_id text, reason text'
  ) like '%from public.posts%for share;%from public.comments%for share;%'
  and (
    select pg_catalog.pg_get_functiondef(proc.oid)
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'admin_hide_community_comment'
  ) like '%from public.posts%for update;%from public.comments%for update;%'
) then 1 else 0 end as assert_comment_lock_order_contracts;

-- RLS: public only sees visible comments on visible parents; principals with a
-- moderation relationship retain the raw row for staff review.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select 1 / case when (
  select count(*) from public.comments
  where id in (
    '00000000-0000-4000-8000-000000001098',
    '00000000-0000-4000-8000-000000001099',
    '00000000-0000-4000-8000-000000001101'
  )
) = 1 then 1 else 0 end as assert_guest_comment_visibility;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001091', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select 1 / case when exists (
  select 1 from public.comments where id = '00000000-0000-4000-8000-000000001099'
) then 1 else 0 end as assert_comment_author_can_read_hidden_comment;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001093', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select 1 / case when exists (
  select 1 from public.comments where id = '00000000-0000-4000-8000-000000001101'
) then 1 else 0 end as assert_comment_author_can_read_hidden_comment_under_hidden_parent;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001092', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select 1 / case when (
  select count(*) from public.comments
  where id in (
    '00000000-0000-4000-8000-000000001098',
    '00000000-0000-4000-8000-000000001099',
    '00000000-0000-4000-8000-000000001101'
  )
) = 3 then 1 else 0 end as assert_post_author_can_read_all_child_comments;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001094', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select 1 / case when (
  select count(*) from public.comments
  where id in (
    '00000000-0000-4000-8000-000000001098',
    '00000000-0000-4000-8000-000000001099',
    '00000000-0000-4000-8000-000000001101'
  )
) = 3 then 1 else 0 end as assert_staff_can_read_all_comments;

-- Reports are created while the comment and parent are public.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001091', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into comment_moderation_results (name, id)
select 'matching', (public.submit_community_report(
  'comment',
  '00000000-0000-4000-8000-000000001100',
  'matching report'
)->>'reportId')::uuid;

insert into comment_moderation_results (name, id)
select 'post-regression', (public.submit_community_report(
  'comment',
  '00000000-0000-4000-8000-000000001102',
  'parent post report'
)->>'reportId')::uuid;

reset role;
insert into public.reports (id, target_type, target_id, reporter_id, reason)
values
  ('00000000-0000-4000-8000-000000001104', 'comment', '00000000-0000-4000-8000-000000001098', '00000000-0000-4000-8000-000000001091', 'mismatched report'),
  ('00000000-0000-4000-8000-000000001105', 'comment', '00000000-0000-4000-8000-000000001100', '00000000-0000-4000-8000-000000001091', 'second matching report');

-- Nonstaff, mismatched report, and missing report attempts are atomic.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001093', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.admin_hide_community_comment(
      '00000000-0000-4000-8000-000000001100',
      (select id from comment_moderation_results where name = 'matching')
    );
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'nonstaff comment hide should fail';
end;
$$;

reset role;
select 1 / case when (
  (select status from public.comments where id = '00000000-0000-4000-8000-000000001100') = 'visible'
  and (select status from public.reports where id = (select id from comment_moderation_results where name = 'matching')) = 'open'
  and not exists (select 1 from public.audit_log where action = 'community_comment_hide')
) then 1 else 0 end as assert_nonstaff_attempt_atomic;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001094', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.admin_hide_community_comment(
      '00000000-0000-4000-8000-000000001100',
      '00000000-0000-4000-8000-000000001104'
    );
  exception when invalid_parameter_value then
    return;
  end;
  raise exception 'mismatched comment report should fail';
end;
$$;

do $$
begin
  begin
    perform public.admin_hide_community_comment(
      '00000000-0000-4000-8000-000000001100',
      '00000000-0000-4000-8000-000000001199'
    );
  exception when invalid_parameter_value then
    return;
  end;
  raise exception 'missing comment report should fail';
end;
$$;

do $$
begin
  begin
    perform public.admin_hide_community_comment(
      '00000000-0000-4000-8000-000000001198',
      (select id from comment_moderation_results where name = 'matching')
    );
  exception when invalid_parameter_value then
    return;
  end;
  raise exception 'missing comment should fail';
end;
$$;

reset role;
select 1 / case when (
  (select status from public.comments where id = '00000000-0000-4000-8000-000000001100') = 'visible'
  and (select status from public.reports where id = '00000000-0000-4000-8000-000000001104') = 'open'
  and (select status from public.reports where id = (select id from comment_moderation_results where name = 'matching')) = 'open'
  and not exists (select 1 from public.audit_log where action = 'community_comment_hide')
) then 1 else 0 end as assert_invalid_report_attempts_atomic;

-- Success resolves the exact report, writes one PII-free audit, returns its IP,
-- and a replay does not duplicate the audit.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001094', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select 1 / case when (
  public.admin_hide_community_comment(
    '00000000-0000-4000-8000-000000001100',
    (select id from comment_moderation_results where name = 'matching')
  )->>'ipId'
) = 'comment-moderation-ip' then 1 else 0 end as assert_hide_returns_ip;

select public.admin_hide_community_comment(
  '00000000-0000-4000-8000-000000001100',
  (select id from comment_moderation_results where name = 'matching')
);

reset role;
select 1 / case when (
  (select status from public.comments where id = '00000000-0000-4000-8000-000000001100') = 'hidden'
  and (select status from public.reports where id = (select id from comment_moderation_results where name = 'matching')) = 'resolved'
  and (
    select count(*) from public.audit_log
    where action = 'community_comment_hide'
      and target = 'comment:00000000-0000-4000-8000-000000001100'
      and diff = jsonb_build_object(
        'from', 'visible',
        'to', 'hidden',
        'reportId', (select id from comment_moderation_results where name = 'matching')
      )
  ) = 1
  and not exists (
    select 1 from public.audit_log
    where action = 'community_comment_hide'
      and (diff::text ilike '%secret%' or diff::text ilike '%example.test%')
  )
) then 1 else 0 end as assert_hide_comment_transaction_and_audit;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001094', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.admin_hide_community_comment(
      '00000000-0000-4000-8000-000000001100',
      '00000000-0000-4000-8000-000000001105'
    );
  exception when invalid_parameter_value then
    return;
  end;
  raise exception 'a new open report for an already-hidden comment should fail';
end;
$$;

reset role;
select 1 / case when (
  (select status from public.reports where id = '00000000-0000-4000-8000-000000001105') = 'open'
  and (
    select count(*) from public.audit_log
    where action = 'community_comment_hide'
      and target = 'comment:00000000-0000-4000-8000-000000001100'
  ) = 1
) then 1 else 0 end as assert_hidden_comment_new_report_is_atomic;

-- Hidden comments cannot be reported again and never contribute to counts.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001091', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    perform public.submit_community_report(
      'comment',
      '00000000-0000-4000-8000-000000001100',
      'hidden replay report'
    );
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'hidden comment reporting should fail';
end;
$$;

select 1 / case when (
  select comments_count
  from public.community_post_reaction_counts(
    array['00000000-0000-4000-8000-000000001095'::uuid],
    array['00000000-0000-4000-8000-000000001091'::uuid]
  )
  where post_id = '00000000-0000-4000-8000-000000001095'
) = 0 then 1 else 0 end as assert_hidden_and_blocked_comments_excluded_from_count;

-- Existing parent-post moderation/report coupling remains valid.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001094', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.admin_hide_community_post(
  '00000000-0000-4000-8000-000000001097',
  (select id from comment_moderation_results where name = 'post-regression')
);

select 1 / case when (
  (select status from public.posts where id = '00000000-0000-4000-8000-000000001097') = 'hidden'
  and (select status from public.reports where id = (select id from comment_moderation_results where name = 'post-regression')) = 'resolved'
) then 1 else 0 end as assert_parent_post_hide_regression;

rollback;
