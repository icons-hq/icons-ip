\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 매월 등급 혜택 쿠폰 자동 지급 (S36-062, 2026-11-11 사용자 결정 "매월 등급 쿠폰 자동 지급")
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 쿠폰 정의의 등급 혜택 지급 방식은 '승급 시 1회'가 기본이고, 등급 혜택이 없으면 늘 '승급 시 1회'다
--   · 쿠폰 저장 RPC가 지급 방식을 받고(값 검증·생략 시 유지), 바꾸면 조건 버전이 오르고 감사에 남는다
--   · 승급 지급은 '승급 시 1회' 정의만, 매월 지급은 '매월' 정의만 준다
--   · 매월 1일(KST) 그 시점 등급이 쿠폰 등급 이상인 이용 가능 회원에게 한 장씩 — 정지·탈퇴 진행·운영자·
--     미온보딩·WELCOME·받는 회원 조건 불일치는 빠지고, 보관·사용 종료·WELCOME 등급·승급 지급 정의도 빠진다
--   · 발급 한도는 회원 id 순으로 남은 만큼만, 묶음은 커서로 이어 가고, 같은 달은 다시 돌지 않는다(멱등)
--   · 다음 달에는 같은 쿠폰을 또 준다 — (코드, 회원) 유일 제약이 매월 지급분만 (코드, 회원, 월)로 풀렸다
--   · 그 달 실행이 고정한 뒤 지정한 정의는 다음 달부터, 놓친 달은 몰아서 주지 않고 끝나지 못한 지난달
--     실행은 'month_ended'로 닫는다. 같은 달 늦은 첫 실행은 그 달 몫을 준다
--   · 회원·월마다 인앱 알림 한 건, 실행 마감 감사 한 건, 코드 입력·운영자 발급의 보유 판정은 여러 장 중
--     사용 가능한 최신 한 장을 고른다
--   · 마이페이지 등급 혜택 안내와 고객등급 관리 읽기가 지급 방식·매월 지급 기록을 싣는다
-- 실행 월은 2031년으로 고정해 실제 매분 틱(현재 달)과 실행 행이 겹치지 않는다. 이 트랜잭션의 쿠폰·회원은
-- 커밋되지 않으므로 틱이 보지 못한다. 단언은 이 파일의 회원·쿠폰(T09M-*)으로만 좁힌다.
-- 스칼라 하위 질의는 같은 문장의 함수 호출보다 먼저 평가되므로 실행과 결과 확인은 문장을 나눈다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 봉인·등록(선언으로만 확인 — 권한 없는 함수의 런타임 호출 금지)
-- ---------------------------------------------------------------------------
select 1/case when (
  not has_function_privilege('authenticated','private.run_monthly_grade_coupons(timestamptz,integer)','execute')
  and not has_function_privilege('service_role','private.run_monthly_grade_coupons(timestamptz,integer)','execute')
  and not has_function_privilege('anon','private.run_monthly_grade_coupons(timestamptz,integer)','execute')
  and not has_function_privilege('service_role','private.tick_monthly_grade_coupons()','execute')
  and not has_function_privilege('authenticated','private.finish_monthly_grade_coupon_run(date,timestamptz,text)','execute')
  and not has_function_privilege('service_role','private.loyalty_monthly_coupon_run_summaries(integer)','execute')
  and not has_function_privilege('authenticated','private.grade_benefit_coupon_grantable(public.coupons,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.monthly_grade_coupon_recipient(public.profiles,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.normalize_coupon_grade_cadence()','execute')
  and not has_table_privilege('service_role','private.loyalty_monthly_coupon_runs','select,insert,update')
  and not has_table_privilege('authenticated','private.loyalty_monthly_coupon_runs','select,insert,update')
  and (select relrowsecurity from pg_class where oid='private.loyalty_monthly_coupon_runs'::regclass)
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.run_monthly_grade_coupons(timestamptz,integer)'::regprocedure)
  and (select prosrc like '%lock_timeout%' and prosrc like '%run_monthly_grade_coupons(clock_timestamp(), 200)%'
       from pg_proc where oid='private.tick_monthly_grade_coupons()'::regprocedure)
  and (select count(*) from cron.job where jobname='monthly-grade-coupons' and schedule='* * * * *'
    and command='select private.tick_monthly_grade_coupons()')=1
) then 1 else 0 end as assert_sealed_and_minute_tick;

