\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 운영 알림 요약 메일 (OPS-095·CUS-071·CUS-076)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 설정 저장은 platform.manage만(고객·무권한 거절), 수신자 정규화·10개 상한·범주 검증·지연 시간 범위, 같은 요청 재전송은 같은 결과,
--     다른 버전은 PT409, 감사 기록. 기본은 꺼짐·4시간·네 범주 전부
--   · 켤 때 커서를 지금으로 옮겨 꺼져 있던 동안의 알림이 쏟아지지 않는다
--   · 새 문의·새 상품 문의·시스템 알림을 한 요약으로 세고(주문 알림은 세지 않음) 커서는 한 번씩만 센다. 10분에 한 통까지(throttle)
--   · 답변 지연: 설정 시간을 넘긴 open 문의·미답변 상품 문의를 문의당 한 번만, 다시 열려 또 늦으면 다시, 답변되면 빼고, 7일 넘게 묵은 건 세지 않는다
--   · 범주를 좁히면 고른 범주만 센다(지연 범주를 빼면 지연도 표식 없이 건너뜀)
--   · 요약·선점 결과에 문의 제목·본문이 들어가지 않는다
--   · 선점·결속·완료·만료·재시도와 전용 dispatcher gate(다른 출처 gate와 분리, 꺼지면 선점 없음)
-- 요약 시각(p_now)은 미래로 줘서 실제 시계와 겹치지 않게 한다(요약 created_at = p_now).
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_get_ops_alert_digest()','execute')
  and not has_function_privilege('anon','public.admin_get_ops_alert_digest()','execute')
  and has_function_privilege('authenticated','public.admin_save_ops_alert_digest(boolean,text[],text[],integer,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_ops_alert_digest(boolean,text[],text[],integer,bigint,uuid)','execute')
  and has_function_privilege('service_role','public.claim_ops_alert_digest_jobs(integer)','execute')
  and not has_function_privilege('authenticated','public.claim_ops_alert_digest_jobs(integer)','execute')
  and not has_function_privilege('anon','public.bind_ops_alert_digest_intent(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.finish_ops_alert_digest_job(uuid,uuid,text,text,boolean)','execute')
  and not has_function_privilege('service_role','private.prepare_ops_alert_digest(timestamptz)','execute')
  and not has_table_privilege('authenticated','private.ops_alert_digest_settings','select,update')
  and not has_table_privilege('service_role','private.ops_alert_digest_deliveries','select,insert,update')
  and (select count(*)=2 from private.operator_rpc_contracts where capability='platform.manage' and signature like 'public.%ops_alert_digest%')
) then 1 else 0 end as assert_sealed_acl_and_contracts;

select 1/case when (select revision>1 or (not enabled and delay_hours=4 and recipients='{}' and enabled_at is null
    and categories=array['inquiries','questions','delay','system']::text[]) from private.ops_alert_digest_settings where singleton)
  then 1 else 0 end as assert_starts_disabled;

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.expect_state(statement text,expected text) returns void language plpgsql as $$
declare code text;begin
 begin execute statement;exception when others then get stacked diagnostics code=returned_sqlstate;
  if code=expected then return;end if;raise;end;
 raise exception 'Expected SQLSTATE: %',expected;
