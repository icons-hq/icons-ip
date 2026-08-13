\set ON_ERROR_STOP on

begin;

update private.community_write_control
set
  post_create_enabled = true,
  post_edit_enabled = true,
  comment_create_enabled = true;

-- ---------------------------------------------------------------------------
-- Schema, callable boundaries, and least-privilege profile reads.
-- ---------------------------------------------------------------------------
select 1 / case when (
  select count(*)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name in ('suspended_at', 'suspension_reason')
) = 2 then 1 else 0 end as assert_profile_suspension_columns_exist;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'public.profiles'::regclass
    and conname = 'profiles_suspension_state_check'
    and convalidated
) then 1 else 0 end as assert_profile_suspension_constraint;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = 'profiles'
    and indexname = 'profiles_suspended_at_idx'
    and indexdef like '%WHERE (suspended_at IS NOT NULL)%'
) then 1 else 0 end as assert_profile_suspension_partial_index;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = 'reports'
    and indexname = 'reports_reporter_id_idx'
    and indexdef like '%(reporter_id)%'
) then 1 else 0 end as assert_reports_reporter_index;

select 1 / case when (
  not has_table_privilege('authenticated', 'public.profiles', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'id', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'nickname', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'birth_date', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'role', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'consents', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'onboarded_at', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'created_at', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'suspended_at', 'SELECT')
  and not has_column_privilege('authenticated', 'public.profiles', 'suspension_reason', 'SELECT')
) then 1 else 0 end as assert_profile_column_select_contract;

select 1 / case when not exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'public_profiles'
    and column_name in ('suspended_at', 'suspension_reason')
) then 1 else 0 end as assert_public_profiles_unchanged;

select 1 / case when (
  to_regclass('private.report_subjects') is not null
  and not has_table_privilege('anon', 'private.report_subjects', 'SELECT')
  and not has_table_privilege('authenticated', 'private.report_subjects', 'SELECT')
  and not has_table_privilege('service_role', 'private.report_subjects', 'SELECT')
  and exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.reports'::regclass
      and tgname = 'trg_reports_capture_subject'
      and not tgisinternal
  )
  and exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'private'
      and tablename = 'report_subjects'
      and indexname = 'report_subjects_target_user_id_idx'
      and indexdef like '%(target_user_id)%'
  )
) then 1 else 0 end as assert_private_report_subject_contract;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname in (
      'is_staff',
      'admin_profile_signup_counts',
      'admin_search_members',
      'admin_get_member_detail',
      'admin_suspend_user',
      'admin_unsuspend_user',
      'admin_set_user_role'
    )
    and proc.prosecdef
    and proc.proconfig = array['search_path=""']
) = 7 then 1 else 0 end as assert_public_function_security_contracts;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'public.profiles'::regclass
    and policy.polname = 'profiles_read'
    and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      = '(( SELECT auth.uid() AS uid) = id)'
) then 1 else 0 end as assert_profile_read_policy_is_self_only;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'private'
    and proc.proname in (
      'assert_active_user',
      'capture_report_subject',
      'guard_active_user_insert',
      'guard_active_post_author_update',
      'guard_active_draw_ticket_consumption',
      'guard_active_check_in_staff'
    )
    and proc.prosecdef
    and proc.proconfig = array['search_path=""']
) = 6 then 1 else 0 end as assert_private_guard_security_contracts;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'private'
    and proc.proname = 'assert_active_user'
    and proc.provolatile = 'v'
    and pg_catalog.pg_get_functiondef(proc.oid) ilike '%for share%'
) then 1 else 0 end as assert_active_guard_serializes_with_suspension;

