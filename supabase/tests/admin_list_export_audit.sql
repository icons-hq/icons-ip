\set ON_ERROR_STOP on

begin;

-- 목록 엑셀 다운로드 감사 기록 계약: staff만 기록하고, actor는 호출자로 고정되며,
-- 화면·조건·건수가 audit_log 한 행에 남는다. 운영 데이터와 겹치지 않는 UUID를 쓴다.
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-00000000c501', 'authenticated', 'authenticated', 'list-export-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000c502', 'authenticated', 'authenticated', 'list-export-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000c503', 'authenticated', 'authenticated', 'list-export-suspended@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role, suspended_at, suspension_reason)
values
  ('00000000-0000-4000-8000-00000000c501', 'list-export-staff@example.test', 'list_export_staff', '1990-01-01', '{"terms":true,"privacy":true}', now(), 'staff', null, null),
  ('00000000-0000-4000-8000-00000000c502', 'list-export-buyer@example.test', 'list_export_buyer', '1990-01-01', '{"terms":true,"privacy":true}', now(), 'user', null, null),
  ('00000000-0000-4000-8000-00000000c503', 'list-export-suspended@example.test', 'list_export_suspended', '1990-01-01', '{"terms":true,"privacy":true}', now(), 'staff', now(), '목록 엑셀 감사 스모크')
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role,
  suspended_at = excluded.suspended_at,
  suspension_reason = excluded.suspension_reason;

-- 실행 권한은 authenticated에만 있다. public·anon·service_role에는 열리지 않는다.
select 1 / case when (
  not has_function_privilege('anon', 'public.admin_record_list_export(text,jsonb,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_record_list_export(text,jsonb,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_record_list_export(text,jsonb,integer,integer)', 'execute')
  and not exists (
    select 1
    from pg_proc as proc
    cross join lateral aclexplode(proc.proacl) as acl
    where proc.oid = 'public.admin_record_list_export(text,jsonb,integer,integer)'::regprocedure
      and acl.grantee = 0
  )
) then 1 else 0 end as assert_list_export_audit_acl;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c501', true);

-- staff라도 audit_log에 직접 쓸 수 없다(RLS insert 정책 없음). 이 RPC가 기록 경로다.
do $$
begin
  begin
    insert into public.audit_log (actor_id, action, target, diff)
    values ('00000000-0000-4000-8000-00000000c501', 'admin.list_export.downloaded', 'admin_screen:orders', '{}');
    raise exception 'direct audit_log insert should be rejected';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select public.admin_record_list_export(
  'claims-returns',
  '{"stage":"open","reasonType":"all","from":"2026-10-01","to":null,"query":"홍길동"}'::jsonb,
  12,
  5
) as list_export_audit_id \gset

reset role;

select 1 / case when (
  select count(*) = 1
    and bool_and(audit.actor_id = '00000000-0000-4000-8000-00000000c501')
    and bool_and(audit.action = 'admin.list_export.downloaded')
    and bool_and(audit.target = 'admin_screen:claims-returns')
    and bool_and(audit.diff ->> 'screen' = 'claims-returns')
    and bool_and((audit.diff ->> 'rowCount')::integer = 12)
    and bool_and((audit.diff ->> 'recordCount')::integer = 5)
    and bool_and(audit.diff -> 'filters' ->> 'query' = '홍길동')
    and bool_and(audit.diff -> 'filters' -> 'to' = 'null'::jsonb)
    and bool_and(audit.created_at is not null)
  from public.audit_log as audit
  where audit.id = :'list_export_audit_id'::uuid
) then 1 else 0 end as assert_list_export_audit_row;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c501', true);

-- 화면·조건·건수 검증. 상한(10,000행)과 기록 건수 ≤ 행 수를 서버 경계에서 지킨다.
do $$
declare
  cases jsonb := jsonb_build_array(
    jsonb_build_object('screen', 'settled', 'filters', '{}'::jsonb, 'rows', 1, 'records', 1, 'error', 'invalid_list_export_screen'),
    jsonb_build_object('screen', null, 'filters', '{}'::jsonb, 'rows', 1, 'records', 1, 'error', 'invalid_list_export_screen'),
    jsonb_build_object('screen', 'orders', 'filters', '[]'::jsonb, 'rows', 1, 'records', 1, 'error', 'invalid_list_export_filters'),
    jsonb_build_object('screen', 'orders', 'filters', '{"nested":{"a":1}}'::jsonb, 'rows', 1, 'records', 1, 'error', 'invalid_list_export_filters'),
    jsonb_build_object('screen', 'orders', 'filters', jsonb_build_object('query', repeat('x', 2100)), 'rows', 1, 'records', 1, 'error', 'invalid_list_export_filters'),
    jsonb_build_object('screen', 'orders', 'filters', '{}'::jsonb, 'rows', 10001, 'records', 1, 'error', 'invalid_list_export_count'),
    jsonb_build_object('screen', 'orders', 'filters', '{}'::jsonb, 'rows', -1, 'records', 0, 'error', 'invalid_list_export_count'),
    jsonb_build_object('screen', 'orders', 'filters', '{}'::jsonb, 'rows', 2, 'records', 3, 'error', 'invalid_list_export_count')
  );
  item jsonb;
begin
  for item in select value from jsonb_array_elements(cases) loop
    begin
      perform public.admin_record_list_export(
        item ->> 'screen',
        item -> 'filters',
        (item ->> 'rows')::integer,
        (item ->> 'records')::integer
      );
      raise exception 'invalid list export audit input should be rejected: %', item;
    exception when invalid_parameter_value then
      if sqlerrm <> item ->> 'error' then raise; end if;
    end;
  end loop;
end;
$$;

-- 빈 결과(0건)도 내려받은 사실로 기록할 수 있다.
select 1 / case when (
  public.admin_record_list_export('unpaid', '{"query":null}'::jsonb, 0, 0) is not null
) then 1 else 0 end as assert_empty_export_is_recordable;

-- 일반 회원과 정지된 staff는 기록할 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c502', true);
do $$
begin
  begin
    perform public.admin_record_list_export('orders', '{}'::jsonb, 1, 1);
    raise exception 'non-staff list export audit should be rejected';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_required' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c503', true);
do $$
begin
  begin
    perform public.admin_record_list_export('orders', '{}'::jsonb, 1, 1);
    raise exception 'suspended staff list export audit should be rejected';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_required' then raise; end if;
  end;
end;
$$;

-- 로그인하지 않은 호출도 거절한다.
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.admin_record_list_export('orders', '{}'::jsonb, 1, 1);
    raise exception 'anonymous list export audit should be rejected';
  exception when insufficient_privilege then
    if sqlerrm <> 'staff_required' then raise; end if;
  end;
end;
$$;

-- 거절된 호출은 감사 행을 남기지 않는다(성공한 두 건만 남는다).
reset role;
select 1 / case when (
  select count(*) = 2
  from public.audit_log
  where action = 'admin.list_export.downloaded'
    and actor_id in (
      '00000000-0000-4000-8000-00000000c501',
      '00000000-0000-4000-8000-00000000c502',
      '00000000-0000-4000-8000-00000000c503'
    )
) then 1 else 0 end as assert_rejected_calls_leave_no_audit;

rollback;
