\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- ICONS · 인앱 1:1 문의 스레드 스모크 (#253)
--
-- 지키려는 계약
--   1) 쓰기 경로는 RPC뿐이다 — 테이블 직접 insert/update가 열려 있으면 상태 전이
--      규칙(사용자 → open, 운영자 → answered)이 우회된다.
--   2) 읽기는 본인 + staff뿐이다.
--   3) 첨부 경로는 호출자 소유여야 한다 — 형식만 맞는 남의 폴더를 가리킬 수 없다.
--   4) 연결 주문은 본인 주문이어야 한다 — 아니면 문의 접수만으로 타인 주문 요약을 본다.
--   5) 답변 후 7일이 지나면 자동 종결되고, 사용자가 이어서 물으면 다시 열린다.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ACL — 테이블은 읽기 전용, 함수는 필요한 롤에만
-- ---------------------------------------------------------------------------
select 1 / case when (
  not has_table_privilege('anon', 'public.inquiries', 'select')
  and has_table_privilege('authenticated', 'public.inquiries', 'select')
  and not has_table_privilege('authenticated', 'public.inquiries', 'insert')
  and not has_table_privilege('authenticated', 'public.inquiries', 'update')
  and not has_table_privilege('authenticated', 'public.inquiries', 'delete')
  and not has_table_privilege('service_role', 'public.inquiries', 'insert')
  and not has_table_privilege('anon', 'public.inquiry_messages', 'select')
  and has_table_privilege('authenticated', 'public.inquiry_messages', 'select')
  and not has_table_privilege('authenticated', 'public.inquiry_messages', 'insert')
  and not has_table_privilege('authenticated', 'public.inquiry_reply_templates', 'insert')
) then 1 else 0 end as assert_inquiry_tables_are_read_only;

select 1 / case when (
  not has_function_privilege('anon', 'public.create_inquiry(text,text,text,uuid,text,text[])', 'execute')
  and has_function_privilege('authenticated', 'public.create_inquiry(text,text,text,uuid,text,text[])', 'execute')
  and not has_function_privilege('service_role', 'public.create_inquiry(text,text,text,uuid,text,text[])', 'execute')
  and not has_function_privilege('anon', 'public.append_inquiry_message(uuid,text,text[])', 'execute')
  and has_function_privilege('authenticated', 'public.append_inquiry_message(uuid,text,text[])', 'execute')
  and not has_function_privilege('service_role', 'public.append_inquiry_message(uuid,text,text[])', 'execute')
) then 1 else 0 end as assert_user_inquiry_rpc_acl;

select 1 / case when (
  not has_function_privilege('anon', 'public.admin_answer_inquiry(uuid,text,text[])', 'execute')
  and has_function_privilege('authenticated', 'public.admin_answer_inquiry(uuid,text,text[])', 'execute')
  and not has_function_privilege('service_role', 'public.admin_answer_inquiry(uuid,text,text[])', 'execute')
  and not has_function_privilege('anon', 'public.admin_close_inquiry(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_close_inquiry(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_search_inquiries(text,text,date,date,text,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_search_inquiries(text,text,date,date,text,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_inquiry_status_counts()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_inquiry_context(uuid)', 'execute')
) then 1 else 0 end as assert_admin_inquiry_rpc_acl;

-- 자동 종결 잡은 스케줄러(postgres)와 수동 운영(service_role)만 부른다.
select 1 / case when (
  not has_function_privilege('anon', 'public.close_stale_answered_inquiries()', 'execute')
  and not has_function_privilege('authenticated', 'public.close_stale_answered_inquiries()', 'execute')
  and has_function_privilege('service_role', 'public.close_stale_answered_inquiries()', 'execute')
) then 1 else 0 end as assert_auto_close_is_service_only;

select 1 / case when exists (
  select 1 from cron.job where jobname = 'close-stale-answered-inquiries'
) then 1 else 0 end as assert_auto_close_job_is_scheduled;

-- 알림 타입과 메일 템플릿 CHECK가 함께 넓혀졌는지. 한쪽만 넓히면 답변 발송이
-- check_violation 또는 invalid_email_template로 막힌다.
select 1 / case when (
  exists (
    select 1
    from pg_constraint
    where conname = 'notifications_type_check'
      and pg_get_constraintdef(oid) like '%inquiry_answered%'
  )
  and exists (
    select 1
    from pg_constraint
    where conname = 'email_deliveries_template_check'
      and pg_get_constraintdef(oid) like '%inquiry_answered%'
  )
  and strpos(
    pg_get_functiondef('public.claim_email_delivery(text,text,text,text,interval)'::regprocedure),
    'inquiry_answered'
  ) > 0
) then 1 else 0 end as assert_notification_and_email_contracts_widened;

