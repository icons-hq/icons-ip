\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 자동 발주확인 (ADR-0025, 2026-10-27 사용자 확정 D1)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 설정은 켜짐·매일 16:30(KST)·migration 시각부터로 시작하고 매분 틱이 등록돼 있다
--   · 대상 = paid + 켠 시각 ≤ 결제완료 시각 ≤ 그날 마감. 두 경계는 모두 포함한다
--   · 마감 뒤 결제는 다음 날, 놓친 날은 다음 실행이 함께 처리한다
--   · 취소 요청 진행 중·예약 재고 미할당 주문은 신규주문에 남고 실행 기록에 사유가 남는다
--   · 날짜당 한 번(멱등), 묶음이 차면 이어서 처리하고 같은 실행에서 다시 판정하지 않는다
--   · 시각 변경·끄기·다시 켜기(켠 시각 갱신)와 운영자 감사·멱등 재전송
--   · 수동 발주확인과 같은 전이(confirmed_at·고객 직접 취소 종료·감사 기록)
--   · 권한 봉인은 선언적으로만 확인한다(권한 없는 함수의 런타임 호출 금지)
-- 스칼라 하위 질의는 같은 문장의 함수 호출보다 먼저 평가되므로 실행과 결과 확인은 문장을 나눈다.
-- 실행 날짜는 2031년으로 고정해 실제 매분 틱(오늘 날짜)과 실행 행이 겹치지 않는다.
-- 이 트랜잭션의 주문은 커밋되지 않으므로 틱이 보지 못한다.
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_get_auto_order_confirmation()','execute')
  and not has_function_privilege('anon','public.admin_get_auto_order_confirmation()','execute')
  and not has_function_privilege('service_role','public.admin_get_auto_order_confirmation()','execute')
  and has_function_privilege('authenticated','public.admin_save_auto_order_confirmation(boolean,text,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.admin_save_auto_order_confirmation(boolean,text,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_auto_order_confirmation(boolean,text,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','private.run_auto_order_confirmation(timestamptz,integer)','execute')
  and not has_function_privilege('service_role','private.run_auto_order_confirmation(timestamptz,integer)','execute')
  and not has_function_privilege('service_role','private.tick_auto_order_confirmation()','execute')
  and not has_function_privilege('authenticated','private.confirm_paid_order(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','private.confirm_paid_order(uuid,uuid,jsonb)','execute')
  and not has_table_privilege('authenticated','private.auto_order_confirmation_settings','select,update')
  and not has_table_privilege('service_role','private.auto_order_confirmation_runs','select,insert,update')
  and not has_table_privilege('service_role','private.order_paid_marks','select,insert,update')
  and (select count(*) from cron.job where jobname='auto-order-confirmation' and schedule='* * * * *'
    and command='select private.tick_auto_order_confirmation()')=1
) then 1 else 0 end as assert_sealed_acl_and_minute_tick;

-- 운영자가 아직 바꾸지 않은(revision 1) DB는 migration 기본값 그대로다.
select 1/case when (select revision>1 or (enabled and run_time='16:30' and enabled_at is not null) from private.auto_order_confirmation_settings where singleton)
 then 1 else 0 end as assert_starts_enabled_at_1630;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값)