select 1 / case when (
  has_function_privilege('anon', 'public.is_staff()', 'execute')
  and has_function_privilege('authenticated', 'public.is_staff()', 'execute')
  and has_function_privilege('service_role', 'public.is_staff()', 'execute')
  and not has_function_privilege('anon', 'private.assert_active_user(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.assert_active_user(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.assert_active_user(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.guard_active_user_insert()', 'execute')
  and not has_function_privilege('authenticated', 'private.guard_active_user_insert()', 'execute')
  and not has_function_privilege('service_role', 'private.guard_active_user_insert()', 'execute')
  and not has_function_privilege('anon', 'private.capture_report_subject()', 'execute')
  and not has_function_privilege('authenticated', 'private.capture_report_subject()', 'execute')
  and not has_function_privilege('service_role', 'private.capture_report_subject()', 'execute')
) then 1 else 0 end as assert_staff_and_private_guard_acls;

select 1 / case when (
  not has_function_privilege('anon', 'public.admin_search_members(text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_search_members(text,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_search_members(text,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_member_detail(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_get_member_detail(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_get_member_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_suspend_user(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_suspend_user(uuid,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_suspend_user(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_unsuspend_user(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_unsuspend_user(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_unsuspend_user(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_profile_signup_counts(timestamp with time zone,timestamp with time zone,timestamp with time zone)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_profile_signup_counts(timestamp with time zone,timestamp with time zone,timestamp with time zone)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_profile_signup_counts(timestamp with time zone,timestamp with time zone,timestamp with time zone)', 'execute')
) then 1 else 0 end as assert_member_rpc_acls;

select 1 / case when (
  select pg_catalog.pg_get_function_result(proc.oid)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_get_member_detail'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_profile_id uuid'
) not ilike '%onboarded_at%' then 1 else 0 end as assert_member_detail_excludes_unrequested_onboarding_field;

-- ---------------------------------------------------------------------------
-- Principals and summary fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000011101', 'authenticated', 'authenticated', 'member-admin@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011102', 'authenticated', 'authenticated', 'member-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011103', 'authenticated', 'authenticated', 'detail-user@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011104', 'authenticated', 'authenticated', 'blocked-user@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011105', 'authenticated', 'authenticated', 'other-admin@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011106', 'authenticated', 'authenticated', 'target-staff@example.test', now(), '{}', '{}', now(), now()),
  ('12345678-0000-4000-8000-000000011107', 'authenticated', 'authenticated', 'pending-onboarding@example.test', now(), '{}', '{}', now(), now()),
  ('87654321-0000-4000-8000-000000011108', 'authenticated', 'authenticated', null, now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role
)
values
  ('00000000-0000-4000-8000-000000011101', 'member-admin@example.test', 'member_admin', '2000-01-01', '{"terms":true,"privacy":true,"marketing":false}'::jsonb, now(), 'admin'),
  ('00000000-0000-4000-8000-000000011102', 'member-staff@example.test', 'member_staff', '2000-01-01', '{"terms":true,"privacy":true,"marketing":false}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-000000011103', 'detail-user@example.test', 'detail_user', '2000-01-01', '{"terms":true,"privacy":true,"marketing":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000011104', 'blocked-user@example.test', 'blocked_user', '2000-01-01', '{"terms":true,"privacy":true,"marketing":false}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-000000011105', 'other-admin@example.test', 'other_admin', '2000-01-01', '{"terms":true,"privacy":true,"marketing":false}'::jsonb, now(), 'admin'),
  ('00000000-0000-4000-8000-000000011106', 'target-staff@example.test', 'target_staff', '2000-01-01', '{"terms":true,"privacy":true,"marketing":false}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role,
  suspended_at = null,
  suspension_reason = null;

update public.profiles
set created_at = case id
  when '12345678-0000-4000-8000-000000011107'::uuid then '2099-01-15 00:00:00+00'::timestamptz
  when '87654321-0000-4000-8000-000000011108'::uuid then '2099-02-15 00:00:00+00'::timestamptz
  else created_at
end
where id in (
  '12345678-0000-4000-8000-000000011107',
  '87654321-0000-4000-8000-000000011108'
);

insert into public.verticals (key, label, color)
values ('member-suspension', '회원 정지 스모크', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, featured)
values ('member-suspension-ip', '회원 정지 IP', 'member-suspension', false)
on conflict (id) do update set title = excluded.title, vertical_key = excluded.vertical_key;

insert into public.goods (
  id, ip_id, name, type, price, stock, stock_qty
)
values (
  'member-suspension-good', 'member-suspension-ip', '회원 정지 굿즈',
  '테스트', 1000, 'ok', 10
)
on conflict (id) do update set stock_qty = excluded.stock_qty, stock = excluded.stock;

insert into public.events (id, ip_id, title, mode, status)
values (
  'member-suspension-event', 'member-suspension-ip', '회원 정지 이벤트',
  '온라인', '예매중'
)
on conflict (id) do update set status = excluded.status;

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit, sales_open_at
)
values (
  '00000000-0000-4000-8000-000000011121',
  'member-suspension-event',
  '회원 정지 티켓',
  1000,
  10,
  0,
  4,
  now() - interval '1 day'
)
on conflict (id) do update set sold = 0, capacity = 10, per_user_limit = 4;

