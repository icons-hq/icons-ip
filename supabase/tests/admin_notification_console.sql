\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001051',
    'authenticated', 'authenticated', 'notification-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001052',
    'authenticated', 'authenticated', 'notification-staff-two@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001053',
    'authenticated', 'authenticated', 'notification-fan-one@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001054',
    'authenticated', 'authenticated', 'notification-fan-two@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001055',
    'authenticated', 'authenticated', 'notification-incomplete@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role
)
values
  (
    '00000000-0000-4000-8000-000000001051',
    'notification-staff@example.test', 'notification_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000001052',
    'notification-staff-two@example.test', 'notification_staff_two', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'admin'
  ),
  (
    '00000000-0000-4000-8000-000000001053',
    'notification-fan-one@example.test', 'notification_fan_one', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000001054',
    'notification-fan-two@example.test', 'notification_fan_two', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

-- The fifth profile intentionally remains incomplete. `all` still includes it.

insert into public.verticals (key, label, color)
values ('admin-notification-test', '공지 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values
  ('admin-notification-test-ip', '공지 테스트 IP', 'admin-notification-test'),
  ('admin-notification-empty-ip', '팔로워 없는 IP', 'admin-notification-test')
on conflict (id) do update set title = excluded.title;

insert into public.ip_follows (
  user_id, ip_id, notify_drops, notify_events
)
values
  (
    '00000000-0000-4000-8000-000000001053',
    'admin-notification-test-ip', true, true
  ),
  (
    '00000000-0000-4000-8000-000000001054',
    'admin-notification-test-ip', false, false
  )
on conflict (user_id, ip_id) do update set
  notify_drops = excluded.notify_drops,
  notify_events = excluded.notify_events;

-- Guarded RPC ACLs and existing notification table write boundary.
select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_estimate_notification_recipients(text,text)',
  'execute'
) then 1 else 0 end as assert_anon_cannot_estimate_admin_notification;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.admin_estimate_notification_recipients(text,text)',
  'execute'
) then 1 else 0 end as assert_service_role_cannot_estimate_admin_notification;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.admin_estimate_notification_recipients(text,text)',
  'execute'
) then 1 else 0 end as assert_authenticated_can_call_guarded_estimate_rpc;

select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_send_notification(uuid,text,text,text,text)',
  'execute'
) then 1 else 0 end as assert_anon_cannot_send_admin_notification;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.admin_send_notification(uuid,text,text,text,text)',
  'execute'
) then 1 else 0 end as assert_service_role_cannot_send_admin_notification;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.admin_send_notification(uuid,text,text,text,text)',
  'execute'
) then 1 else 0 end as assert_authenticated_can_call_guarded_send_rpc;

select 1 / case when not has_function_privilege(
  'anon',
  'public.admin_list_notification_history(integer,integer)',
  'execute'
) then 1 else 0 end as assert_anon_cannot_list_admin_notification_history;

select 1 / case when not has_function_privilege(
  'service_role',
  'public.admin_list_notification_history(integer,integer)',
  'execute'
) then 1 else 0 end as assert_service_role_cannot_list_admin_notification_history;

select 1 / case when has_function_privilege(
  'authenticated',
  'public.admin_list_notification_history(integer,integer)',
  'execute'
) then 1 else 0 end as assert_authenticated_can_call_guarded_history_rpc;

select 1 / case when
  not has_table_privilege('authenticated', 'public.notifications', 'insert')
  and not has_table_privilege('authenticated', 'public.notifications', 'update')
  and not has_table_privilege('authenticated', 'public.notifications', 'delete')
  and not has_table_privilege('service_role', 'public.notifications', 'insert')
  and not has_table_privilege('service_role', 'public.notifications', 'update')
  and not has_table_privilege('service_role', 'public.notifications', 'delete')
then 1 else 0 end as assert_notification_direct_writes_remain_blocked;

select 1 / case when (
  select pg_catalog.bool_and(proc.prosecdef)
    and pg_catalog.bool_and(proc.proconfig @> array['search_path=""'])
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname in (
      'admin_estimate_notification_recipients',
      'admin_send_notification',
      'admin_list_notification_history'
    )
) then 1 else 0 end as assert_admin_notification_rpcs_are_hardened;

-- Authenticated non-staff callers have EXECUTE but fail every internal guard.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001053', true);

