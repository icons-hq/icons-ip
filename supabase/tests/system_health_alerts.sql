\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 시스템 경보(원장 OPS-039·OPS-040·PAY-067·PAY-063·CUS-066)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · cron 실행 기록: 성공은 상태만, 실패는 실패 기록 한 줄 + 같은 작업의 '시스템' 운영 알림은 한 시간에 하나(incident)
--     잘못된 입력(작업 이름·오류 코드·상세 크기·시각)은 거절한다. 늦게 온 옛 실행이 최신 상태를 덮지 않는다
--   · 판정: Vercel 작업의 실패 중·멈춤(기록 끊김), pg_cron 실패 실행·멈춤, 미종결 결제 시도, 메일 실패·반송, 운영 할 일 건수
--   · 결제 기한 만료 sweep: 한 주문의 오류가 다른 주문의 만료를 되돌리지 않고, 건너뛴 주문은 실패 기록(pg_cron)·알림에 남는다
--   · 미종결 결제 목록(sales.manage)·결제 상태 다시 확인 시작(감사·멱등·충돌·쿨다운·종결 거절)·자동 재확인 후보(service_role)
--   · 운영 알림 '시스템' 분류는 platform.manage에게만 보이고, 운영 할 일 '시스템 점검'도 platform.manage에게만 있다
--   · 권한 봉인(선언적 확인)과 보존 잡
-- ============================================================================

select 1/case when (
  has_function_privilege('service_role','public.service_record_system_job_run(text,text,integer,timestamptz,timestamptz,boolean,integer,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.service_record_system_job_run(text,text,integer,timestamptz,timestamptz,boolean,integer,text,jsonb)','execute')
  and not has_function_privilege('anon','public.service_record_system_job_run(text,text,integer,timestamptz,timestamptz,boolean,integer,text,jsonb)','execute')
  and has_function_privilege('service_role','public.service_list_payment_reconciliation_candidates(integer)','execute')
  and not has_function_privilege('authenticated','public.service_list_payment_reconciliation_candidates(integer)','execute')
  and has_function_privilege('authenticated','public.admin_system_health()','execute')
  and not has_function_privilege('anon','public.admin_system_health()','execute')
  and not has_function_privilege('service_role','public.admin_system_health()','execute')
  and has_function_privilege('authenticated','public.admin_unresolved_payment_attempts(integer)','execute')
  and not has_function_privilege('service_role','public.admin_unresolved_payment_attempts(integer)','execute')
  and has_function_privilege('authenticated','public.admin_begin_payment_reconciliation(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.admin_begin_payment_reconciliation(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_begin_payment_reconciliation(uuid,uuid)','execute')
  and not has_function_privilege('service_role','private.record_system_job_failure(text,text,text,timestamptz,integer,text,jsonb)','execute')
  and not has_function_privilege('authenticated','private.system_health_report()','execute')
  and not has_function_privilege('service_role','private.system_health_report()','execute')
  and not has_table_privilege('service_role','private.system_job_status','select,insert,update,delete')
  and not has_table_privilege('service_role','private.system_job_failures','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.system_job_failures','select')
  and (select bool_and(provolatile='s') from pg_proc where oid in ('public.admin_system_health()'::regprocedure,
    'public.admin_unresolved_payment_attempts(integer)'::regprocedure,'public.service_list_payment_reconciliation_candidates(integer)'::regprocedure))
  and (select provolatile='v' from pg_proc where oid='public.admin_begin_payment_reconciliation(uuid,uuid)'::regprocedure)
  and (select count(*) from private.operator_rpc_contracts where (signature,capability,guard_kind) in (
    ('public.admin_system_health()','platform.manage','read'),
    ('public.admin_unresolved_payment_attempts(integer)','sales.manage','read'),
    ('public.admin_begin_payment_reconciliation(uuid,uuid)','sales.manage','write')))=3
  and (select count(*) from cron.job where jobname='system-job-records-retention')=1
  and private.operator_alert_capability('system')='platform.manage'
) then 1 else 0 end as assert_sealed_acl;

select 1/case when private.cron_schedule_minutes('* * * * *')=1 and private.cron_schedule_minutes('*/5 * * * *')=5
  and private.cron_schedule_minutes('17 * * * *')=60 and private.cron_schedule_minutes('0 */6 * * *')=360
  and private.cron_schedule_minutes('30 19 * * *')=1440 and private.cron_schedule_minutes('0 0 1 * *') is null
  and private.cron_schedule_minutes('30 seconds') is null