-- ---------------------------------------------------------------------------
-- 픽스처
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000002501', 'authenticated', 'authenticated',
   'inquiry-buyer@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000002502', 'authenticated', 'authenticated',
   'inquiry-other@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000002503', 'authenticated', 'authenticated',
   'inquiry-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000002501' then 'smoke_buyer'
    when '00000000-0000-4000-8000-000000002502' then 'smoke_other'
    else 'smoke_cs'
  end,
  /* profiles.role 은 user_role enum 이다 — case 식의 text 결과를 캐스팅해야 한다. */
  role = (case id
    when '00000000-0000-4000-8000-000000002503' then 'staff'
    else 'user'
  end)::public.user_role,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb,
  onboarded_at = now()
where id in (
  '00000000-0000-4000-8000-000000002501',
  '00000000-0000-4000-8000-000000002502',
  '00000000-0000-4000-8000-000000002503'
);

insert into public.orders (id, user_id, status, total, address, expires_at)
values (
  '40000000-0000-4000-8000-000000002501',
  '00000000-0000-4000-8000-000000002502',
  'pending',
  10000,
  '{}'::jsonb,
  now() + interval '10 minutes'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 사용자 접수
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002501', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.create_inquiry(
  'order',
  '  배송이 아직 안 왔어요  ',
  '  주문한 지 일주일이 지났어요  ',
  null,
  null,
  '{}'::text[]
) as created_inquiry_id \gset

select 1 / case when (
  select count(*)
  from public.inquiries
  where id = :'created_inquiry_id'
    and user_id = '00000000-0000-4000-8000-000000002501'
    and status = 'open'
    and title = '배송이 아직 안 왔어요'
    and closed_at is null
) = 1 then 1 else 0 end as assert_inquiry_created_open;

select 1 / case when (
  select count(*)
  from public.inquiry_messages
  where inquiry_id = :'created_inquiry_id'
    and author = 'user'
    and body = '주문한 지 일주일이 지났어요'
) = 1 then 1 else 0 end as assert_first_message_stored;

-- 첨부 경로는 호출자 소유여야 한다. 형식만 맞는 남의 폴더는 통과하지 않는다.
do $$
declare
  foreign_path_accepted boolean := false;
begin
  begin
    perform public.create_inquiry(
      'etc',
      '남의 폴더 첨부',
      '본문',
      null,
      null,
      array['00000000-0000-4000-8000-000000002502/inquiry/'
        || '11111111-1111-4111-8111-111111111111.png']
    );
    foreign_path_accepted := true;
  exception
    when check_violation then
      foreign_path_accepted := false;
  end;

  if foreign_path_accepted then
    raise exception 'inquiry attachment path must belong to the caller';
  end if;
end;
$$;

-- 남의 주문에 연결한 문의는 접수되지 않는다.
do $$
declare
  foreign_order_accepted boolean := false;
begin
  begin
    perform public.create_inquiry(
      'order',
      '남의 주문 연결',
      '본문',
      '40000000-0000-4000-8000-000000002501',
      null,
      '{}'::text[]
    );
    foreign_order_accepted := true;
  exception
    when no_data_found then
      foreign_order_accepted := false;
  end;

  if foreign_order_accepted then
    raise exception 'inquiry must not link another buyer order';
  end if;
end;
$$;

-- 테이블 직접 쓰기 경로는 없다.
do $$
declare
  direct_write_succeeded boolean := false;
begin
  begin
    insert into public.inquiries (user_id, category, title)
    values ('00000000-0000-4000-8000-000000002501', 'etc', '직접 삽입');
    direct_write_succeeded := true;
  exception
    when insufficient_privilege or check_violation then
      direct_write_succeeded := false;
  end;

  if direct_write_succeeded then
    raise exception 'direct inquiries insert should be blocked';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS — 남의 문의는 보이지 않는다
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002502', true);

select 1 / case when (
  select count(*) from public.inquiries where id = :'created_inquiry_id'
) = 0 then 1 else 0 end as assert_other_user_cannot_read_inquiry;