do $$
begin
  begin
    perform public.admin_estimate_notification_recipients('all', null);
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then
        return;
      end if;
      raise;
  end;
  raise exception 'non-staff estimate should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_send_notification(
      '11111111-1111-4111-8111-111111111050',
      'all',
      null,
      '권한 없는 공지',
      '일반 사용자는 공지를 발송할 수 없습니다.'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then
        return;
      end if;
      raise;
  end;
  raise exception 'non-staff send should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_list_notification_history(20, 0);
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then
        return;
      end if;
      raise;
  end;
  raise exception 'non-staff history should be rejected';
end;
$$;

reset role;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where id = '11111111-1111-4111-8111-111111111050'
) then 1 else 0 end as assert_non_staff_send_is_atomic;

-- Exact staff estimates: all profiles include staff and incomplete accounts;
-- IP announcements ignore drop/event preference switches.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001051', true);

select 1 / case when exists (
  select 1
  from public.admin_estimate_notification_recipients('all', null)
  where scope = 'all'
    and ip_id is null
    and ip_title is null
    and recipient_count = 5
    and can_send
) then 1 else 0 end as assert_all_estimate_includes_every_profile;

select 1 / case when exists (
  select 1
  from public.admin_estimate_notification_recipients(
    'ip_followers',
    'admin-notification-test-ip'
  )
  where scope = 'ip_followers'
    and ip_id = 'admin-notification-test-ip'
    and ip_title = '공지 테스트 IP'
    and recipient_count = 2
    and can_send
) then 1 else 0 end as assert_ip_estimate_ignores_notification_preferences;

select 1 / case when exists (
  select 1
  from public.admin_estimate_notification_recipients(
    'ip_followers',
    'admin-notification-empty-ip'
  )
  where recipient_count = 0
    and not can_send
) then 1 else 0 end as assert_empty_ip_estimate_is_not_sendable;

-- Invalid target combinations, pagination, content, and empty recipients fail closed.
do $$
declare
  invalid_estimate record;
begin
  for invalid_estimate in
    select *
    from (values
      (null::text, null::text, 'invalid_notification_scope'::text),
      ('unknown'::text, null::text, 'invalid_notification_scope'::text),
      ('all', 'admin-notification-test-ip', 'invalid_notification_target'),
      ('ip_followers', null, 'invalid_notification_target'),
      ('ip_followers', 'missing-ip', 'ip_not_found')
    ) as invalid_values(scope, ip_id, expected_message)
  loop
    begin
      perform public.admin_estimate_notification_recipients(
        invalid_estimate.scope,
        invalid_estimate.ip_id
      );
    exception
      when others then
        if sqlerrm = invalid_estimate.expected_message then
          continue;
        end if;
        raise;
    end;
    raise exception 'invalid estimate should fail with %', invalid_estimate.expected_message;
  end loop;
end;
$$;

do $$
declare
  invalid_send record;
begin
  for invalid_send in
    select *
    from (values
      (null::uuid, 'all'::text, null::text, '제목'::text, '본문'::text, 'invalid_operation_id'::text),
      ('11111111-1111-4111-8111-111111111062'::uuid, null::text, null::text, '제목', '본문', 'invalid_notification_scope'),
      ('11111111-1111-4111-8111-111111111051'::uuid, 'unknown', null, '제목', '본문', 'invalid_notification_scope'),
      ('11111111-1111-4111-8111-111111111052'::uuid, 'all', 'admin-notification-test-ip', '제목', '본문', 'invalid_notification_target'),
      ('11111111-1111-4111-8111-111111111053'::uuid, 'ip_followers', null, '제목', '본문', 'invalid_notification_target'),
      ('11111111-1111-4111-8111-111111111054'::uuid, 'ip_followers', 'missing-ip', '제목', '본문', 'ip_not_found'),
      ('11111111-1111-4111-8111-111111111055'::uuid, 'all', null, null::text, '본문', 'invalid_notification_title'),
      ('11111111-1111-4111-8111-111111111056'::uuid, 'all', null, '   ', '본문', 'invalid_notification_title'),
      ('11111111-1111-4111-8111-111111111057'::uuid, 'all', null, repeat('가', 121), '본문', 'invalid_notification_title'),
      ('11111111-1111-4111-8111-111111111058'::uuid, 'all', null, '제목', null::text, 'invalid_notification_body'),
      ('11111111-1111-4111-8111-111111111059'::uuid, 'all', null, '제목', E' \n ', 'invalid_notification_body'),
      ('11111111-1111-4111-8111-111111111060'::uuid, 'all', null, '제목', repeat('가', 501), 'invalid_notification_body'),
      ('11111111-1111-4111-8111-111111111061'::uuid, 'ip_followers', 'admin-notification-empty-ip', '제목', '본문', 'notification_no_recipients')
    ) as invalid_values(operation_id, scope, ip_id, title, body, expected_message)
  loop
    begin
      perform public.admin_send_notification(
        invalid_send.operation_id,
        invalid_send.scope,
        invalid_send.ip_id,
        invalid_send.title,
        invalid_send.body
      );
    exception
      when others then
        if sqlerrm = invalid_send.expected_message then
          continue;
        end if;
        raise;
    end;
    raise exception 'invalid send should fail with %', invalid_send.expected_message;
  end loop;