-- ---------------------------------------------------------------------------
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a0c00000-0000-4000-8000-000000000001','authenticated','authenticated','auto-confirm-operator@example.test',now(),'{}','{}',now(),now()),
 ('a0c00000-0000-4000-8000-000000000002','authenticated','authenticated','auto-confirm-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 자동 발주확인 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='a0c00000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('a0c00000-0000-4000-8000-000000000001','a0c00000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('a0c00000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;

insert into public.ips(id,title,vertical_key) values('auto-confirm-ip','TEST 자동 발주확인 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('auto-confirm-goods','auto-confirm-ip','TEST 자동 발주확인 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values('a0c00000-0000-4000-8000-0000000000f1','auto-confirm-origin','TEST 자동 발주확인 창고',0,'합성 반송 주소');

-- n번 주문을 paid로 만든다. paid_at이 null이면 결제완료 기록이 없는(도입 전) 주문이다.
create function pg_temp.paid_order(n integer,paid timestamptz,status public.order_status default 'paid') returns uuid language plpgsql as $$
declare oid uuid:=('a0c00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=gen_random_uuid();
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,'a0c00000-0000-4000-8000-000000000002',status,10000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',case when status<>'paid' then now() end);
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'auto-confirm-goods',1,10000,'TEST 자동 발주확인 굿즈','문구','auto-confirm-ip',(select id from public.goods_variants where good_id='auto-confirm-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
  values(sid,oid,'a0c00000-0000-4000-8000-0000000000f1','TEST 자동 발주확인 창고',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values('a0c00000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk-auto-confirm-'||n,'idem-auto-confirm-'||n);
 if paid is not null then insert into private.order_paid_marks(order_id,paid_at) values(oid,paid);end if;
 return oid;
end $$;

-- 결제완료 전이가 결제완료 시각을 남긴다. 직접 paid로 넣은 주문(도입 전)은 남기지 않는다.
insert into public.orders(id,user_id,status,total,address) values('a0c00000-0000-4001-8000-000000000099','a0c00000-0000-4000-8000-000000000002','pending',10000,'{}');
update public.orders set status='paid' where id='a0c00000-0000-4001-8000-000000000099';
select 1/case when (select paid_at between now() and clock_timestamp() from private.order_paid_marks where order_id='a0c00000-0000-4001-8000-000000000099')
 then 1 else 0 end as assert_paid_transition_records_paid_at;
update public.orders set status='canceled' where id='a0c00000-0000-4001-8000-000000000099';

-- 켠 시각 2031-03-13 10:00, 마감 16:30 (KST).
update private.auto_order_confirmation_settings set enabled=true,run_time='16:30',enabled_at='2031-03-13 10:00:00+09',revision=1 where singleton;
select pg_temp.paid_order(1,'2031-03-13 09:59:59+09') as before_enabled \gset
select pg_temp.paid_order(2,'2031-03-13 10:00:00+09') as at_enabled \gset
select pg_temp.paid_order(3,'2031-03-14 16:30:00+09') as at_cutoff \gset
select pg_temp.paid_order(4,'2031-03-14 16:30:01+09') as after_cutoff \gset
select pg_temp.paid_order(5,'2031-03-14 12:00:00+09') as cancel_requested \gset
select pg_temp.paid_order(6,'2031-03-14 13:00:00+09') as preorder_pending \gset
select pg_temp.paid_order(7,null) as legacy_paid \gset
select pg_temp.paid_order(8,'2031-03-14 14:00:00+09','confirmed') as already_confirmed \gset
select pg_temp.paid_order(12,null) as manual_paid \gset

-- 고객이 하자 취소를 접수해 운영 판단을 기다린다(취소 요청 진행 중).
set local role service_role;
select 1/case when public.request_order_claim(:'cancel_requested','a0c00000-0000-4000-8000-000000000002','cancel','TEST 하자 취소','defect')='requested'
 then 1 else 0 end as assert_cancel_request_fixture;
reset role;
-- 예약 품목(실재고 할당 전). 정책 원장 대신 품목 스냅샷만 합성한다.
set local session_replication_role=replica;
update public.order_items set supply_source='preorder',preorder_policy_id='a0c00000-0000-4000-8000-0000000000e1',preorder_expected_ship_date='2031-04-01',
 preorder_snapshot='{"policyId":"a0c00000-0000-4000-8000-0000000000e1","policyRevision":1,"startsAt":"2031-01-01T00:00:00Z","endsAt":"2031-02-01T00:00:00Z","expectedShipDate":"2031-04-01"}'
 where order_id=:'preorder_pending';
set local session_replication_role=origin;

-- ---------------------------------------------------------------------------
-- 3/14 실행: 마감 전에는 돌지 않는다. 묶음 2건씩 이어 처리한다.
-- ---------------------------------------------------------------------------
select 1/case when private.run_auto_order_confirmation('2031-03-14 16:29:59+09',2)->>'status'='before_cutoff'
 and not exists(select 1 from private.auto_order_confirmation_runs where run_date='2031-03-14') then 1 else 0 end as assert_waits_for_cutoff;
select private.run_auto_order_confirmation('2031-03-14 16:31:00+09',2)->>'status' as batch_one \gset
select private.run_auto_order_confirmation('2031-03-14 16:32:00+09',2)->>'status' as batch_two \gset
select private.run_auto_order_confirmation('2031-03-14 16:33:00+09',2)->>'status' as batch_three \gset
select 1/case when :'batch_one'='continuing' and :'batch_two'='continuing' and :'batch_three'='finished'
 then 1 else 0 end as assert_batches_continue_then_finish;
select 1/case when (select status='confirmed' and confirmed_at is not null from public.orders where id=:'at_enabled')
 and (select status='confirmed' and confirmed_at is not null from public.orders where id=:'at_cutoff')
 and (select count(*)=5 from public.orders where id in(:'before_enabled',:'after_cutoff',:'cancel_requested',:'preorder_pending',:'legacy_paid') and status='paid')
 then 1 else 0 end as assert_boundaries_inclusive_and_exclusions_stay_new;
select 1/case when (select confirmed_count=2 and excluded_count=2 and batch_count=3 and finished_at is not null
  and cutoff_at='2031-03-14 16:30:00+09' and enabled_at='2031-03-13 10:00:00+09' from private.auto_order_confirmation_runs where run_date='2031-03-14')
 and (select jsonb_object_agg(order_id,outcome) from private.auto_order_confirmation_outcomes where run_date='2031-03-14')
  =jsonb_build_object(:'at_enabled','confirmed',:'at_cutoff','confirmed',:'cancel_requested','cancellation_in_progress',:'preorder_pending','preorder_unallocated')
 then 1 else 0 end as assert_run_record_and_reasons;
select 1/case when (select count(*)=2 from public.audit_log where target in('order:'||:'at_enabled','order:'||:'at_cutoff') and action='admin.order.status_updated'
  and actor_id is null and diff->>'from'='paid' and diff->>'to'='confirmed' and diff->>'trigger'='auto_order_confirmation' and diff->>'runDate'='2031-03-14')
 and (select count(*)=1 from public.audit_log where action='system.order.auto_confirmation_run' and target='auto_order_confirmation:2031-03-14'
  and actor_id is null and diff->>'confirmed'='2' and diff->>'excluded'='2')
 then 1 else 0 end as assert_system_audit;
-- 같은 날 다시 불러도 아무것도 바꾸지 않는다.
select 1/case when private.run_auto_order_confirmation('2031-03-14 23:59:00+09')->>'status'='already_ran'
 and (select batch_count=3 from private.auto_order_confirmation_runs where run_date='2031-03-14') then 1 else 0 end as assert_once_per_day;
-- 자동 발주확인도 고객 직접 취소를 닫는다(ADR-0017 경계).
set local role service_role;
select 1/case when public.request_order_claim(:'at_enabled','a0c00000-0000-4000-8000-000000000002','cancel','TEST 변심','change_of_mind')='not_cancelable'
 then 1 else 0 end as assert_customer_cancel_closed_after_auto_confirm;
reset role;

-- ---------------------------------------------------------------------------
-- 3/15: 전날 마감 뒤 결제분을 처리한다. 제외 사유가 남은 주문은 다시 제외된다.
-- 3/16: 예약 재고를 할당하면 다음 실행이 확인한다.
-- ---------------------------------------------------------------------------
select private.run_auto_order_confirmation('2031-03-15 16:31:00+09');
select 1/case when (select status='confirmed' from public.orders where id=:'after_cutoff')
 and (select confirmed_count=1 and excluded_count=2 from private.auto_order_confirmation_runs where run_date='2031-03-15')
 and (select status='paid' from public.orders where id=:'before_enabled') then 1 else 0 end as assert_next_day_picks_late_payments;
set local session_replication_role=replica;
insert into private.goods_preorder_reservations(order_item_id,order_id,policy_id,qty,state,allocated_at,allocated_by,allocation_reference)
 select id,order_id,preorder_policy_id,qty,'allocated',now(),'a0c00000-0000-4000-8000-000000000001','TEST 입고' from public.order_items where order_id=:'preorder_pending';
set local session_replication_role=origin;
select private.run_auto_order_confirmation('2031-03-16 16:31:00+09');
select 1/case when (select status='confirmed' from public.orders where id=:'preorder_pending')
 and (select outcome='cancellation_in_progress' from private.auto_order_confirmation_outcomes where run_date='2031-03-16' and order_id=:'cancel_requested')
 then 1 else 0 end as assert_allocated_preorder_confirmed_next_run;

-- ---------------------------------------------------------------------------
-- 발주 화면 설정: 권한·시각 변경·멱등·충돌·끄기·다시 켜기
-- ---------------------------------------------------------------------------
select pg_temp.as_actor('a0c00000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error('select public.admin_get_auto_order_confirmation()','operator_capability_required');
select pg_temp.expect_error($$select public.admin_save_auto_order_confirmation(false,'16:30',1,gen_random_uuid())$$,'operator_capability_required');
reset role;
select pg_temp.as_actor('a0c00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_get_auto_order_confirmation() as document \gset
select 1/case when (:'document'::jsonb->>'runTime')='16:30' and (:'document'::jsonb->>'enabled')='true'
 and :'document'::jsonb#>>'{lastRun,runDate}'='2031-03-16' and jsonb_array_length(:'document'::jsonb->'lastExclusions')=1
 and :'document'::jsonb#>>'{lastExclusions,0,outcome}'='cancellation_in_progress' then 1 else 0 end as assert_screen_document;
select pg_temp.expect_error($$select public.admin_save_auto_order_confirmation(true,'24:00',1,gen_random_uuid())$$,'invalid_auto_order_confirmation');
select public.admin_save_auto_order_confirmation(true,'18:00',1,'a0c00000-0000-4000-8000-0000000000a1') as moved \gset
select 1/case when public.admin_save_auto_order_confirmation(true,'18:00',1,'a0c00000-0000-4000-8000-0000000000a1')=:'moved'::jsonb
 and (:'moved'::jsonb->>'runTime')='18:00' and (:'moved'::jsonb->>'revision')='2' then 1 else 0 end as assert_time_change_replay;
select pg_temp.expect_error($$select public.admin_save_auto_order_confirmation(true,'19:00',1,'a0c00000-0000-4000-8000-0000000000a1')$$,'operation_conflict');
select pg_temp.expect_error($$select public.admin_save_auto_order_confirmation(true,'19:00',1,gen_random_uuid())$$,'auto_order_confirmation_changed');
reset role;
select 1/case when (select enabled_at='2031-03-13 10:00:00+09' and updated_by='a0c00000-0000-4000-8000-000000000001' from private.auto_order_confirmation_settings where singleton)
 and (select count(*)=1 from public.audit_log where id='a0c00000-0000-4000-8000-0000000000a1' and action='admin.auto_order_confirmation.settings'
  and actor_id='a0c00000-0000-4000-8000-000000000001' and diff#>>'{before,runTime}'='16:30' and diff#>>'{request,runTime}'='18:00')
 then 1 else 0 end as assert_time_change_keeps_enabled_at_and_audits;
-- 아직 돌지 않은 날은 새 시각에 돈다. 이미 돈 날은 시각을 바꿔도 다시 돌지 않는다.
select pg_temp.paid_order(9,'2031-03-17 17:00:00+09') as before_new_cutoff \gset
select private.run_auto_order_confirmation('2031-03-17 17:30:00+09')->>'status' as before_moved \gset
select private.run_auto_order_confirmation('2031-03-17 18:01:00+09')->>'status' as after_moved \gset
select 1/case when :'before_moved'='before_cutoff' and :'after_moved'='finished' then 1 else 0 end as assert_new_time_runs_today;
select 1/case when (select status='confirmed' from public.orders where id=:'before_new_cutoff') then 1 else 0 end as assert_new_time_applies_today;
select pg_temp.as_actor('a0c00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_save_auto_order_confirmation(true,'19:00',2,gen_random_uuid());
reset role;
select 1/case when private.run_auto_order_confirmation('2031-03-17 19:01:00+09')->>'status'='already_ran' then 1 else 0 end as assert_moved_time_never_reruns_day;

-- 끄면 실행하지 않는다. 다시 켜면 그 시각부터 결제된 주문만 대상이다.
select pg_temp.as_actor('a0c00000-0000-4000-8000-000000000001');
set local role authenticated;
select coalesce((public.admin_save_auto_order_confirmation(false,'19:00',3,gen_random_uuid()))->>'nextRunAt','none') as off_next \gset
reset role;
select 1/case when :'off_next'='none' and private.run_auto_order_confirmation('2031-03-18 19:30:00+09')->>'status'='disabled'
 and not exists(select 1 from private.auto_order_confirmation_runs where run_date='2031-03-18') then 1 else 0 end as assert_off_never_runs;
select pg_temp.as_actor('a0c00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_save_auto_order_confirmation(true,'19:00',4,gen_random_uuid());
reset role;
select enabled_at as reenabled_at from private.auto_order_confirmation_settings where singleton \gset
select 1/case when :'reenabled_at'::timestamptz>now() and :'reenabled_at'::timestamptz<>'2031-03-13 10:00:00+09' then 1 else 0 end as assert_enable_refreshes_enabled_at;
select pg_temp.paid_order(10,:'reenabled_at'::timestamptz-interval '1 second') as before_reenable \gset
select pg_temp.paid_order(11,:'reenabled_at'::timestamptz+interval '1 second') as after_reenable \gset
select private.run_auto_order_confirmation('2031-03-19 19:01:00+09');
select 1/case when (select status='paid' from public.orders where id=:'before_reenable')
 and (select status='confirmed' from public.orders where id=:'after_reenable')
 and (select enabled_at=:'reenabled_at'::timestamptz from private.auto_order_confirmation_runs where run_date='2031-03-19')
 then 1 else 0 end as assert_reenable_boundary;

-- ---------------------------------------------------------------------------
-- 수동 발주확인은 같은 내부 전이를 쓰고 기존 감사 형식을 유지한다.
-- ---------------------------------------------------------------------------
select pg_temp.as_actor('a0c00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_update_order_status(:'manual_paid','confirmed',null,null);
reset role;
select 1/case when (select status='confirmed' and confirmed_at is not null from public.orders where id=:'manual_paid')
 and (select diff='{"from":"paid","to":"confirmed"}'::jsonb and actor_id='a0c00000-0000-4000-8000-000000000001' from public.audit_log
  where target='order:'||:'manual_paid' and action='admin.order.status_updated') then 1 else 0 end as assert_manual_path_unchanged;
rollback;