select 1 / case when (
  select count(*) from public.inquiry_messages where inquiry_id = :'created_inquiry_id'
) = 0 then 1 else 0 end as assert_other_user_cannot_read_messages;

-- staff가 아닌 이용자는 어드민 RPC를 통과하지 못한다.
do $$
declare
  non_staff_search_succeeded boolean := false;
begin
  begin
    perform public.admin_search_inquiries(null, null, null, null, null, 'all', 20, 0);
    non_staff_search_succeeded := true;
  exception
    when insufficient_privilege then
      non_staff_search_succeeded := false;
  end;

  if non_staff_search_succeeded then
    raise exception 'admin_search_inquiries must require staff';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 운영자 답변 — 상태 전이와 인앱 알림
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002503', true);

select message_id from public.admin_answer_inquiry(
  :'created_inquiry_id'::uuid,
  '오늘 발송 예정입니다.',
  '{}'::text[]
) \gset

select 1 / case when (
  select count(*)
  from public.inquiries
  where id = :'created_inquiry_id'
    and status = 'answered'
    and handled_by = '00000000-0000-4000-8000-000000002503'
    and answered_at is not null
) = 1 then 1 else 0 end as assert_answer_marks_inquiry_answered;

select 1 / case when (
  select count(*)
  from public.audit_log
  where action = 'admin.inquiry.answered'
    and target = 'inquiries:' || :'created_inquiry_id'
) = 1 then 1 else 0 end as assert_answer_is_audited;

-- staff는 상태별 건수를 0건 행까지 받는다.
select 1 / case when (
  select count(*) from public.admin_inquiry_status_counts()
) = 3 then 1 else 0 end as assert_status_counts_include_zero_rows;

-- ---------------------------------------------------------------------------
-- 재오픈 — 답변 뒤 사용자 추가 메시지
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002501', true);

-- 알림함은 본인만 읽는다(notifications_read_own). 그래서 이 검사는 구매자 세션에서 한다.
select 1 / case when (
  select count(*)
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000002501'
    and type = 'inquiry_answered'
    and link_path = '/my/inquiries/' || :'created_inquiry_id'
    and dedupe_key = 'inquiry:answered:' || :'message_id'
) = 1 then 1 else 0 end as assert_answer_leaves_in_app_notification;

select public.append_inquiry_message(
  :'created_inquiry_id'::uuid,
  '아직도 배송이 안 왔어요',
  '{}'::text[]
) as reopen_message_id \gset

select 1 / case when (
  select count(*)
  from public.inquiries
  where id = :'created_inquiry_id'
    and status = 'open'
) = 1 then 1 else 0 end as assert_user_message_reopens_inquiry;

-- ---------------------------------------------------------------------------
-- 자동 종결 — 마지막 답변 후 7일
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002503', true);

select message_id as second_message_id from public.admin_answer_inquiry(
  :'created_inquiry_id'::uuid,
  '오늘 중으로 확인해 드리겠습니다.',
  '{}'::text[]
) \gset

reset role;

-- 답변 직후에는 종결 대상이 아니다.
select 1 / case when public.close_stale_answered_inquiries() = 0
  then 1 else 0 end as assert_fresh_answer_is_not_auto_closed;

update public.inquiries
set last_message_at = now() - interval '8 days'
where id = :'created_inquiry_id';

select 1 / case when public.close_stale_answered_inquiries() >= 1
  then 1 else 0 end as assert_stale_answer_is_auto_closed;

select 1 / case when (
  select count(*)
  from public.inquiries
  where id = :'created_inquiry_id'
    and status = 'closed'
    and closed_at is not null
) = 1 then 1 else 0 end as assert_auto_close_sets_closed_at;

-- 종결 후 재문의는 새 스레드다. 닫힌 대화를 되살리지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000002501', true);

do $$
declare
  reopened boolean := false;
begin
  begin
    perform public.append_inquiry_message(
      (select id from public.inquiries where status = 'closed' order by created_at desc limit 1),
      '한 번 더 물어볼게요',
      '{}'::text[]
    );
    reopened := true;
  exception
    when check_violation then
      reopened := false;
  end;

  if reopened then
    raise exception 'closed inquiry must not accept new user messages';
  end if;
end;
$$;

-- 종결된 문의도 계속 열람할 수 있다.
select 1 / case when (
  select count(*) from public.inquiries where id = :'created_inquiry_id'
) = 1 then 1 else 0 end as assert_closed_inquiry_stays_readable;

reset role;

rollback;