end;
$$;

do $$
declare
  invalid_history record;
begin
  for invalid_history in
    select *
    from (values
      (0::integer, 0::integer, 'invalid_history_limit'::text),
      (101, 0, 'invalid_history_limit'),
      (20, -1, 'invalid_history_offset')
    ) as invalid_values(history_limit, history_offset, expected_message)
  loop
    begin
      perform public.admin_list_notification_history(
        invalid_history.history_limit,
        invalid_history.history_offset
      );
    exception
      when others then
        if sqlerrm = invalid_history.expected_message then
          continue;
        end if;
        raise;
    end;
    raise exception 'invalid history query should fail with %', invalid_history.expected_message;
  end loop;
end;
$$;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where id between
    '11111111-1111-4111-8111-111111111051'
    and '11111111-1111-4111-8111-111111111062'
) then 1 else 0 end as assert_invalid_sends_are_not_audited;

-- One statement fans out to every follower, including the opted-out follower.
create temporary table admin_notification_first_result as
select *
from public.admin_send_notification(
  '22222222-2222-4222-8222-222222221051',
  'ip_followers',
  'admin-notification-test-ip',
  '  서비스 점검 안내  ',
  E'  오늘 23시에 점검을 진행합니다.\n  '
);

select 1 / case when (
  select recipient_count = 2 and sent_at is not null
  from admin_notification_first_result
) then 1 else 0 end as assert_ip_announcement_returns_actual_result;

reset role;

select 1 / case when (
  select count(*)
  from public.notifications
  where source_type = 'admin_announcement'
    and source_id = '22222222-2222-4222-8222-222222221051'
    and dedupe_key = 'announcement:22222222-2222-4222-8222-222222221051'
    and type = 'announcement'
    and title = '서비스 점검 안내'
    and body = '오늘 23시에 점검을 진행합니다.'
    and link_path = '/notifications'
) = 2 then 1 else 0 end as assert_ip_announcement_fans_out_once;

select 1 / case when exists (
  select 1
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000001054'
    and source_id = '22222222-2222-4222-8222-222222221051'
) then 1 else 0 end as assert_opted_out_follower_still_receives_announcement;

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '22222222-2222-4222-8222-222222221051'
    and actor_id = '00000000-0000-4000-8000-000000001051'
    and action = 'admin.notification.sent'
    and target = 'notifications:ip_followers:admin-notification-test-ip'
    and diff -> 'request' = '{"scope":"ip_followers","ip_id":"admin-notification-test-ip","title":"서비스 점검 안내","body":"오늘 23시에 점검을 진행합니다."}'::jsonb
    and diff -> 'result' = '{"ip_title":"공지 테스트 IP","link_path":"/notifications","recipient_count":2}'::jsonb
) then 1 else 0 end as assert_announcement_audit_payload_is_exact;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001051', true);

select 1 / case when exists (
  select 1
  from public.admin_list_notification_history(20, 0)
  where operation_id = '22222222-2222-4222-8222-222222221051'
    and actor_name = 'notification_staff'
    and scope = 'ip_followers'
    and ip_id = 'admin-notification-test-ip'
    and ip_title = '공지 테스트 IP'
    and title = '서비스 점검 안내'
    and body = '오늘 23시에 점검을 진행합니다.'
    and recipient_count = 2
    and sent_at = (select sent_at from admin_notification_first_result)
) then 1 else 0 end as assert_history_returns_safe_dispatch_summary;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where id = '22222222-2222-4222-8222-222222221051'
    and (
      diff::text like '%example.test%'
      or diff::text like '%00000000-0000-4000-8000-000000001053%'
      or diff::text like '%00000000-0000-4000-8000-000000001054%'
    )
) then 1 else 0 end as assert_audit_omits_recipient_pii;

select 1 / case when pg_catalog.pg_get_function_result(
  'public.admin_list_notification_history(integer,integer)'::regprocedure
) !~* '(recipient_id|user_id|email)'
then 1 else 0 end as assert_history_contract_omits_recipient_pii;