-- (코드, 회원) 유일 제약은 매월 지급분이 아닌 보유에만, 매월 지급분은 (월, 코드, 회원)으로 유일하다.
select 1/case when (
  not exists(select 1 from pg_constraint where conrelid='public.user_coupons'::regclass and conname='user_coupons_coupon_code_user_id_key')
  and (select indisunique and pg_get_expr(indpred,indrelid)='(grade_benefit_month IS NULL)'
       from pg_index where indexrelid='public.user_coupons_single_issue_key'::regclass)
  and (select indisunique and pg_get_expr(indpred,indrelid)='(grade_benefit_month IS NOT NULL)'
       from pg_index where indexrelid='public.user_coupons_monthly_grade_key'::regclass)
  and (select column_default='''upgrade''::text' and is_nullable='NO' from information_schema.columns
       where table_schema='public' and table_name='coupons' and column_name='grade_benefit_cadence')
  -- 기존 정의는 모두 '승급 시 1회'로 남는다(이 기능은 운영자가 고른 정의만 탄다).
  and not exists(select 1 from public.coupons where grade_benefit_cadence<>'upgrade')
  and (select pg_get_constraintdef(oid) like '%loyalty_monthly_coupons_issued%' and pg_get_constraintdef(oid) like '%loyalty_grade_upgraded%'
         and pg_get_constraintdef(oid) like '%marketing_message%'
       from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_type_check')
) then 1 else 0 end as assert_schema_contract;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값). 회원 id는 가장 작은 UUID 대역이라 다른 데이터보다 먼저 처리된다.
-- ---------------------------------------------------------------------------
create function pg_temp.t09_member(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000909'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end;
  raise exception 'Expected error: %', expected;
end $$;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.t09_member(n),'authenticated','authenticated','t09-monthly-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(0,11) n;

-- 00 운영자 · 01 SILVER · 02 GOLD · 03 PLATINUM · 04 WELCOME · 05 GOLD 정지 · 06 GOLD 운영자 계정 ·
-- 07 GOLD 미온보딩 · 08 GOLD 탈퇴 진행 · 09 GOLD 만 14세 미만(2031년 기준) · 10 GOLD · 11 SILVER(결제 이력 있음)
update public.profiles set nickname='TEST 매월 등급 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),
  consents='{"terms":true,"privacy":true}',role='user'::public.user_role,loyalty_grade='gold'
where id in (select pg_temp.t09_member(n) from generate_series(0,11) n);
update public.profiles set role='admin'::public.user_role, loyalty_grade='welcome' where id=pg_temp.t09_member(0);
update public.profiles set loyalty_grade='silver' where id in (pg_temp.t09_member(1), pg_temp.t09_member(11));
update public.profiles set loyalty_grade='platinum' where id=pg_temp.t09_member(3);
update public.profiles set loyalty_grade='welcome' where id=pg_temp.t09_member(4);
update public.profiles set suspended_at=now(), suspension_reason='TEST 정지' where id=pg_temp.t09_member(5);
update public.profiles set role='staff'::public.user_role where id=pg_temp.t09_member(6);
update public.profiles set onboarded_at=null where id=pg_temp.t09_member(7);
-- 가입 연령 트리거는 오늘 기준이라 2031년에 만 14세 미만이 될 생일은 이 한 문장만 트리거를 끄고 넣는다.
set local session_replication_role=replica;
update public.profiles set birth_date='2018-01-01' where id=pg_temp.t09_member(9);
set local session_replication_role=origin;
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values('00000000-0000-4000-8000-000000090960',pg_temp.t09_member(8),'00000000-0000-4000-8000-000000090961','awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id)
 values(pg_temp.t09_member(8),'00000000-0000-4000-8000-000000090960');
-- 11번은 결제 확정 주문이 있어 '첫 구매' 조건 쿠폰을 받지 못한다.
insert into public.orders(id,user_id,status,total,address)
 values('00000000-0000-4001-8000-000000090911',pg_temp.t09_member(11),'paid',10000,'{}');
insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
 values(pg_temp.t09_member(11),'order','00000000-0000-4001-8000-000000090911','toss',10000,'paid','pk-t09-monthly','idem-t09-monthly');

insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.t09_member(0),'primary');
update private.operator_access_state set configured=true where id;

-- 매월 정의. 발급 시작이 과거라 지금(마이페이지 안내)도 2031년(실행)도 지급할 수 있다.
insert into public.coupons(code,name,discount_type,discount_value,starts_at,ends_at,issue_starts_at,issue_ends_at,valid_days,
  issue_limit,status,grade_benefit,grade_benefit_cadence,recipient_segment) values
 ('T09M-SILVER','T09 매월 실버','fixed',1000,now()-interval '1 day',null,now()-interval '1 day',null,30,null,'active','silver','monthly','all'),
 ('T09M-GOLD','T09 매월 골드 한도','fixed',2000,now()-interval '1 day',null,now()-interval '1 day',null,30,2,'active','gold','monthly','all'),
 ('T09M-PLAT','T09 매월 플래티넘','percent',10,now()-interval '1 day',null,now()-interval '1 day',null,30,null,'active','platinum','monthly','all'),
 ('T09M-FIRST','T09 매월 첫 구매','fixed',500,now()-interval '1 day',null,now()-interval '1 day',null,30,null,'active','silver','monthly','first_purchase'),
 -- 빠진다: 승급 시 1회, 보관, 사용 종료(2031-02), 발급 종료(2031-02), WELCOME 등급
 ('T09M-UPGRADE','T09 승급 골드','fixed',3000,now()-interval '1 day',null,now()-interval '1 day',null,30,null,'active','gold','upgrade','all'),
 ('T09M-ARCHIVED','T09 매월 보관','fixed',3000,now()-interval '1 day',null,now()-interval '1 day',null,30,null,'archived','gold','monthly','all'),
 ('T09M-ENDED','T09 매월 사용 종료','fixed',3000,now()-interval '1 day','2031-02-01 00:00+09',null,null,null,null,'active','gold','monthly','all'),
 ('T09M-CLOSED','T09 매월 발급 종료','fixed',3000,now()-interval '1 day',null,now()-interval '1 day','2031-02-01 00:00+09',30,null,'active','gold','monthly','all'),
 ('T09M-WELCOME','T09 매월 웰컴','fixed',3000,now()-interval '1 day',null,now()-interval '1 day',null,30,null,'active','welcome','monthly','all');

-- ---------------------------------------------------------------------------
-- 정의 계약: 등급 혜택이 없으면 '승급 시 1회'로 되돌린다(CHECK 를 BEFORE 트리거가 지킨다)
-- ---------------------------------------------------------------------------
insert into public.coupons(code,name,discount_type,discount_value,status,grade_benefit,grade_benefit_cadence)
 values('T09M-PLAIN','T09 등급 없음','fixed',1000,'active',null,'monthly');
update public.coupons set grade_benefit=null where code='T09M-WELCOME';
update public.coupons set grade_benefit_cadence='monthly' where code='T09M-PLAIN';
select 1/case when (select grade_benefit_cadence from public.coupons where code='T09M-PLAIN')='upgrade'
  and (select grade_benefit_cadence from public.coupons where code='T09M-WELCOME')='upgrade'
then 1 else 0 end as assert_cadence_needs_grade_benefit;
update public.coupons set grade_benefit='welcome',grade_benefit_cadence='monthly' where code='T09M-WELCOME';
select pg_temp.expect_error($$update public.coupons set grade_benefit_cadence='weekly' where code='T09M-SILVER'$$,'coupons_grade_benefit_cadence_check');

-- ---------------------------------------------------------------------------
-- 쿠폰 저장 RPC: 지급 방식을 받고, 생략하면 유지하고, 바꾸면 조건 버전이 오른다
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.t09_member(0));
set local role authenticated;
select public.admin_upsert_coupon_scheduled(jsonb_build_object(
 'target_code','T09M-ADMIN','target_name','T09 저장 검증','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now(),'target_ends_at',null,'target_status','active','target_grade_benefit','gold','target_grade_benefit_cadence','monthly',
 'target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now(),'target_issue_ends_at',null,'target_valid_days',30)) as created \gset
reset role;
select 1/case when (select grade_benefit_cadence='monthly' and grade_benefit='gold' and terms_revision=(:'created'::jsonb->>'revision')::integer
  from public.coupons where code='T09M-ADMIN')
  and (select diff#>>'{after,gradeBenefitCadence}'='monthly' and diff->'before'='null'::jsonb from public.audit_log
       where action='commerce.coupon.schedule_updated' and target='coupons:T09M-ADMIN')
then 1 else 0 end as assert_upsert_saves_monthly_cadence;

-- 생략하면 기존 지급 방식을 유지한다(지급 방식을 모르는 다른 호출부가 되돌리지 않게).
set local role authenticated;
select public.admin_upsert_coupon_scheduled(jsonb_build_object(
 'target_code','T09M-ADMIN','target_previous_code','T09M-ADMIN','target_expected_revision',(:'created'::jsonb->>'revision')::integer,
 'target_name','T09 저장 검증 이름','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now(),'target_ends_at',null,'target_status','active','target_grade_benefit','gold',
 'target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now(),'target_issue_ends_at',null,'target_valid_days',30)) as renamed \gset
reset role;
select 1/case when (select grade_benefit_cadence from public.coupons where code='T09M-ADMIN')='monthly'
then 1 else 0 end as assert_omitted_cadence_is_kept;

-- 지급 방식만 바꿔도 조건 버전이 오른다 — 다른 탭의 오래된 저장은 덮어쓰지 못한다.
set local role authenticated;
select public.admin_upsert_coupon_scheduled(jsonb_build_object(
 'target_code','T09M-ADMIN','target_previous_code','T09M-ADMIN','target_expected_revision',(:'renamed'::jsonb->>'revision')::integer,
 'target_name','T09 저장 검증 이름','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now(),'target_ends_at',null,'target_status','active','target_grade_benefit','gold','target_grade_benefit_cadence','upgrade',
 'target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now(),'target_issue_ends_at',null,'target_valid_days',30)) as switched \gset
select pg_temp.expect_error(format($$select public.admin_upsert_coupon_scheduled(%L::jsonb)$$, jsonb_build_object(
 'target_code','T09M-ADMIN','target_previous_code','T09M-ADMIN','target_expected_revision',(:'renamed'::jsonb->>'revision')::integer,
 'target_name','T09 저장 검증 이름','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now(),'target_ends_at',null,'target_status','active','target_grade_benefit','gold','target_grade_benefit_cadence','monthly',
 'target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now(),'target_issue_ends_at',null,'target_valid_days',30)),'coupon_terms_changed');
select pg_temp.expect_error(format($$select public.admin_upsert_coupon_scheduled(%L::jsonb)$$, jsonb_build_object(
 'target_code','T09M-ADMIN','target_previous_code','T09M-ADMIN','target_expected_revision',(:'switched'::jsonb->>'revision')::integer,
 'target_name','T09 저장 검증 이름','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now(),'target_ends_at',null,'target_status','active','target_grade_benefit','gold','target_grade_benefit_cadence','weekly',
 'target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now(),'target_issue_ends_at',null,'target_valid_days',30)),'invalid_coupon_grade_cadence');
-- 등급 혜택을 비우면 '매월'을 보내도 '승급 시 1회'로 저장한다.
select public.admin_upsert_coupon_scheduled(jsonb_build_object(
 'target_code','T09M-ADMIN','target_previous_code','T09M-ADMIN','target_expected_revision',(:'switched'::jsonb->>'revision')::integer,
 'target_name','T09 저장 검증 이름','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now(),'target_ends_at',null,'target_status','active','target_grade_benefit',null,'target_grade_benefit_cadence','monthly',
 'target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now(),'target_issue_ends_at',null,'target_valid_days',30)) as cleared \gset
reset role;
select 1/case when (:'switched'::jsonb->>'revision')::integer>(:'renamed'::jsonb->>'revision')::integer
  and (select grade_benefit is null and grade_benefit_cadence='upgrade' from public.coupons where code='T09M-ADMIN')
  and (select count(*) from public.audit_log where action='commerce.coupon.schedule_updated' and target='coupons:T09M-ADMIN'
       and diff#>>'{before,gradeBenefitCadence}'='monthly' and diff#>>'{after,gradeBenefitCadence}'='upgrade')=1
then 1 else 0 end as assert_cadence_change_bumps_revision_and_audits;

-- ---------------------------------------------------------------------------
-- 승급 지급은 '승급 시 1회' 정의만 준다
-- ---------------------------------------------------------------------------
select private.grant_grade_benefit_coupons(pg_temp.t09_member(4),'welcome','platinum');
select 1/case when (select array_agg(coupon_code order by coupon_code) from public.user_coupons
                    where user_id=pg_temp.t09_member(4) and coupon_code like 'T09M-%')=array['T09M-UPGRADE']
then 1 else 0 end as assert_upgrade_grant_skips_monthly;

-- ---------------------------------------------------------------------------
-- 2031-03: 묶음 2명씩. 대상 = 01·02·03·10·11 (그 밖은 등급·계정·연령 조건으로 빠진다)
-- ---------------------------------------------------------------------------
select private.run_monthly_grade_coupons('2031-03-01 00:00:30+09',2) as march_one \gset
select 1/case when :'march_one'::jsonb->>'status'='continuing' and :'march_one'::jsonb->>'grantMonth'='2031-03'
  and (select cursor_user_id=pg_temp.t09_member(2) and batch_count=1 and finished_at is null
         and coupon_codes @> array['T09M-FIRST','T09M-GOLD','T09M-PLAT','T09M-SILVER']
         and not coupon_codes && array['T09M-UPGRADE','T09M-ARCHIVED','T09M-ENDED','T09M-CLOSED','T09M-WELCOME','T09M-PLAIN','T09M-ADMIN']
       from private.loyalty_monthly_coupon_runs where grant_month='2031-03-01')
then 1 else 0 end as assert_first_batch_continues_with_fixed_coupons;

-- 실행 중에 '매월'로 지정한 정의는 그 달 실행이 이미 고정했으므로 다음 달부터 준다.
insert into public.coupons(code,name,discount_type,discount_value,starts_at,issue_starts_at,valid_days,status,grade_benefit,grade_benefit_cadence)
 values('T09M-LATE','T09 매월 늦게 지정','fixed',700,now()-interval '1 day',now()-interval '1 day',30,'active','silver','monthly');

do $$
declare result jsonb; rounds integer := 0;
begin
  loop
    rounds := rounds + 1;
    result := private.run_monthly_grade_coupons('2031-03-01 00:01:30+09', 2);
    exit when result->>'status' = 'finished' or rounds > 50;
  end loop;
  if result->>'status' <> 'finished' then raise exception 'march run did not finish: %', result; end if;
end $$;

create temporary table t09_march as
select coupon_code, user_id, issued_source, issued_at, expires_at, usable_from, status, grade_benefit_month
from public.user_coupons where grade_benefit_month='2031-03-01' and coupon_code like 'T09M-%'
  and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n);

select 1/case when (
  select jsonb_object_agg(coupon_code, users) from (
    select coupon_code, jsonb_agg(right(user_id::text,2) order by user_id) as users from t09_march group by coupon_code) grouped
) = jsonb_build_object(
  'T09M-SILVER', jsonb_build_array('01','02','03','10','11'),
  -- 한도 2장: 회원 id 순으로 02·03 — 10은 남은 한도가 없다.
  'T09M-GOLD', jsonb_build_array('02','03'),
  'T09M-PLAT', jsonb_build_array('03'),
  -- 첫 구매 조건: 11은 결제 확정 주문이 있어 빠지고 나머지 대상은 받는다.
  'T09M-FIRST', jsonb_build_array('01','02','03','10'))
then 1 else 0 end as assert_march_recipients_by_grade_account_and_limit;

-- 지급 기록: 지급 경로·월·발급 시각·사용 기간(지급일 기준 30일 → KST 3/31 23:59:59.999)·발급 수.
select 1/case when not exists(select 1 from t09_march where issued_source<>'grade_benefit' or status<>'active'
    or issued_at<>'2031-03-01 00:00:30+09' and issued_at<>'2031-03-01 00:01:30+09')
  and (select bool_and(expires_at='2031-03-31 23:59:59.999+09' and usable_from=issued_at) from t09_march)
  and (select issued_count from public.coupons where code='T09M-GOLD')=2
  and (select issued_count from public.coupons where code='T09M-SILVER')=(select count(*) from public.user_coupons where coupon_code='T09M-SILVER')
  and (select finished_at is not null and finish_reason='completed' and member_count>=5
         and granted_count=(select count(*) from public.user_coupons where grade_benefit_month='2031-03-01')
         and notified_count=recipient_count
       from private.loyalty_monthly_coupon_runs where grant_month='2031-03-01')
  and (select count(*) from public.audit_log where action='commerce.coupon.grade_monthly_run_finished'
       and target='loyalty_monthly_coupons:2031-03' and diff->>'reason'='completed' and actor_id is null)=1
then 1 else 0 end as assert_march_ledger_counts_and_audit;

-- 회원·월마다 알림 한 건(지급 장수와 그 시점 등급).
select 1/case when (
  select jsonb_object_agg(right(user_id::text,2), body order by user_id) from public.notifications
  where type='loyalty_monthly_coupons_issued' and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n)
) = jsonb_build_object(
  '01','SILVER 등급 혜택 쿠폰 2장을 드렸어요. 쿠폰함에서 확인할 수 있어요.',
  '02','GOLD 등급 혜택 쿠폰 3장을 드렸어요. 쿠폰함에서 확인할 수 있어요.',
  '03','PLATINUM 등급 혜택 쿠폰 4장을 드렸어요. 쿠폰함에서 확인할 수 있어요.',
  '10','GOLD 등급 혜택 쿠폰 2장을 드렸어요. 쿠폰함에서 확인할 수 있어요.',
  '11','SILVER 등급 혜택 쿠폰 1장을 드렸어요. 쿠폰함에서 확인할 수 있어요.')
  and (select bool_and(title='이번 달 등급 혜택 쿠폰이 도착했어요' and link_path='/my/coupons' and source_id='2031-03'
         and dedupe_key='loyalty:monthly-coupons:'||user_id||':2031-03')
       from public.notifications where type='loyalty_monthly_coupons_issued' and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n))
then 1 else 0 end as assert_one_notification_per_member_month;

-- 같은 달은 다시 돌지 않는다.
select 1/case when private.run_monthly_grade_coupons('2031-03-20 12:00:00+09',200)->>'status'='already_ran'
then 1 else 0 end as assert_month_runs_once;
select 1/case when (select count(*) from public.user_coupons where grade_benefit_month='2031-03-01' and coupon_code like 'T09M-%'
  and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n))=(select count(*) from t09_march)
then 1 else 0 end as assert_rerun_adds_nothing;

-- ---------------------------------------------------------------------------
-- 2031-04: 등급 변동을 반영해 같은 쿠폰을 또 준다. 3월에 늦게 지정한 정의도 이제 준다.
-- ---------------------------------------------------------------------------
update public.profiles set loyalty_grade='gold' where id=pg_temp.t09_member(1);
update public.profiles set loyalty_grade='welcome' where id=pg_temp.t09_member(10);
update public.coupons set issue_limit=10 where code='T09M-GOLD';
select private.run_monthly_grade_coupons('2031-04-01 00:00:10+09',200) as april \gset
select 1/case when :'april'::jsonb->>'status'='finished'
  and (select jsonb_object_agg(coupon_code, users) from (
        select coupon_code, jsonb_agg(right(user_id::text,2) order by user_id) as users from public.user_coupons
        where grade_benefit_month='2031-04-01' and coupon_code like 'T09M-%'
          and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n) group by coupon_code) grouped)
      = jsonb_build_object(
        'T09M-SILVER', jsonb_build_array('01','02','03','11'),
        'T09M-GOLD', jsonb_build_array('01','02','03'),
        'T09M-PLAT', jsonb_build_array('03'),
        'T09M-FIRST', jsonb_build_array('01','02','03'),
        'T09M-LATE', jsonb_build_array('01','02','03','11'))
  -- 02번은 3월·4월의 실버 쿠폰을 따로 가진다.
  and (select count(*) from public.user_coupons where coupon_code='T09M-SILVER' and user_id=pg_temp.t09_member(2))=2
  and (select count(*) from public.notifications where type='loyalty_monthly_coupons_issued' and source_id='2031-04'
       and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n))=4
then 1 else 0 end as assert_april_grants_again_with_current_grades;

-- (코드, 회원, 월) 하나에 한 장은 스키마가 막는다.
select pg_temp.expect_error(format($$insert into public.user_coupons(coupon_code,user_id,issued_source,grade_benefit_month) values('T09M-SILVER',%L,'grade_benefit','2031-04-01')$$,
  pg_temp.t09_member(2)),'user_coupons_monthly_grade_key');
select pg_temp.expect_error(format($$insert into public.user_coupons(coupon_code,user_id,issued_source,grade_benefit_month) values('T09M-SILVER',%L,'code_entry','2031-05-01')$$,
  pg_temp.t09_member(2)),'user_coupons_grade_benefit_month_check');

-- 보유 판정(코드 입력·운영자 발급): 여러 장 중 사용 가능한 최신 한 장을 고른다. 새로 주지 않는다.
update public.user_coupons set status='used', used_at='2031-03-02 10:00+09'
 where coupon_code='T09M-SILVER' and user_id=pg_temp.t09_member(2) and grade_benefit_month='2031-03-01';
select private.issue_coupon_code('T09M-SILVER',pg_temp.t09_member(2),'code_entry') as held_by_code \gset
select 1/case when :'held_by_code'::uuid=(select id from public.user_coupons where coupon_code='T09M-SILVER' and user_id=pg_temp.t09_member(2) and grade_benefit_month='2031-04-01')
  and (select count(*) from public.user_coupons where coupon_code='T09M-SILVER' and user_id=pg_temp.t09_member(2))=2
  and (select (private.coupon_issue_rows(c, array[pg_temp.t09_member(2)])->0->>'userCouponId')::uuid from public.coupons c where c.code='T09M-SILVER')=:'held_by_code'::uuid
then 1 else 0 end as assert_held_lookup_prefers_active_latest;

-- ---------------------------------------------------------------------------
-- 놓친 달은 몰아서 주지 않는다: 5월 실행 없이 6월 중순에 처음 돌면 6월 몫만 준다
-- ---------------------------------------------------------------------------
select private.run_monthly_grade_coupons('2031-06-15 13:00:00+09',200) as june \gset
select 1/case when :'june'::jsonb->>'status'='finished'
  and not exists(select 1 from public.user_coupons where grade_benefit_month='2031-05-01')
  and not exists(select 1 from private.loyalty_monthly_coupon_runs where grant_month='2031-05-01')
  and (select count(*) from public.user_coupons where grade_benefit_month='2031-06-01' and coupon_code='T09M-SILVER'
       and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n) and issued_at='2031-06-15 13:00:00+09')=4
then 1 else 0 end as assert_missed_month_not_backfilled_late_start_grants;

-- 끝나지 못한 7월 실행은 8월에 이어 주지 않고 닫는다.
select private.run_monthly_grade_coupons('2031-07-01 00:00:10+09',1) as july \gset
select 1/case when :'july'::jsonb->>'status'='continuing' then 1 else 0 end as assert_july_partial;
select private.run_monthly_grade_coupons('2031-08-01 00:00:10+09',200) as august \gset
select 1/case when :'august'::jsonb->>'status'='finished'
  and (select finish_reason='month_ended' and cursor_user_id=pg_temp.t09_member(1) from private.loyalty_monthly_coupon_runs where grant_month='2031-07-01')
  and (select array_agg(distinct right(user_id::text,2) order by right(user_id::text,2)) from public.user_coupons
       where grade_benefit_month='2031-07-01' and coupon_code like 'T09M-%')=array['01']
  and (select count(distinct user_id) from public.user_coupons where grade_benefit_month='2031-08-01' and coupon_code like 'T09M-%'
       and user_id in (select pg_temp.t09_member(n) from generate_series(0,11) n))=4
  and (select count(*) from public.audit_log where action='commerce.coupon.grade_monthly_run_finished' and target='loyalty_monthly_coupons:2031-07'
       and diff->>'reason'='month_ended')=1
then 1 else 0 end as assert_unfinished_previous_month_closed_not_continued;

-- 지급할 '매월' 정의가 없는 달은 바로 닫는다.
update public.coupons set grade_benefit_cadence='upgrade' where grade_benefit_cadence='monthly';
select private.run_monthly_grade_coupons('2031-09-01 00:00:10+09',200) as september \gset
select 1/case when :'september'::jsonb->>'reason'='no_monthly_coupons'
  and (select finish_reason='no_monthly_coupons' and coupon_codes='{}' from private.loyalty_monthly_coupon_runs where grant_month='2031-09-01')
  and not exists(select 1 from public.user_coupons where grade_benefit_month='2031-09-01')
then 1 else 0 end as assert_month_without_monthly_coupons;
select pg_temp.expect_error($$select private.run_monthly_grade_coupons(null,200)$$,'invalid_monthly_grade_coupon_run');
select pg_temp.expect_error($$select private.run_monthly_grade_coupons('2031-10-01 00:00+09',0)$$,'invalid_monthly_grade_coupon_run');

-- ---------------------------------------------------------------------------
-- 읽기: 마이페이지 등급 혜택 안내·고객등급 관리
-- ---------------------------------------------------------------------------
-- 골드는 앞선 달들이 한도를 다 써서 안내에서 빠진다 — 읽기 단언을 위해 한도를 늘린다.
update public.coupons set grade_benefit_cadence='monthly' where code in ('T09M-SILVER','T09M-GOLD');
update public.coupons set issue_limit=100 where code='T09M-GOLD';
select pg_temp.as_actor(pg_temp.t09_member(3));
set local role authenticated;
select public.get_loyalty_grade_benefits() as platinum_view \gset
select pg_temp.as_actor(pg_temp.t09_member(4));
select public.get_loyalty_grade_benefits() as welcome_view \gset
select pg_temp.as_actor(pg_temp.t09_member(0));
select public.admin_get_loyalty_policy() as policy \gset
reset role;

select 1/case when (
    select jsonb_object_agg(coupon->>'name', coupon->>'cadence')
    from jsonb_array_elements(:'platinum_view'::jsonb->'grades') grade(value)
    cross join lateral jsonb_array_elements(grade.value->'coupons') entry(coupon)
    where coupon->>'name' in ('T09 매월 실버','T09 매월 골드 한도','T09 승급 골드')
  ) = jsonb_build_object('T09 매월 실버','monthly','T09 매월 골드 한도','monthly','T09 승급 골드','upgrade')
  -- 아직 오르지 않은 등급은 매월 지급 장수만 안다(코드·이름 없음).
  and (select (value->'couponCounts'->>'monthly')::integer >= 1 and jsonb_array_length(value->'coupons')=0
       from jsonb_array_elements(:'welcome_view'::jsonb->'grades') where value->>'grade'='gold')
  and position('T09M-' in :'platinum_view') = 0
then 1 else 0 end as assert_member_view_shows_cadence;

select 1/case when (select value->>'cadence' from jsonb_array_elements(:'policy'::jsonb->'coupons') where value->>'code'='T09M-SILVER')='monthly'
  and (select value->>'cadence' from jsonb_array_elements(:'policy'::jsonb->'coupons') where value->>'code'='T09M-UPGRADE')='upgrade'
  and (select value->>'finishReason'='completed' and (value->>'granted')::integer>=10
         and (select (coupon->>'granted')::integer from jsonb_array_elements(value->'coupons') coupon where coupon->>'code'='T09M-SILVER')
             =(select count(*) from public.user_coupons where grade_benefit_month='2031-03-01' and coupon_code='T09M-SILVER')
       from jsonb_array_elements(:'policy'::jsonb->'monthlyRuns') where value->>'grantMonth'='2031-03')
  and jsonb_array_length(:'policy'::jsonb->'monthlyRuns') between 1 and 6
  and (select value->>'grantMonth' from jsonb_array_elements(:'policy'::jsonb->'monthlyRuns') with ordinality r(value, position) where position=1)='2031-09'
then 1 else 0 end as assert_admin_policy_reads_cadence_and_runs;

rollback;