insert into public.orders (id, user_id, status, total, address, checkout_key)
values
  ('00000000-0000-4000-8000-000000011141', '00000000-0000-4000-8000-000000011103', 'pending', 1000, '{}'::jsonb, '00000000-0000-4000-8000-000000011161'),
  ('00000000-0000-4000-8000-000000011142', '00000000-0000-4000-8000-000000011103', 'paid', 2000, '{}'::jsonb, '00000000-0000-4000-8000-000000011162')
on conflict (id) do nothing;

insert into public.ticket_orders (
  id, user_id, event_id, status, total, reservation_key
)
values (
  '00000000-0000-4000-8000-000000011143',
  '00000000-0000-4000-8000-000000011103',
  'member-suspension-event',
  'paid',
  1000,
  '00000000-0000-4000-8000-000000011163'
)
on conflict (id) do nothing;

insert into public.posts (id, user_id, ip_id, text, status)
values
  ('00000000-0000-4000-8000-000000011131', '00000000-0000-4000-8000-000000011103', 'member-suspension-ip', 'detail report target', 'visible'),
  ('00000000-0000-4000-8000-000000011132', '00000000-0000-4000-8000-000000011104', 'member-suspension-ip', 'blocked user existing post', 'visible'),
  ('00000000-0000-4000-8000-000000011133', '00000000-0000-4000-8000-000000011102', 'member-suspension-ip', 'comment target post', 'visible'),
  ('00000000-0000-4000-8000-000000011135', '00000000-0000-4000-8000-000000011104', 'member-suspension-ip', 'suspended author delete relief', 'visible')
on conflict (id) do update set text = excluded.text, status = excluded.status;

insert into public.comments (id, post_id, user_id, text, status)
values
  (
    '00000000-0000-4000-8000-000000011134',
    '00000000-0000-4000-8000-000000011133',
    '00000000-0000-4000-8000-000000011103',
    'detail comment report target',
    'visible'
  ),
  (
    '00000000-0000-4000-8000-000000011136',
    '00000000-0000-4000-8000-000000011133',
    '00000000-0000-4000-8000-000000011104',
    'suspended comment delete relief',
    'visible'
  )
on conflict (id) do update set text = excluded.text, status = excluded.status;

insert into public.reports (id, target_type, target_id, reporter_id, reason, status)
values
  ('00000000-0000-4000-8000-000000011151', 'user', '00000000-0000-4000-8000-000000011104', '00000000-0000-4000-8000-000000011103', 'submitted report', 'open'),
  ('00000000-0000-4000-8000-000000011152', 'user', '00000000-0000-4000-8000-000000011103', '00000000-0000-4000-8000-000000011102', 'direct received report', 'open'),
  ('00000000-0000-4000-8000-000000011153', 'post', '00000000-0000-4000-8000-000000011131', '00000000-0000-4000-8000-000000011102', 'post received report', 'open'),
  ('00000000-0000-4000-8000-000000011154', 'comment', '00000000-0000-4000-8000-000000011134', '00000000-0000-4000-8000-000000011102', 'comment received report', 'open')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Search is masked; detail is explicit and limited to the approved summary.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011102', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when (
  (select count(*) from public.profiles) = 1
  and exists (
    select 1
    from public.profiles
    where id = '00000000-0000-4000-8000-000000011102'
  )
) then 1 else 0 end as assert_staff_direct_profile_read_is_self_only;