then 1 else 0 end as assert_cron_schedule_minutes;

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: % (statement %)',expected,statement;
end $$;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;

-- 운영자: 주매니저(platform.manage·sales.manage), 부매니저(둘 다 없음), 구매자.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a7000000-0000-4000-8000-000000000001','authenticated','authenticated','health-primary@example.test',now(),'{}','{}',now(),now()),
 ('a7000000-0000-4000-8000-000000000002','authenticated','authenticated','health-deputy@example.test',now(),'{}','{}',now(),now()),
 ('a7000000-0000-4000-8000-000000000003','authenticated','authenticated','health-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 시스템 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='a7000000-0000-4000-8000-000000000003' then 'user'::public.user_role else 'staff'::public.user_role end
 where id in('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values
 ('a7000000-0000-4000-8000-000000000001','primary'),('a7000000-0000-4000-8000-000000000002','deputy');
update private.operator_access_state set configured=true where id;

-- ---------------------------------------------------------------------------
-- 1. cron 실행 기록(service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
select 1/case when (public.service_record_system_job_run('t7-smoke-ok','합성 정상 작업',1,clock_timestamp()-interval '2 seconds',clock_timestamp(),true,200)->>'incident')::boolean=false
 then 1 else 0 end as assert_success_recorded_without_incident;
select 1/case when (public.service_record_system_job_run('t7-smoke-fail','합성 실패 작업',1,clock_timestamp()-interval '3 seconds',clock_timestamp(),false,503,'unhealthy_result','{"failed":2}')->>'incident')::boolean
 and (public.service_record_system_job_run('t7-smoke-fail','합성 실패 작업',1,clock_timestamp()-interval '3 seconds',clock_timestamp(),false,503,'exception:Error')->>'incident')::boolean=false
 then 1 else 0 end as assert_failure_incident_once_per_hour;
-- 늦게 도착한 옛 성공이 최신 실패 상태(코드)를 덮지 않는다. 다만 성공이 오면 연속 실패는 끊긴다.
select public.service_record_system_job_run('t7-smoke-fail','합성 실패 작업',1,clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '9 minutes',true,200);
select pg_temp.expect_error($$select public.service_record_system_job_run('Bad_Key','x',1,clock_timestamp(),clock_timestamp(),true,200)$$,'invalid_system_job_run');
select pg_temp.expect_error($$select public.service_record_system_job_run('t7-smoke-ok','x',1,clock_timestamp(),clock_timestamp(),true,200,'leak')$$,'invalid_system_job_run');
select pg_temp.expect_error($$select public.service_record_system_job_run('t7-smoke-ok','x',1,clock_timestamp(),clock_timestamp(),false,503,'has space')$$,'invalid_system_job_run');
select pg_temp.expect_error($$select public.service_record_system_job_run('t7-smoke-ok','x',1,clock_timestamp(),clock_timestamp()-interval '1 minute',true,200)$$,'invalid_system_job_run');
select pg_temp.expect_error($$select public.service_record_system_job_run('t7-smoke-ok','x',1,clock_timestamp(),clock_timestamp(),false,503,'big',jsonb_build_object('blob',repeat('x',3000)))$$,'invalid_system_job_run');
select pg_temp.expect_error($$select public.service_record_system_job_run('t7-smoke-ok','x',0,clock_timestamp(),clock_timestamp(),true,200)$$,'invalid_system_job_run');
reset role;

select 1/case when (select consecutive_failures=0 and last_error_code='exception:Error' and last_status_code=503 and last_success_at<last_failure_at
   from private.system_job_status where job_key='t7-smoke-fail')
 and (select count(*) from private.system_job_failures where job_key='t7-smoke-fail' and source='vercel_cron')=2
 and (select detail from private.system_job_failures where job_key='t7-smoke-fail' and error_code='unhealthy_result')='{"failed":2}'
 and (select count(*) from private.admin_operation_alerts where category='system' and event_key like 'system_job:t7-smoke-fail:%')=1
 and (select href from private.admin_operation_alerts where category='system' and event_key like 'system_job:t7-smoke-fail:%')='/admin/settings/system'
 and (select consecutive_failures=0 and last_error_code is null from private.system_job_status where job_key='t7-smoke-ok')
then 1 else 0 end as assert_records_and_alert_shape;

-- 지금 실패 중인 작업(연속 실패)과 기록이 끊긴 작업(멈춤)을 만든다.
set local role service_role;
select public.service_record_system_job_run('t7-smoke-fail','합성 실패 작업',1,clock_timestamp()-interval '1 second',clock_timestamp(),false,502,'subscription_work_unavailable');
reset role;
insert into private.system_job_status(job_key,label,expected_interval_minutes,last_started_at,last_finished_at,last_success_at,last_status_code,consecutive_failures)
values('t7-smoke-stalled','합성 멈춘 작업',10,now()-interval '2 hours',now()-interval '2 hours',now()-interval '2 hours',200,0);

-- pg_cron: 실패 실행이 마지막인 합성 잡, 표본 안에 성공이 없는 합성 매분 잡(멈춤).
select cron.schedule('t7-smoke-cron-failing','*/5 * * * *','select 1') as failing_job \gset
select cron.schedule('t7-smoke-cron-stalled','* * * * *','select 1') as stalled_job \gset
-- 런 번호는 시퀀스 대신 현재 최대값 뒤의 큰 수를 쓴다(표본은 런 번호 역순이라 합성 실행이 표본 안에 든다).
select coalesce(max(runid),0)+1000000 as run_base from cron.job_run_details \gset
insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time) values
 (:failing_job,:run_base+1,1,'postgres','postgres','select 1','succeeded','1 row',now()-interval '20 minutes',now()-interval '20 minutes'),
 (:failing_job,:run_base+2,1,'postgres','postgres','select 1','failed','ERROR: 합성 오류 원문 비노출',now()-interval '5 minutes',now()-interval '5 minutes'),
 (:stalled_job,:run_base+3,1,'postgres','postgres','select 1','failed','ERROR: 합성',now()-interval '3 days',now()-interval '3 days');

-- ---------------------------------------------------------------------------
-- 2. 결제 기한 만료 sweep: 한 주문의 오류가 다른 주문의 만료를 되돌리지 않는다
-- ---------------------------------------------------------------------------
insert into public.ips(id,title,vertical_key) values('t7-health-ip','TEST 시스템 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('t7-health-goods','t7-health-ip','TEST 시스템 굿즈','문구',10000,'ok',100);
create function pg_temp.pending_order(oid uuid) returns uuid language plpgsql as $$begin
 insert into public.orders(id,user_id,status,total,expires_at) values(oid,'a7000000-0000-4000-8000-000000000003','pending',10000,now()-interval '30 minutes');
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'t7-health-goods',1,10000,'TEST 시스템 굿즈','문구','t7-health-ip',(select id from public.goods_variants where good_id='t7-health-goods' and is_default));
 return oid;
end $$;
select pg_temp.pending_order('a7000000-0000-4001-8000-000000000001'), pg_temp.pending_order('a7000000-0000-4001-8000-000000000002');
-- 합성 결함: 1번 주문만 취소 전이에서 거절한다(트랜잭션과 함께 사라진다).
create function public.t7_smoke_reject_cancel() returns trigger language plpgsql as $$begin
 raise exception 'synthetic sweep failure' using errcode='P0001';
end $$;
create trigger t7_smoke_reject_cancel before update of status on public.orders for each row
 when (new.id='a7000000-0000-4001-8000-000000000001' and new.status='canceled') execute function public.t7_smoke_reject_cancel();

-- 공유 DB에 다른 만료 주문이 남아 있을 수 있어 처리 건수는 하한만 본다(판정은 아래 두 주문의 상태로 한다).
select 1/case when public.expire_stale_checkouts()>=1 then 1 else 0 end as assert_sweep_continues_after_row_failure;
select 1/case when (select status from public.orders where id='a7000000-0000-4001-8000-000000000001')='pending'
 and (select status from public.orders where id='a7000000-0000-4001-8000-000000000002')='canceled'
 and (select count(*) from private.system_job_failures where job_key='expire-stale-checkouts' and source='pg_cron'
   and error_code='sqlstate_P0001' and (detail->>'skipped')::integer>=1 and detail->'targets' ? 'order:a7000000-0000-4001-8000-000000000001')=1
 and (select count(*) from private.admin_operation_alerts where category='system' and event_key like 'system_job:expire-stale-checkouts:%')=1
 and not exists(select 1 from private.system_job_failures where detail::text like '%synthetic sweep failure%')
then 1 else 0 end as assert_skipped_row_recorded_without_message;
drop trigger t7_smoke_reject_cancel on public.orders;

-- ---------------------------------------------------------------------------
-- 3. 미종결 결제 시도
-- ---------------------------------------------------------------------------
-- 공유 DB에 다른 테스트가 커밋한 미종결 시도가 있을 수 있어 건수는 시작 전 기준에 더해 본다.
select count(*) as base_unresolved, count(*) filter (where purpose='order') as base_goods from public.payment_attempts
 where private.payment_attempt_unresolved(state,claim_expires_at,now()) \gset
create function pg_temp.attempt(n integer,provider public.payment_provider,purpose public.payment_purpose,state public.payment_attempt_state,
  claim_expires interval default null,age interval default interval '1 hour',touched interval default interval '1 hour') returns uuid language plpgsql as $$
declare aid uuid:=('a7000000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid; oid uuid:=('a7000000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 if purpose='order' then
  insert into public.orders(id,user_id,status,total) values(oid,'a7000000-0000-4000-8000-000000000003','pending',10000+n);
 end if;
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,
   expires_at,claim_token,claim_expires_at,created_at,updated_at)
 values(aid,provider,'a7000000-0000-4000-8000-000000000003',purpose,case when purpose='order' then oid end,10000+n,'KRW',state,'t7-health-'||n,'T7-HEALTH-ORDER-'||n,
   'T7-HEALTH-PRODUCT-'||n,now()+interval '1 hour',case when claim_expires is not null then gen_random_uuid() end,now()+claim_expires,now()-age,now()-touched);
 return aid;
end $$;
select pg_temp.attempt(1,'toss','order','unknown') as unknown_attempt,
  pg_temp.attempt(2,'nicepay','order','needs_review') as review_attempt,
  pg_temp.attempt(3,'toss','order','confirming',interval '-5 minutes') as stalled_attempt,
  pg_temp.attempt(4,'toss','order','confirming',interval '5 minutes') as live_attempt,
  pg_temp.attempt(5,'toss','order','approved') as approved_attempt,
  pg_temp.attempt(6,'korpay','order','needs_review') as korpay_attempt,
  pg_temp.attempt(7,'toss','order','unknown',null,interval '1 hour',interval '2 minutes') as fresh_attempt,
  pg_temp.attempt(8,'toss','order','unknown',null,interval '8 days',interval '8 days') as old_attempt,
  pg_temp.attempt(9,'toss','order','unknown') as audited_attempt \gset
-- 9번은 방금(웹훅·운영자) 확인한 시도다.
insert into private.goods_payment_reconciliation_audits(claim_token,operation,target_id,actor_ref,case_ref,claim_status)
values(gen_random_uuid(),'payment',:'audited_attempt','goods_payment_reconciliation_service_v1','t7-smoke-recent-check-01','in_progress');

-- 자동 재확인 후보: 결과 불명·멈춘 확인만, 조회 API가 있는 결제사, 10분 지난 변경, 7일 안, 30분 쿨다운.
-- 다른 테스트의 미종결 시도는 이 트랜잭션 안에서만 방금 바뀐 것으로 만들어(갱신 트리거가 updated_at을 지금으로) 후보에서 뺀다.
update public.payment_attempts set amount=amount where state in ('unknown','confirming') and id::text not like 'a7000000-0000-4003-%';
set local role service_role;
select 1/case when (select array_agg(e->>'attemptId' order by e->>'attemptId') from jsonb_array_elements(public.service_list_payment_reconciliation_candidates(5)) e)
   = array[:'unknown_attempt',:'stalled_attempt']
 and jsonb_array_length(public.service_list_payment_reconciliation_candidates(1))=1
then 1 else 0 end as assert_auto_candidates;
select pg_temp.expect_error($$select public.service_list_payment_reconciliation_candidates(6)$$,'invalid_reconciliation_candidate_limit');
reset role;

-- 목록(sales.manage): 이 시험의 미종결 7건(1·2·3·6·7·8·9 — 승인 5번·리스가 살아 있는 확인 4번 제외)이 기준 건수에 더해진다.
set local role authenticated;
select pg_temp.as_actor('a7000000-0000-4000-8000-000000000001');
select public.admin_unresolved_payment_attempts(200) as list \gset
select 1/case when (:'list'::jsonb->>'total')::integer=:base_unresolved+7
 and jsonb_array_length(:'list'::jsonb->'items')=least(:base_unresolved+7,200)
 and not exists(select 1 from jsonb_array_elements(:'list'::jsonb->'items') e where e->>'attemptId' in (:'live_attempt',:'approved_attempt'))
 and exists(select 1 from jsonb_array_elements(:'list'::jsonb->'items') e where e->>'attemptId'=:'stalled_attempt' and e->>'reason'='confirming_stalled'
   and (e->>'reconcilable')::boolean and e->>'orderNumber' is not null and (e->>'amount')::integer=10003)
 and exists(select 1 from jsonb_array_elements(:'list'::jsonb->'items') e where e->>'attemptId'=:'korpay_attempt' and not (e->>'reconcilable')::boolean)
 and exists(select 1 from jsonb_array_elements(:'list'::jsonb->'items') e where e->>'attemptId'=:'audited_attempt' and e->>'lastCheckedAt' is not null)
 and not (:'list'::jsonb::text ~ 'health-buyer|user_id|userId')
 and jsonb_array_length(public.admin_unresolved_payment_attempts(2)->'items')=2
then 1 else 0 end as assert_unresolved_list;
select pg_temp.expect_error($$select public.admin_unresolved_payment_attempts(0)$$,'invalid_payment_attempt_filter');

-- 결제 상태 다시 확인 시작: 감사 기록·같은 요청번호 재요청·다른 대상 충돌·종결 거절·쿨다운.
select public.admin_begin_payment_reconciliation(:'unknown_attempt','a7000000-0000-4009-8000-000000000001') as began \gset
select 1/case when :'began'::jsonb->>'caseRef'='admin-a7000000000040098000000000000001'
 and :'began'::jsonb->>'purpose'='order' and :'began'::jsonb->>'provider'='toss' and :'began'::jsonb->>'state'='unknown'
 and public.admin_begin_payment_reconciliation(:'unknown_attempt','a7000000-0000-4009-8000-000000000001')->>'caseRef'='admin-a7000000000040098000000000000001'
then 1 else 0 end as assert_begin_idempotent;
select pg_temp.expect_error($$select public.admin_begin_payment_reconciliation('a7000000-0000-4003-8000-000000000002','a7000000-0000-4009-8000-000000000001')$$,'payment_reconciliation_operation_conflict');
select pg_temp.expect_error($$select public.admin_begin_payment_reconciliation('a7000000-0000-4003-8000-000000000005','a7000000-0000-4009-8000-000000000002')$$,'payment_attempt_not_unresolved');
select pg_temp.expect_error($$select public.admin_begin_payment_reconciliation('a7000000-0000-4003-8000-000000000004','a7000000-0000-4009-8000-000000000003')$$,'payment_attempt_not_unresolved');
select pg_temp.expect_error($$select public.admin_begin_payment_reconciliation('a7000000-0000-4003-8000-000000000009','a7000000-0000-4009-8000-000000000004')$$,'payment_reconciliation_cooldown');
select pg_temp.expect_error($$select public.admin_begin_payment_reconciliation('a7000000-0000-4003-8000-0000000000ff','a7000000-0000-4009-8000-000000000005')$$,'payment_attempt_not_found');
reset role;
select 1/case when (select count(*) from public.audit_log where id='a7000000-0000-4009-8000-000000000001'
   and actor_id='a7000000-0000-4000-8000-000000000001' and action='admin.payment_attempt.reconcile_requested'
   and target='payment_attempt:'||:'unknown_attempt' and diff->>'stateBefore'='unknown' and diff->>'caseRef'='admin-a7000000000040098000000000000001')=1
 and (select count(*) from public.audit_log where action='admin.payment_attempt.reconcile_requested' and actor_id='a7000000-0000-4000-8000-000000000001')=1
then 1 else 0 end as assert_reconcile_audit;

-- ---------------------------------------------------------------------------
-- 4. 판정·운영 할 일·운영 알림
-- ---------------------------------------------------------------------------
-- 메일: 실패 1(레거시 발송 기록), 반송 1(발송 의도)
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status,safe_error_code)
values('t7-health-mail-1','order_confirmation','buyer@example.test','합성 메일','failed','provider_failure');
insert into private.email_intents(source,source_reference_digest,recipient_digest,message_kind,content_revision,state,updated_at)
values('order_delay_notice',sha256('t7-health-intent'::bytea),sha256('t7-health-recipient'::bytea),'order_delay_notice','v1','bounced',now());

set local role authenticated;
select pg_temp.as_actor('a7000000-0000-4000-8000-000000000001');
select public.admin_system_health() as health \gset
select 1/case when exists(select 1 from jsonb_array_elements(:'health'::jsonb->'jobs') e where e->>'jobKey'='t7-smoke-fail' and e->>'source'='vercel_cron'
   and (e->>'failing')::boolean and not (e->>'stalled')::boolean and (e->>'failures24h')::integer=3 and e->>'label'='합성 실패 작업')
 and exists(select 1 from jsonb_array_elements(:'health'::jsonb->'jobs') e where e->>'jobKey'='t7-smoke-stalled' and (e->>'stalled')::boolean and not (e->>'failing')::boolean)
 and exists(select 1 from jsonb_array_elements(:'health'::jsonb->'jobs') e where e->>'jobKey'='t7-smoke-ok' and not (e->>'stalled')::boolean and not (e->>'failing')::boolean)
 and exists(select 1 from jsonb_array_elements(:'health'::jsonb->'jobs') e where e->>'jobKey'='t7-smoke-cron-failing' and e->>'source'='pg_cron'
   and (e->>'failing')::boolean and e->>'lastErrorCode'='pg_cron_failed' and (e->>'expectedIntervalMinutes')::integer=5 and (e->>'failures24h')::integer=1)
 and exists(select 1 from jsonb_array_elements(:'health'::jsonb->'jobs') e where e->>'jobKey'='t7-smoke-cron-stalled' and (e->>'stalled')::boolean)
 and exists(select 1 from jsonb_array_elements(:'health'::jsonb->'jobs') e where e->>'jobKey'='expire-stale-checkouts' and (e->>'failing')::boolean
   and e->>'lastErrorCode'='rows_skipped' and (e->>'failures24h')::integer>=1)
 and exists(select 1 from jsonb_array_elements(:'health'::jsonb->'recentFailures') e where e->>'jobKey'='t7-smoke-cron-failing' and e->>'errorCode'='pg_cron_failed')
 and position('합성 오류 원문' in :'health'::jsonb::text)=0
 and (:'health'::jsonb->'counts'->>'unresolvedPayments')::integer=:base_unresolved+7
 and (:'health'::jsonb->'payments'->>'goods')::integer=:base_goods+7
 and (:'health'::jsonb->'counts'->>'emailFailures')::integer>=1
 and (:'health'::jsonb->'counts'->>'emailBounces')::integer>=1
 and (:'health'::jsonb->'counts'->>'issues')::integer=(:'health'::jsonb->'counts'->>'problemJobs')::integer
   +(:'health'::jsonb->'counts'->>'unresolvedPayments')::integer+(:'health'::jsonb->'counts'->>'emailFailures')::integer
 and (:'health'::jsonb->'counts'->>'problemJobs')::integer>=5
then 1 else 0 end as assert_health_report;

select 1/case when exists(select 1 from jsonb_array_elements(public.admin_operation_tasks()) e where e->>'id'='system' and e->>'href'='/admin/settings/system'
   and (e->>'count')::integer=(:'health'::jsonb->'counts'->>'issues')::integer)
 and exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('system','all')->'items') e where e->>'category'='system')
 and (select count(*) from jsonb_array_elements(public.admin_operation_alerts('all','all')->'items') e where e->>'category'='system')>=2
 and public.admin_update_operation_alerts('read',null,clock_timestamp(),'system','all')>=2