end $$;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('0a1e0000-0000-4000-8000-000000000001','authenticated','authenticated','ops-digest-operator@example.test',now(),'{}','{}',now(),now()),
 ('0a1e0000-0000-4000-8000-000000000002','authenticated','authenticated','ops-digest-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 운영알림 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='0a1e0000-0000-4000-8000-000000000001' then 'staff'::public.user_role else 'user'::public.user_role end
 where id in('0a1e0000-0000-4000-8000-000000000001','0a1e0000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('0a1e0000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('ops-digest-ip','TEST 운영알림 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('ops-digest-g1','ops-digest-ip','TEST 운영알림 굿즈','문구',10000,'ok',10);

-- ---------------------------------------------------------------------------
-- 설정 저장
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('0a1e0000-0000-4000-8000-000000000002');
select pg_temp.expect_state($$select public.admin_get_ops_alert_digest()$$,'42501');
select pg_temp.expect_state($$select public.admin_save_ops_alert_digest(true,'{a@example.test}','{inquiries}',4,1,gen_random_uuid())$$,'42501');
select pg_temp.as_actor('0a1e0000-0000-4000-8000-000000000001');
select (public.admin_get_ops_alert_digest()->>'revision')::bigint as rev \gset
select pg_temp.expect_error(format('select public.admin_save_ops_alert_digest(true,%L::text[],%L::text[],4,%s,gen_random_uuid())','{not-an-email}','{inquiries}',:'rev'),'invalid_ops_alert_recipient');
select pg_temp.expect_error(format('select public.admin_save_ops_alert_digest(true,%L::text[],%L::text[],4,%s,gen_random_uuid())','{a@example.test}','{inquiries,payments}',:'rev'),'invalid_ops_alert_category');
select pg_temp.expect_error(format('select public.admin_save_ops_alert_digest(true,%L::text[],%L::text[],4,%s,gen_random_uuid())','{a@example.test}','{}',:'rev'),'invalid_ops_alert_category');
select pg_temp.expect_error(format('select public.admin_save_ops_alert_digest(true,%L::text[],%L::text[],0,%s,gen_random_uuid())','{a@example.test}','{inquiries}',:'rev'),'invalid_ops_alert_digest');
select pg_temp.expect_error(format('select public.admin_save_ops_alert_digest(true,%L::text[],%L::text[],73,%s,gen_random_uuid())','{a@example.test}','{inquiries}',:'rev'),'invalid_ops_alert_digest');
select pg_temp.expect_error(format('select public.admin_save_ops_alert_digest(true,array(select ''u''||g||''@example.test'' from generate_series(1,11) g),%L::text[],4,%s,gen_random_uuid())','{inquiries}',:'rev'),'ops_alert_recipient_limit');
reset role;

-- 켜기 전에 쌓인 알림(백로그)은 켠 뒤에도 세지 않는다.
insert into public.inquiries(id,user_id,category,title,status) values
 ('0a1e0000-0000-4000-8000-0000000000b0','0a1e0000-0000-4000-8000-000000000002','etc','TEST 백로그 문의 제목','open');
select pg_sleep(0.05);

set local role authenticated;
select pg_temp.as_actor('0a1e0000-0000-4000-8000-000000000001');
select public.admin_save_ops_alert_digest(true,array[' Ops@Example.test ','ops@example.test','cs@example.test'],array['system','inquiries','questions','delay','inquiries'],4,:'rev',
 '0a1e0000-0000-4000-8000-0000000000c1') as saved \gset
select 1/case when (public.admin_save_ops_alert_digest(true,array[' Ops@Example.test ','ops@example.test','cs@example.test'],array['system','inquiries','questions','delay','inquiries'],4,:'rev',
  '0a1e0000-0000-4000-8000-0000000000c1')->>'revision')=(:'saved'::jsonb->>'revision') then 1 else 0 end as assert_settings_replay;
select pg_temp.expect_state(format('select public.admin_save_ops_alert_digest(false,%L::text[],%L::text[],4,%s,gen_random_uuid())','{}','{system}',:'rev'),'PT409');
reset role;
select 1/case when :'saved'::jsonb->>'enabled'='true' and :'saved'::jsonb->'recipients'='["ops@example.test","cs@example.test"]'::jsonb
 and :'saved'::jsonb->'categories'='["inquiries","questions","delay","system"]'::jsonb and (:'saved'::jsonb->>'delayHours')::integer=4
 and (select enabled_at is not null and cursor_at>=enabled_at from private.ops_alert_digest_settings where singleton)
 and exists(select 1 from public.audit_log where id='0a1e0000-0000-4000-8000-0000000000c1' and action='admin.ops_alert_digest.settings')
 then 1 else 0 end as assert_saved_normalized_audited;

-- 백로그는 센 적이 없다.
select 1/case when private.prepare_ops_alert_digest(now()+interval '1 hour')->>'status'='nothing_to_send'
 and not exists(select 1 from private.ops_alert_digest_runs) then 1 else 0 end as assert_backlog_not_sent;

-- ---------------------------------------------------------------------------
-- 새 알림 한 요약: 문의 1·상품 문의 1·시스템 1(주문 알림은 세지 않는다)
-- ---------------------------------------------------------------------------
insert into public.inquiries(id,user_id,category,title,status) values
 ('0a1e0000-0000-4000-8000-0000000000b1','0a1e0000-0000-4000-8000-000000000002','etc','TEST 개인정보 문의 제목','open');
insert into public.product_questions(id,good_id,user_id,body) values
 ('0a1e0000-0000-4000-8000-0000000000d1','ops-digest-g1','0a1e0000-0000-4000-8000-000000000002','TEST 개인정보 상품 문의 본문');
insert into private.admin_operation_alerts(event_key,category,title,href) values
 ('ops-digest-test:system:1','system','자동 작업이 실패했습니다 · TEST 작업','/admin/settings/system'),
 ('ops-digest-test:order:1','orders','신규 결제 주문이 있습니다.','/admin/sales/orders/x');
select private.prepare_ops_alert_digest(now()+interval '1 hour') as p1 \gset
select 1/case when :'p1'::jsonb->>'status'='prepared' and (:'p1'::jsonb->>'deliveries')::integer=2
 and (select counts=jsonb_build_object('inquiries',1,'questions',1,'delayedInquiries',0,'delayedQuestions',0,'system',1)
   and system_titles='["자동 작업이 실패했습니다 · TEST 작업"]'::jsonb and delivery_count=2
   from private.ops_alert_digest_runs where id=(:'p1'::jsonb->>'runId')::uuid)
 and (select count(*)=2 from private.ops_alert_digest_deliveries where run_id=(:'p1'::jsonb->>'runId')::uuid and email_status='queued')
 and exists(select 1 from public.audit_log where action='system.ops_alert_digest.prepared' and target='ops_alert_digest:'||(:'p1'::jsonb->>'runId'))
 then 1 else 0 end as assert_digest_counts_and_deliveries;
select 1/case when not exists(select 1 from private.ops_alert_digest_runs
   where (counts::text||system_titles::text||delayed::text) like '%TEST 개인정보%' or (counts::text||system_titles::text||delayed::text) like '%ops-digest-ip%')
 then 1 else 0 end as assert_no_pii_in_runs;

-- 10분 안에는 새 요약을 만들지 않고, 이미 센 알림은 다시 세지 않는다.
select 1/case when private.prepare_ops_alert_digest(now()+interval '1 hour 5 minutes')->>'status'='throttled'
 and private.prepare_ops_alert_digest(now()+interval '1 hour 11 minutes')->>'status'='nothing_to_send' then 1 else 0 end as assert_throttle_and_cursor_once;

-- ---------------------------------------------------------------------------
-- 답변 지연: 4시간 넘긴 open 문의와 미답변 상품 문의를 문의당 한 번만
-- ---------------------------------------------------------------------------
-- (백로그 문의도 open이지만 7일 넘게 묵은 것은 세지 않는다 — 아래에서 따로 확인)
update public.inquiries set last_message_at=now()-interval '8 days' where id='0a1e0000-0000-4000-8000-0000000000b0';
select private.prepare_ops_alert_digest(now()+interval '5 hours') as p2 \gset
select 1/case when :'p2'::jsonb->>'status'='prepared'
 and (select counts=jsonb_build_object('inquiries',0,'questions',0,'delayedInquiries',1,'delayedQuestions',1,'system',0)
   and jsonb_array_length(delayed)=2 and delayed @> '[{"kind":"inquiry","href":"/admin/cs/inquiries/0a1e0000-0000-4000-8000-0000000000b1"}]'::jsonb
   and (select bool_and((e->>'waitedHours')::integer>=4) from jsonb_array_elements(delayed) e)
   from private.ops_alert_digest_runs where id=(:'p2'::jsonb->>'runId')::uuid)
 and (select count(*)=2 from private.ops_alert_digest_delay_marks where run_id=(:'p2'::jsonb->>'runId')::uuid)
 then 1 else 0 end as assert_delay_counted_once_and_old_ignored;
select 1/case when private.prepare_ops_alert_digest(now()+interval '5 hours 15 minutes')->>'status'='nothing_to_send'
 then 1 else 0 end as assert_delay_not_repeated;

-- 고객이 다시 문의해(새 활동 시각) 또 늦으면 다시 센다. 상품 문의는 답변되면 센 적이 있어도 더는 늘지 않는다.
update public.inquiries set last_message_at=now()+interval '5 hours' where id='0a1e0000-0000-4000-8000-0000000000b1';
update public.product_questions set answer_body='TEST 답변',answered_at=now(),answered_by='0a1e0000-0000-4000-8000-000000000001' where id='0a1e0000-0000-4000-8000-0000000000d1';
select private.prepare_ops_alert_digest(now()+interval '10 hours') as p3 \gset
select 1/case when :'p3'::jsonb->>'status'='prepared'
 and (select counts->>'delayedInquiries'='1' and counts->>'delayedQuestions'='0' from private.ops_alert_digest_runs where id=(:'p3'::jsonb->>'runId')::uuid)
 then 1 else 0 end as assert_reopened_inquiry_counted_again;

-- ---------------------------------------------------------------------------
-- 범주를 좁히면 고른 범주만 센다(지연 범주를 빼면 지연은 표식도 없이 건너뜀)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('0a1e0000-0000-4000-8000-000000000001');
select (public.admin_get_ops_alert_digest()->>'revision')::bigint as rev2 \gset
select public.admin_save_ops_alert_digest(true,array['ops@example.test'],array['system'],2,:'rev2',gen_random_uuid()) as saved2 \gset
reset role;
select 1/case when :'saved2'::jsonb->'categories'='["system"]'::jsonb and (:'saved2'::jsonb->>'delayHours')::integer=2
 and (select cursor_at<now()+interval '1 minute' from private.ops_alert_digest_settings where singleton) then 1 else 0 end as assert_category_saved_cursor_kept;
insert into public.inquiries(id,user_id,category,title,status) values
 ('0a1e0000-0000-4000-8000-0000000000b2','0a1e0000-0000-4000-8000-000000000002','etc','TEST 두번째','open');
insert into private.admin_operation_alerts(event_key,category,title,href) values
 ('ops-digest-test:system:2','system','자동 작업이 실패했습니다 · TEST 작업2','/admin/settings/system');
update public.inquiries set last_message_at=now()-interval '3 hours' where id='0a1e0000-0000-4000-8000-0000000000b2';
select private.prepare_ops_alert_digest(now()+interval '20 hours') as p4 \gset
select 1/case when :'p4'::jsonb->>'status'='prepared' and (:'p4'::jsonb->>'deliveries')::integer=1
 and (select counts=jsonb_build_object('inquiries',0,'questions',0,'delayedInquiries',0,'delayedQuestions',0,'system',1)
   from private.ops_alert_digest_runs where id=(:'p4'::jsonb->>'runId')::uuid)
 and not exists(select 1 from private.ops_alert_digest_delay_marks where target_id='0a1e0000-0000-4000-8000-0000000000b2')
 then 1 else 0 end as assert_only_chosen_categories;

-- ---------------------------------------------------------------------------
-- 선점·결속·완료·만료·gate
-- ---------------------------------------------------------------------------
delete from private.ops_alert_digest_runs where id<>(:'p4'::jsonb->>'runId')::uuid; -- 요약 하나(수신자 1)만 남겨 선점을 본다
update private.ops_alert_digest_runs set created_at=clock_timestamp()-interval '1 hour';
set local role service_role;
select public.claim_ops_alert_digest_jobs(25) as jobs \gset
reset role;
select 1/case when jsonb_array_length(:'jobs'::jsonb)=1
 and (:'jobs'::jsonb->0->>'recipient')='ops@example.test'
 and (:'jobs'::jsonb->0->'counts'->>'system')='1'
 and :'jobs'::jsonb->0->'systemTitles'='["자동 작업이 실패했습니다 · TEST 작업2"]'::jsonb
 and (:'jobs'::jsonb::text) not like '%TEST 개인정보%'
 and (select email_status='processing' and attempts=1 from private.ops_alert_digest_deliveries) then 1 else 0 end as assert_claim_contents;
select :'jobs'::jsonb->0->>'id' as job_id,:'jobs'::jsonb->0->>'claimToken' as claim_id \gset

set local role service_role;
select pg_temp.expect_error(format('select public.enqueue_email_intent(%L,%L,%L,%L,%L)','ops_alert_digest',repeat('a',64),repeat('b',64),'order_delay_notice','ops_alert_digest_v1'),'invalid_email_message_kind');
select pg_temp.expect_error(format('select public.enqueue_email_intent(%L,%L,%L,%L,%L)','order_delay_notice',repeat('a',64),repeat('b',64),'ops_alert_digest','ops_alert_digest_v1'),'invalid_email_message_kind');
select public.enqueue_email_intent('ops_alert_digest',repeat('c',64),repeat('d',64),'ops_alert_digest','ops_alert_digest_v1')->>'intentId' as intent_ops \gset
select public.enqueue_email_intent('stock_safety_digest',repeat('e',64),repeat('f',64),'stock_safety_digest','stock_safety_digest_v1')->>'intentId' as intent_stock \gset
select public.enqueue_email_intent('auth_hook',repeat('1',64),repeat('2',64),'auth_signup','auth_signup_v1')->>'intentId' as intent_auth \gset
select 1/case when public.bind_ops_alert_digest_intent(:'job_id',:'claim_id',:'intent_ops')
 and not public.bind_ops_alert_digest_intent(:'job_id',gen_random_uuid(),:'intent_ops')
 and public.claim_email_intent_dispatch(:'intent_ops',repeat('d',64))->>'kind'='claimed'
 and public.claim_email_intent_dispatch(:'intent_auth',repeat('2',64))->>'kind'='disabled'
 and public.claim_email_intent_dispatch(:'intent_stock',repeat('f',64))->>'kind'='disabled'
 then 1 else 0 end as assert_bind_and_dedicated_gate;
select pg_temp.expect_error(format('select public.bind_ops_alert_digest_intent(%L,%L,%L)',:'job_id',:'claim_id',:'intent_auth'),'ops_alert_digest_intent_mismatch');
reset role;
update private.email_intents set state='accepted',accepted_at=now() where id=:'intent_ops';
set local role service_role;
select 1/case when public.finish_ops_alert_digest_job(:'job_id',:'claim_id','sent',null,false)
 and not public.finish_ops_alert_digest_job(:'job_id',:'claim_id','sent',null,false) then 1 else 0 end as assert_finish_once;
reset role;
select 1/case when (select email_status='sent' and error_code is null from private.ops_alert_digest_deliveries) then 1 else 0 end as assert_sent;

-- 재시도 가능한 실패는 10분 뒤 다시 줄을 서고, 6시간 넘으면 만료된다. 꺼지면 선점하지 않는다.
update private.ops_alert_digest_deliveries set email_status='processing',claim_token='0a1e0000-0000-4000-8000-0000000000e1',
 lease_until=clock_timestamp()+interval '5 minutes',email_intent_id=null;
select id as delivery_id from private.ops_alert_digest_deliveries \gset
set local role service_role;
select 1/case when public.finish_ops_alert_digest_job(:'delivery_id','0a1e0000-0000-4000-8000-0000000000e1','failed','provider_retryable',true)
 then 1 else 0 end as assert_retryable_failure;
reset role;
select 1/case when (select email_status='queued' and retryable and available_at>clock_timestamp()+interval '9 minutes' from private.ops_alert_digest_deliveries) then 1 else 0 end as assert_requeued;
update private.ops_alert_digest_deliveries set available_at=clock_timestamp()-interval '1 minute';
update private.ops_alert_digest_runs set created_at=clock_timestamp()-interval '7 hours';
set local role service_role;
select 1/case when public.claim_ops_alert_digest_jobs(25)='[]'::jsonb then 1 else 0 end as assert_stale_not_claimed;
reset role;
select 1/case when (select email_status='failed' and error_code='digest_expired' from private.ops_alert_digest_deliveries) then 1 else 0 end as assert_stale_expires;

update private.ops_alert_digest_settings set enabled=false,enabled_at=null where singleton;
update private.ops_alert_digest_deliveries set email_status='queued',error_code=null,available_at=clock_timestamp()-interval '1 minute';
update private.ops_alert_digest_runs set created_at=clock_timestamp();
set local role service_role;
select 1/case when public.claim_ops_alert_digest_jobs(25)='[]'::jsonb
 and public.claim_email_intent_dispatch(:'intent_ops',repeat('d',64))->>'kind'='disabled' then 1 else 0 end as assert_disabled_claims_nothing;
reset role;
select 1/case when private.prepare_ops_alert_digest(now()+interval '30 hours')->>'status'='disabled' then 1 else 0 end as assert_disabled_prepares_nothing;

rollback;