select 1 / case when exists (
  select 1
  from public.admin_profile_signup_counts(
    '2099-01-01 00:00:00+00',
    '2099-02-01 00:00:00+00',
    '2099-03-01 00:00:00+00'
  ) as counts
  where counts.previous_count = 1
    and counts.current_count = 1
) then 1 else 0 end as assert_admin_profile_signup_counts_are_pii_free;

select 1 / case when exists (
  select 1
  from public.admin_search_members(
    target_query => 'detail-user@example.test'
  ) as member
  where member.profile_id = '00000000-0000-4000-8000-000000011103'
    and member.nickname = 'detail_user'
    and member.masked_email = 'd***@example.test'
    and member.masked_email <> 'detail-user@example.test'
    and member.role = 'user'
    and member.suspended_at is null
    and member.total_count = 1
) then 1 else 0 end as assert_member_search_is_masked;

select 1 / case when exists (
  select 1
  from public.admin_search_members(
    target_query => 'pending-onboarding@example.test'
  ) as member
  where member.profile_id = '12345678-0000-4000-8000-000000011107'
    and member.nickname = 'fan_123456'
    and member.masked_email = 'p***@example.test'
    and member.total_count = 1
) then 1 else 0 end as assert_pending_onboarding_search_has_nickname_fallback;

select 1 / case when exists (
  select 1
  from public.admin_search_members(target_query => null) as member
  where member.profile_id = '87654321-0000-4000-8000-000000011108'
    and member.nickname = 'fan_876543'
    and member.masked_email = '이메일 없음'
) then 1 else 0 end as assert_null_identity_fields_have_list_fallbacks;

select 1 / case when exists (
  select 1
  from public.admin_get_member_detail('00000000-0000-4000-8000-000000011103') as member
  where member.email = 'detail-user@example.test'
    and member.nickname = 'detail_user'
    and member.role = 'user'
    and member.consents = '{"terms":true,"privacy":true,"marketing":true}'::jsonb
    and member.suspension_reason is null
    and member.goods_order_count = 2
    and member.ticket_order_count = 1
    and member.submitted_report_count = 1
    and member.received_report_count = 3
) then 1 else 0 end as assert_member_detail_summary;

select 1 / case when exists (
  select 1
  from public.admin_get_member_detail('12345678-0000-4000-8000-000000011107') as member
  where member.nickname = 'fan_123456'
    and member.email = 'pending-onboarding@example.test'
) then 1 else 0 end as assert_pending_onboarding_detail_has_nickname_fallback;

select 1 / case when exists (
  select 1
  from public.admin_get_member_detail('87654321-0000-4000-8000-000000011108') as member
  where member.nickname = 'fan_876543'
    and member.email = '이메일 없음'
) then 1 else 0 end as assert_null_identity_fields_have_detail_fallbacks;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011103', true);
select public.delete_own_comment('00000000-0000-4000-8000-000000011134');
select public.delete_own_post('00000000-0000-4000-8000-000000011131');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011102', true);
select 1 / case when exists (
  select 1
  from public.admin_get_member_detail('00000000-0000-4000-8000-000000011103') as member
  where member.received_report_count = 3
) then 1 else 0 end as assert_received_report_count_survives_author_deletion;

-- Replacing posts_insert must preserve the pre-existing upload ownership
-- boundary in addition to the new active-profile check.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011103', true);