then 1 else 0 end as assert_dock_system_task_and_alerts;

-- 부매니저(platform.manage·sales.manage 없음): 화면·목록·시작 거절, 운영 할 일·알림에 시스템이 없다.
select pg_temp.as_actor('a7000000-0000-4000-8000-000000000002');
select pg_temp.expect_error($$select public.admin_system_health()$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_unresolved_payment_attempts(50)$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_begin_payment_reconciliation('a7000000-0000-4003-8000-000000000002','a7000000-0000-4009-8000-000000000006')$$,'operator_capability_required');
select 1/case when not exists(select 1 from jsonb_array_elements(public.admin_operation_tasks()) e where e->>'id'='system')
 and not exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('all','all')->'items') e where e->>'category'='system')
 and jsonb_array_length(public.admin_operation_alerts('system','all')->'items')=0
then 1 else 0 end as assert_deputy_without_system;

-- 구매자: 전부 거절.
select pg_temp.as_actor('a7000000-0000-4000-8000-000000000003');
select pg_temp.expect_error($$select public.admin_system_health()$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_unresolved_payment_attempts(50)$$,'operator_capability_required');
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.payment_attempt.reconcile_requested'
  and actor_id in ('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000003'))=0 then 1 else 0 end as assert_denied_without_audit;

rollback;