-- Lost-response replay returns the original count and timestamp without fan-out.
select 1 / case when exists (
  select 1
  from public.admin_send_notification(
    '22222222-2222-4222-8222-222222221051',
    'ip_followers',
    'admin-notification-test-ip',
    '서비스 점검 안내',
    '오늘 23시에 점검을 진행합니다.'
  ) as replay
  where replay.recipient_count = 2
    and replay.sent_at = (select sent_at from admin_notification_first_result)
) then 1 else 0 end as assert_same_operation_replays_original_result;

reset role;

select 1 / case when (
  select count(*)
  from public.notifications
  where source_id = '22222222-2222-4222-8222-222222221051'
) = 2 and (
  select count(*)
  from public.audit_log
  where id = '22222222-2222-4222-8222-222222221051'
) = 1 then 1 else 0 end as assert_replay_does_not_duplicate_rows;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001051', true);

do $$
begin
  begin
    perform public.admin_send_notification(
      '22222222-2222-4222-8222-222222221051',
      'ip_followers',
      'admin-notification-test-ip',
      '변경된 제목',
      '오늘 23시에 점검을 진행합니다.'
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then
        return;
      end if;
      raise;
  end;
  raise exception 'same actor must not reuse operation with changed payload';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001052', true);

do $$
begin
  begin
    perform public.admin_send_notification(
      '22222222-2222-4222-8222-222222221051',
      'ip_followers',
      'admin-notification-test-ip',
      '서비스 점검 안내',
      '오늘 23시에 점검을 진행합니다.'
    );
  exception
    when unique_violation then
      if sqlerrm = 'operation_conflict' then
        return;
      end if;
      raise;
  end;
  raise exception 'another actor must not reuse an operation id';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001051', true);

select 1 / case when exists (
  select 1
  from public.admin_send_notification(
    '22222222-2222-4222-8222-222222221052',
    'all',
    null,
    '전체 공지',
    '온보딩 상태와 역할에 관계없이 모든 프로필에 발송됩니다.'
  )
  where recipient_count = 5
) then 1 else 0 end as assert_all_send_includes_every_profile;

reset role;

select 1 / case when (
  select count(*)
  from public.notifications
  where source_id = '22222222-2222-4222-8222-222222221052'
) = 5 then 1 else 0 end as assert_all_send_actual_rows_match_result;

-- `all` means the whole current profile set. Large audiences are not silently
-- truncated or rejected by an arbitrary application limit.
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  (
    'a1050000-0000-4000-8000-'
      || pg_catalog.lpad(series.value::text, 12, '0')
  )::uuid,
  'authenticated',
  'authenticated',
  'notification-limit-' || series.value::text || '@example.test',
  now(),
  '{}',
  '{}',
  now(),
  now()
from pg_catalog.generate_series(1, 9996) as series(value);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001051', true);

select 1 / case when exists (
  select 1
  from public.admin_estimate_notification_recipients('all', null)
  where recipient_count = 10001
    and can_send
) then 1 else 0 end as assert_large_whole_audience_is_sendable;

select 1 / case when exists (
  select 1
  from public.admin_send_notification(
    '22222222-2222-4222-8222-222222221053',
    'all',
    null,
    '전체 대상 테스트',
    '현재 전체 프로필에 한 transaction으로 발송합니다.'
  )
  where recipient_count = 10001
) then 1 else 0 end as assert_large_whole_audience_fans_out;

reset role;

select 1 / case when (
  select 1
  from public.notifications
  where source_id = '22222222-2222-4222-8222-222222221053'
  group by source_id
  having count(*) = 10001
) = 1 then 1 else 0 end as assert_large_whole_audience_rows_are_complete;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = 'audit_log'
    and indexname = 'audit_log_admin_notification_sent_idx'
    and indexdef like '%created_at DESC%'
    and indexdef like '%action = ''admin.notification.sent''%'
) then 1 else 0 end as assert_admin_notification_history_partial_index;

select lower(pg_catalog.pg_get_functiondef(
  'public.admin_send_notification(uuid,text,text,text,text)'::regprocedure
)) as admin_notification_function_body \gset

select 1 / case when strpos(
  :'admin_notification_function_body',
  'pg_advisory_xact_lock'
) > 0 then 1 else 0 end as assert_send_serializes_operation_id;

select 1 / case when strpos(
  :'admin_notification_function_body',
  'insert into public.notifications'
) > 0 and strpos(
  :'admin_notification_function_body',
  'from public.profiles as profile'
) > 0 and strpos(
  :'admin_notification_function_body',
  'from public.ip_follows as follow'
) > 0 and strpos(
  :'admin_notification_function_body',
  'array_agg'
) = 0 then 1 else 0 end as assert_send_uses_unbounded_set_based_fanout;

rollback;