do $$
begin
  begin
    insert into public.posts (id, user_id, ip_id, text, image_path)
    values (
      '00000000-0000-4000-8000-000000011137',
      '00000000-0000-4000-8000-000000011103',
      'member-suspension-ip',
      'foreign image path attempt',
      '00000000-0000-4000-8000-000000011104/community/33333333-3333-4333-8333-333333333333.png'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'active user must not attach another user upload path';
end;
$$;

select 1 / case when not exists (
  select 1
  from public.posts
  where id = '00000000-0000-4000-8000-000000011137'
) then 1 else 0 end as assert_foreign_post_image_path_is_rejected;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011103', true);

do $$
begin
  begin
    perform public.admin_search_members(null, 20, 0);
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'nonstaff member search should be rejected';
end;
$$;

-- ---------------------------------------------------------------------------
-- Audited, idempotent suspension transitions and role hierarchy guards.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011102', true);

select 1 / case when (
  public.admin_suspend_user(
    '00000000-0000-4000-8000-000000011103',
    '  internal reason  '
  ) ->> 'changed'
)::boolean then 1 else 0 end as assert_staff_can_suspend_user;

select 1 / case when exists (
  select 1
  from public.admin_get_member_detail('00000000-0000-4000-8000-000000011103') as member
  where member.suspended_at is not null
) then 1 else 0 end as assert_user_is_suspended;

select 1 / case when not (
  public.admin_suspend_user(
    '00000000-0000-4000-8000-000000011103',
    'internal reason'
  ) ->> 'changed'
)::boolean then 1 else 0 end as assert_suspend_replay_is_noop;

select 1 / case when exists (
  select 1
  from public.admin_get_member_detail('00000000-0000-4000-8000-000000011103') as member
  where member.suspension_reason = 'internal reason'
    and member.suspended_at is not null
) then 1 else 0 end as assert_internal_reason_visible_only_in_detail_rpc;

do $$
begin
  begin
    perform public.admin_suspend_user(
      '00000000-0000-4000-8000-000000011102',
      'self attempt'
    );
  exception
    when invalid_parameter_value then return;
  end;
  raise exception 'self suspension should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_suspend_user(
      '00000000-0000-4000-8000-000000011105',
      'admin target attempt'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'admin target suspension should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_suspend_user(
      '00000000-0000-4000-8000-000000011106',
      'staff target attempt'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'staff actor should not suspend another staff member';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011104', true);

do $$
begin
  begin
    perform public.admin_suspend_user(
      '00000000-0000-4000-8000-000000011103',
      'nonstaff attempt'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'nonstaff suspension should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011101', true);

do $$
begin
  begin
    perform public.admin_set_user_role(
      '00000000-0000-4000-8000-000000011103',
      'staff'::public.user_role
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended user privileged-role promotion should be rejected';
end;
$$;

select public.admin_suspend_user(
  '00000000-0000-4000-8000-000000011106',
  'suspended staff fixture'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011106', true);
select 1 / case when not public.is_staff() then 1 else 0 end as assert_suspended_staff_is_not_staff;

do $$
begin
  begin
    perform public.admin_search_members(null, 20, 0);
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'suspended staff member search should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011101', true);
select 1 / case when (
  public.admin_unsuspend_user('00000000-0000-4000-8000-000000011106') ->> 'changed'
)::boolean then 1 else 0 end as assert_admin_can_unsuspend_staff;

select 1 / case when (
  public.admin_suspend_user(
    '00000000-0000-4000-8000-000000011106',
    'suspended staff fixture'
  ) ->> 'changed'
)::boolean then 1 else 0 end as assert_admin_can_resuspend_staff;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011102', true);
select 1 / case when (
  public.admin_unsuspend_user('00000000-0000-4000-8000-000000011103') ->> 'changed'
)::boolean then 1 else 0 end as assert_staff_can_unsuspend_user;

select 1 / case when not (
  public.admin_unsuspend_user('00000000-0000-4000-8000-000000011103') ->> 'changed'
)::boolean then 1 else 0 end as assert_unsuspend_replay_is_noop;

reset role;

select 1 / case when (
  select count(*)
  from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000011102'
    and action in ('admin.member.suspended', 'admin.member.unsuspended')
    and target = 'profile:00000000-0000-4000-8000-000000011103'
) = 2 then 1 else 0 end as assert_actual_transitions_audited_once;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where action in ('admin.member.suspended', 'admin.member.unsuspended')
    and (
      diff::text ilike '%internal reason%'
      or diff::text ilike '%example.test%'
      or diff::text ilike '%detail_user%'
    )
) then 1 else 0 end as assert_suspension_audit_is_pii_free;

-- A user can read the public suspension timestamp on their own row but cannot
-- address the internal reason column through the Data API role.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011103', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select id, suspended_at
from public.profiles
where id = '00000000-0000-4000-8000-000000011103';

do $$
declare
  hidden_reason text;
begin
  begin
    execute 'select suspension_reason from public.profiles where id = $1'
      into hidden_reason
      using '00000000-0000-4000-8000-000000011103'::uuid;
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'authenticated users must not read suspension_reason directly';
end;
$$;

-- ---------------------------------------------------------------------------
-- Suspended-user write guards. Existing relief and settlement paths are not
-- changed; only the listed creation/consumption boundaries are guarded.
-- ---------------------------------------------------------------------------
reset role;

insert into public.card_pools (
  id, ip_id, name, active_from
)
values (
  '00000000-0000-4000-8000-000000011120',
  'member-suspension-ip',
  '회원 정지 카드풀',
  now() - interval '1 day'
)
on conflict (id) do nothing;

insert into public.pool_odds (pool_id, rarity, probability)
values ('00000000-0000-4000-8000-000000011120', 'N', 1)
on conflict (pool_id, rarity) do update set probability = excluded.probability;

insert into public.cards (id, ip_id, name, rarity, pool_id)
values (
  'member-suspension-card',
  'member-suspension-ip',
  '회원 정지 카드',
  'N',
  '00000000-0000-4000-8000-000000011120'
)
on conflict (id) do update set pool_id = excluded.pool_id;

insert into public.draw_tickets (
  id, user_id, pool_id, source, source_id, ordinal
)
values (
  '00000000-0000-4000-8000-000000011122',
  '00000000-0000-4000-8000-000000011104',
  '00000000-0000-4000-8000-000000011120',
  'order_paid',
  '00000000-0000-4000-8000-000000011123',
  1
)
on conflict (id) do nothing;

insert into public.games (
  id, type, title, config, reward_pool_id, per_user_daily_limit,
  active_from, active_to
)
values (
  'member-suspension-game',
  'marble_roulette',
  '회원 정지 게임',
  '{"marbleCount":1,"variant":"smoke"}'::jsonb,
  '00000000-0000-4000-8000-000000011120',
  1,
  now() - interval '1 day',
  now() + interval '1 day'
)
on conflict (id) do update set
  reward_pool_id = excluded.reward_pool_id,
  active_from = excluded.active_from,
  active_to = excluded.active_to;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011101', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.admin_suspend_user(
  '00000000-0000-4000-8000-000000011104',
  'write guard fixture'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011104', true);

do $$
begin
  begin
    insert into public.posts (user_id, ip_id, text)
    values (
      '00000000-0000-4000-8000-000000011104',
      'member-suspension-ip',
      'suspended direct insert'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'suspended direct post insert should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.edit_own_post(
      '00000000-0000-4000-8000-000000011132',
      'suspended edit',
      'member-suspension-ip',
      null
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended post edit should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.create_post_comment(
      '00000000-0000-4000-8000-000000011133',
      'suspended comment'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended comment should be rejected';
end;
$$;

reset role;
set local role service_role;
do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000011104',
      '{"recipientName":"테스터","phone":"01012345678","postalCode":"12345","address1":"서울"}'::jsonb,
      '00000000-0000-4000-8000-000000011164'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended goods order should be rejected';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011104', true);

do $$
begin
  begin
    perform public.open_draw_ticket('00000000-0000-4000-8000-000000011122');
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended draw-ticket consumption should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.play_game('member-suspension-game');
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended game play should be rejected';
end;
$$;

-- Like/report/delete remain relief paths for a suspended account.
select public.set_post_like('00000000-0000-4000-8000-000000011133', true);
select public.submit_community_report(
  'post',
  '00000000-0000-4000-8000-000000011133',
  'suspended reporter relief path'
);
select public.delete_own_comment('00000000-0000-4000-8000-000000011136');
select public.delete_own_post('00000000-0000-4000-8000-000000011135');

-- Community upload is blocked, while a claimed profile-avatar upload remains
-- permitted for account recovery and profile maintenance.
reset role;
set local role service_role;
select public.service_prepare_profile_avatar_claim(
  '00000000-0000-4000-8000-000000011104',
  '00000000-0000-4000-8000-000000011104/profile/11111111-1111-4111-8111-111111111111.png'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011104', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-uploads',
      '00000000-0000-4000-8000-000000011104/community/22222222-2222-4222-8222-222222222222.png',
      '00000000-0000-4000-8000-000000011104'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'suspended community upload should be rejected';
end;
$$;

insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000011104/profile/11111111-1111-4111-8111-111111111111.png',
  '00000000-0000-4000-8000-000000011104'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
begin
  begin
    perform public.reserve_tickets(
      '00000000-0000-4000-8000-000000011104',
      '00000000-0000-4000-8000-000000011121',
      1,
      '00000000-0000-4000-8000-000000011165'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended ticket reservation should be rejected';
end;
$$;

insert into public.tickets (
  id, ticket_order_id, ticket_type_id, qr_token, status
)
values (
  '00000000-0000-4000-8000-000000011144',
  '00000000-0000-4000-8000-000000011143',
  '00000000-0000-4000-8000-000000011121',
  '11111111111111111111111111111111',
  'valid'
)
on conflict (id) do nothing;

do $$
begin
  begin
    perform public.check_in_ticket(
      '00000000-0000-4000-8000-000000011106',
      '11111111111111111111111111111111'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'account_suspended' then return; end if;
      raise;
  end;
  raise exception 'suspended staff check-in should be rejected';
end;
$$;

reset role;

select 1 / case when (
  (select text from public.posts where id = '00000000-0000-4000-8000-000000011132') = 'blocked user existing post'
  and not exists (
    select 1 from public.comments
    where user_id = '00000000-0000-4000-8000-000000011104'
      and text = 'suspended comment'
  )
  and not exists (
    select 1 from public.orders
    where user_id = '00000000-0000-4000-8000-000000011104'
      and checkout_key = '00000000-0000-4000-8000-000000011164'
  )
  and not exists (
    select 1 from public.ticket_orders
    where user_id = '00000000-0000-4000-8000-000000011104'
      and reservation_key = '00000000-0000-4000-8000-000000011165'
  )
  and (select sold from public.ticket_types where id = '00000000-0000-4000-8000-000000011121') = 0
  and (select consumed_at is null from public.draw_tickets where id = '00000000-0000-4000-8000-000000011122')
  and not exists (
    select 1 from public.card_grants
    where user_id = '00000000-0000-4000-8000-000000011104'
  )
  and not exists (
    select 1 from public.game_plays
    where user_id = '00000000-0000-4000-8000-000000011104'
  )
  and (select status from public.tickets where id = '00000000-0000-4000-8000-000000011144') = 'valid'
  and not exists (
    select 1 from public.check_ins
    where ticket_id = '00000000-0000-4000-8000-000000011144'
  )
) then 1 else 0 end as assert_suspended_writes_are_atomic;

select 1 / case when (
  exists (
    select 1 from public.likes
    where post_id = '00000000-0000-4000-8000-000000011133'
      and user_id = '00000000-0000-4000-8000-000000011104'
  )
  and exists (
    select 1 from public.reports
    where target_type = 'post'
      and target_id = '00000000-0000-4000-8000-000000011133'
      and reporter_id = '00000000-0000-4000-8000-000000011104'
  )
  and exists (
    select 1 from storage.objects
    where bucket_id = 'user-uploads'
      and name = '00000000-0000-4000-8000-000000011104/profile/11111111-1111-4111-8111-111111111111.png'
  )
  and not exists (
    select 1 from public.posts
    where id = '00000000-0000-4000-8000-000000011135'
  )
  and not exists (
    select 1 from public.comments
    where id = '00000000-0000-4000-8000-000000011136'
  )
) then 1 else 0 end as assert_relief_paths_and_profile_avatar_remain_available;

rollback;
