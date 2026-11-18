\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 주문 출고 보류(원장 PAY-050·SHP-093·OPS-074·OPS-065·CLM-051)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 운영 배포가 남긴 토스 키 모드가 test인 굿즈 결제가 승인되면 출고 보류(test_payment)가 생긴다. live·키 모드 없음(로컬)은 생기지 않는다
--   · 보류 행이 없어도(트리거 실패를 흉내) 판정은 키 모드에서 보류로 읽는다
--   · 키 모드는 결제 전에만 바꿀 수 있다
--   · 결제사 잔액 대조(provider_canceled): 새 취소 → held, 재전송·역순 도착 → already_recorded, 취소 없음 → consistent,
--     결제사 취소를 우리가 냈을 수 있는 처리 중 → in_flight(대기 기록, sweep이 처리 끝난 뒤 보류), 접수만 된 요청·교환 → 보류,
--     취소 주문·환불 결제 → not_applicable. 시도별 2분 조회 쿨다운. 운영 알림을 남긴다
--   · 보류 중인 주문: 자동 발주확인 제외(fulfillment_hold)·수동 발주확인 거절·출고지시 후보 제외·묶음 출고 준비 아님·
--     출고 경로 공통 검사 거절·첫 발송 전이 거절·강제 배송완료 막는 사유·서원 회신 후보·예약 할당 표시·교환 재출고 거절.
--     발송 뒤 보류는 경고다 — 배송완료(마지막 배송 건 포함)·거래확정은 막지 않고, 발송 전 배송 건의 발송만 막는다
--   · 해제: sales.manage만, 사유 5자 이상, 같은 요청번호 재요청은 처음 결과, 다른 내용이면 충돌. 해제한 근거(설명되지 않은 금액)는
--     재전송·그 뒤 우리 부분 취소에도 다시 걸리지 않는다
--   · 주문이 취소되면 보류가 닫히고 판정도 비운다
--   · 화면 읽기(주문별 보류·목록·발송 행 표시)와 운영 할 일 건수
--   · 디지털 파일: 보류 중에는 첫 제공·재다운로드 모두 막고(신규주문 → 배송완료 전이 포함) 해제하면 제공한다
--   · 수령 확인 코드: 이미 인계된 배송 건은 보류여도 발급한다(발송 전 배송 건이 남아 있어도)
--   · 권한 봉인(선언적 확인)
-- ============================================================================

select 1/case when (
  has_function_privilege('service_role','public.service_record_goods_payment_key_mode(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.service_record_goods_payment_key_mode(uuid,text)','execute')
  and not has_function_privilege('anon','public.service_record_goods_payment_key_mode(uuid,text)','execute')
  and has_function_privilege('service_role','public.service_flag_goods_provider_cancellation(uuid,text,bigint,text)','execute')
  and not has_function_privilege('authenticated','public.service_flag_goods_provider_cancellation(uuid,text,bigint,text)','execute')
  and has_function_privilege('service_role','public.service_begin_goods_provider_cancellation_check(uuid)','execute')
  and not has_function_privilege('authenticated','public.service_begin_goods_provider_cancellation_check(uuid)','execute')
  and not has_function_privilege('service_role','private.apply_goods_provider_cancellation(uuid,text,bigint,text)','execute')
  and not has_function_privilege('service_role','private.sweep_goods_provider_cancellation_checks(integer)','execute')
  and not has_function_privilege('service_role','private.order_fulfillment_blocking(uuid)','execute')
  and not has_table_privilege('service_role','private.goods_provider_cancellation_checks','select,insert,update')
  and (select provolatile='s' from pg_proc where oid='public.admin_order_fulfillment_holds(uuid[])'::regprocedure)
  and has_function_privilege('authenticated','public.admin_order_fulfillment_holds(uuid[])','execute')
  and not has_function_privilege('anon','public.admin_order_fulfillment_holds(uuid[])','execute')
  and not has_function_privilege('service_role','public.admin_order_fulfillment_holds(uuid[])','execute')
  and has_function_privilege('authenticated','public.admin_list_order_fulfillment_holds(integer)','execute')
  and not has_function_privilege('service_role','public.admin_list_order_fulfillment_holds(integer)','execute')
  and has_function_privilege('authenticated','public.admin_shipment_fulfillment_hold_flags(uuid[])','execute')
  and not has_function_privilege('service_role','public.admin_shipment_fulfillment_hold_flags(uuid[])','execute')
  and has_function_privilege('authenticated','public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)','execute')
  and not has_function_privilege('anon','public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)','execute')
  and not has_function_privilege('authenticated','private.order_fulfillment_held(uuid)','execute')
  and not has_function_privilege('service_role','private.order_fulfillment_held(uuid)','execute')
  and not has_function_privilege('service_role','private.materialize_order_fulfillment_holds(uuid)','execute')
  and not has_table_privilege('service_role','private.order_fulfillment_holds','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.order_fulfillment_holds','select')
  and not has_table_privilege('service_role','private.payment_attempt_key_modes','select,insert,update')
  and (select count(*) from private.operator_rpc_contracts where signature in ('public.admin_order_fulfillment_holds(uuid[])',
    'public.admin_list_order_fulfillment_holds(integer)','public.admin_shipment_fulfillment_hold_flags(uuid[])',
    'public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)'))=4
) then 1 else 0 end as assert_sealed_acl;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값)
-- ---------------------------------------------------------------------------
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: % (statement %)',expected,statement;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a1d00000-0000-4000-8000-000000000001','authenticated','authenticated','hold-operator@example.test',now(),'{}','{}',now(),now()),
 ('a1d00000-0000-4000-8000-000000000002','authenticated','authenticated','hold-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 출고 보류 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='a1d00000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('a1d00000-0000-4000-8000-000000000001','a1d00000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('a1d00000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;

insert into public.ips(id,title,vertical_key) values('hold-ip','TEST 출고 보류 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('hold-goods','hold-ip','TEST 출고 보류 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values('a1d00000-0000-4000-8000-0000000000f1','hold-origin','TEST 출고 보류 창고',0,'합성 반송 주소'),
       ('a1d00000-0000-4000-8000-0000000000f2','hold-origin-2','TEST 출고 보류 창고 2',0,'합성 반송 주소');

create function pg_temp.hold_id(kind text,n integer) returns uuid language sql immutable as $$
 select ('a1d00000-0000-'||case kind when 'order' then '4001' when 'payment' then '4002' when 'attempt' then '4003' else '4004' end||'-8000-'||lpad(n::text,12,'0'))::uuid
$$;
-- 운송장 형식 검사를 통과하는 합성 택배사(이미 있으면 그대로 쓴다).
insert into public.shipping_carriers(code,label,is_active,tracking_url_template)
 select 'hanjin','한진택배',true,'https://example.test/{trackingNumber}' where not exists(select 1 from public.shipping_carriers where code='hanjin');
-- n번 주문: 결제 원장 paid + 토스 결제 시도(prepared, 결제 연결 전). 주문 상태는 status. 승인은 pg_temp.approve가 한다.
create function pg_temp.hold_order(n integer,status public.order_status default 'paid') returns uuid language plpgsql as $$
declare oid uuid:=pg_temp.hold_id('order',n);item uuid;
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,'a1d00000-0000-4000-8000-000000000002',status,10000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',case when status<>'paid' then now() end);
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'hold-goods',1,10000,'TEST 출고 보류 굿즈','문구','hold-ip',(select id from public.goods_variants where good_id='hold-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
  values(pg_temp.hold_id('shipment',n),oid,'a1d00000-0000-4000-8000-0000000000f1','TEST 출고 보류 창고',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,pg_temp.hold_id('shipment',n),item,1);
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values(pg_temp.hold_id('payment',n),'a1d00000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk-hold-'||n,'idem-hold-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,expires_at)
  values(pg_temp.hold_id('attempt',n),'toss','a1d00000-0000-4000-8000-000000000002','order',oid,10000,'KRW','prepared',
   'hold-attempt-'||n,'TEST-HOLD-ORDER-'||n,'TEST-HOLD-PRODUCT-'||n,clock_timestamp()+interval '1 hour');
 return oid;
end $$;
-- 결제 finalizer처럼 시도를 승인하고 결제 원장을 잇는다.
create function pg_temp.approve(n integer) returns void language sql as $$
 update public.payment_attempts set state='approved',payment_id=pg_temp.hold_id('payment',n) where id=pg_temp.hold_id('attempt',n)
$$;
create function pg_temp.reasons(n integer) returns text language sql as $$
 select array_to_string(private.order_fulfillment_hold_reasons(pg_temp.hold_id('order',n)),',')
$$;

select pg_temp.hold_order(1),pg_temp.hold_order(2),pg_temp.hold_order(3),pg_temp.hold_order(4),pg_temp.hold_order(5),
 pg_temp.hold_order(6),pg_temp.hold_order(7,'confirmed'),pg_temp.hold_order(8,'confirmed'),pg_temp.hold_order(9),pg_temp.hold_order(10),
 pg_temp.hold_order(11),pg_temp.hold_order(12,'delivered');

-- ---------------------------------------------------------------------------
-- 1. 키 모드 기록(service_role)과 테스트 키 승인 보류
-- ---------------------------------------------------------------------------
set local role service_role;
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',1),'test');
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',2),'live');
-- 결제 전에는 바꿀 수 있다(배포가 키를 바꾼 뒤 다시 준비한 결제).
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',4),'live');
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',4),'test');
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',5),'test');
select pg_temp.expect_error($$select public.service_record_goods_payment_key_mode('a1d00000-0000-4003-8000-000000000001','prod')$$,'invalid_payment_key_mode');
select pg_temp.expect_error($$select public.service_record_goods_payment_key_mode(gen_random_uuid(),'test')$$,'payment_attempt_not_found');
reset role;
-- 3번은 키 모드가 없다(로컬·preview 결제와 같다).
select pg_temp.approve(1),pg_temp.approve(2),pg_temp.approve(3),pg_temp.approve(4);
select 1/case when pg_temp.reasons(1)='test_payment' and pg_temp.reasons(2)='' and pg_temp.reasons(3)='' and pg_temp.reasons(4)='test_payment'
 and (select count(*)=1 from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',1) and reason='test_payment'
   and payment_attempt_id=pg_temp.hold_id('attempt',1) and released_at is null and detail->>'keyMode'='test')
 and (select count(*)=1 from public.audit_log where target='order:'||pg_temp.hold_id('order',1) and action='system.order.fulfillment_hold_placed'
   and actor_id is null and diff->>'reason'='test_payment')
 and not exists(select 1 from private.order_fulfillment_holds where order_id in (pg_temp.hold_id('order',2),pg_temp.hold_id('order',3)))
 then 1 else 0 end as assert_test_key_approval_holds_only_test_mode;
-- 승인 뒤에는 키 모드를 바꾸지 않는다(같은 값은 그대로 통과).
set local role service_role;
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',1),'test');
select pg_temp.expect_error($$select public.service_record_goods_payment_key_mode('a1d00000-0000-4003-8000-000000000001','live')$$,'payment_key_mode_locked');
reset role;

-- 보류 행이 없어도(트리거 실패) 판정은 키 모드에서 읽는다.
set local session_replication_role=replica;
select pg_temp.approve(5);
set local session_replication_role=origin;
select 1/case when not exists(select 1 from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',5))
 and pg_temp.reasons(5)='test_payment' and private.order_fulfillment_held(pg_temp.hold_id('order',5))
 then 1 else 0 end as assert_derived_hold_without_row;

-- ---------------------------------------------------------------------------
-- 2. 결제사 직접 취소 대조
-- ---------------------------------------------------------------------------
select pg_temp.approve(6),pg_temp.approve(7),pg_temp.approve(8),pg_temp.approve(9),pg_temp.approve(10),pg_temp.approve(11),pg_temp.approve(12);
set local role service_role;
-- 조회 차례를 잡으면 원장 결제 키를 주고, 2분 안의 두 번째 웹훅은 조회하지 않는다(위조 웹훅 조회 폭주 방지).
select public.service_begin_goods_provider_cancellation_check(pg_temp.hold_id('attempt',6)) as begin_first \gset
select public.service_begin_goods_provider_cancellation_check(pg_temp.hold_id('attempt',6)) as begin_second \gset
reset role;
update private.goods_provider_cancellation_checks set last_lookup_at=last_lookup_at-interval '3 minutes' where attempt_id=pg_temp.hold_id('attempt',6);
set local role service_role;
select 1/case when (:'begin_first'::jsonb->>'status')='proceed' and (:'begin_first'::jsonb->>'paymentKey')='pk-hold-6'
 and (:'begin_first'::jsonb->'attempt'->>'provider_order_id')='TEST-HOLD-ORDER-6'
 and (:'begin_second'::jsonb->>'status')='cooldown'
 and public.service_begin_goods_provider_cancellation_check(pg_temp.hold_id('attempt',6))->>'status'='proceed'
 and public.service_begin_goods_provider_cancellation_check(gen_random_uuid()) is null
 then 1 else 0 end as assert_begin_reads_ledger_key_with_cooldown;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'DONE',10000,'webhook-case-0000000001') as no_cancel \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'CANCELED',0,'webhook-case-0000000002') as first_cancel \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'CANCELED',0,'webhook-case-0000000003') as replayed_cancel \gset
-- 역순 도착: 옛 '취소 없음' 관측이 늦게 와도 가장 많이 취소된 관측으로 판정한다.
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'DONE',10000,'webhook-case-0000000004') as out_of_order \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'PARTIAL_CANCELED',7000,'webhook-case-0000000005') as partial_cancel \gset
select pg_temp.expect_error($$select public.service_flag_goods_provider_cancellation('a1d00000-0000-4003-8000-000000000006','CANCELED',10001,'webhook-case-0000000006')$$,'invalid_provider_cancellation');
select pg_temp.expect_error($$select public.service_flag_goods_provider_cancellation('a1d00000-0000-4003-8000-000000000006','canceled',0,'webhook-case-0000000006')$$,'invalid_provider_cancellation');
reset role;
select 1/case when :'no_cancel'='consistent' and :'first_cancel'='held' and :'replayed_cancel'='already_recorded'
 and :'out_of_order'='already_recorded' and :'partial_cancel'='held'
 and pg_temp.reasons(6)='provider_canceled' and pg_temp.reasons(7)='provider_canceled'
 and (select detail->>'providerCanceledAmount'='3000' and detail->>'unexplainedAmount'='3000' and detail->>'providerStatus'='PARTIAL_CANCELED'
   and detail->>'recordedRefundedAmount'='0' and evidence_key='provider_canceled:'||pg_temp.hold_id('attempt',7)||':3000'
   from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',7))
 and (select count(*)=1 from public.audit_log where target='order:'||pg_temp.hold_id('order',6) and action='system.order.fulfillment_hold_placed'
   and diff->>'reason'='provider_canceled' and diff->>'caseRef'='webhook-case-0000000002')
 and (select count(*)=1 from private.admin_operation_alerts a join private.order_fulfillment_holds h on a.event_key='order_fulfillment_holds:'||h.id||':placed'
   where h.order_id=pg_temp.hold_id('order',6) and a.category='orders' and a.href='/admin/sales/orders/'||pg_temp.hold_id('order',6))
 and (select observed_balance=0 and not pending and last_verdict='already_recorded' from private.goods_provider_cancellation_checks where attempt_id=pg_temp.hold_id('attempt',6))
 then 1 else 0 end as assert_provider_cancel_flags_once;

-- 미루는 것은 우리가 결제사 취소를 냈을 수 있는 처리뿐이다. 9번: 취소 처리 중(processing) → 대기. 11번: 접수만 된 요청(보류 단계) →
-- 보류. 12번: 교환 처리 중 → 보류(교환은 환불을 만들지 않는다). 10번: 환불된 결제 → 대상 아님.
set local session_replication_role=replica;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,status,hold_reason) values
 ('a1d00000-0000-4006-8000-000000000009',pg_temp.hold_id('order',9),'a1d00000-0000-4000-8000-000000000002','TEST 취소 처리 중','cancel','processing','processing',null),
 ('a1d00000-0000-4006-8000-000000000011',pg_temp.hold_id('order',11),'a1d00000-0000-4000-8000-000000000002','TEST 고객 취소 요청','cancel','on_hold','requested','TEST 창고 확인 대기 중입니다'),
 ('a1d00000-0000-4006-8000-000000000012',pg_temp.hold_id('order',12),'a1d00000-0000-4000-8000-000000000002','TEST 교환 요청','exchange','processing','processing',null);
update public.payments set status='refunded' where id=pg_temp.hold_id('payment',10);
set local session_replication_role=origin;
set local role service_role;
select 1/case when public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',9),'CANCELED',0,'webhook-case-0000000009')='in_flight'
 and public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',11),'CANCELED',0,'webhook-case-0000000011')='held'
 and public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',12),'CANCELED',0,'webhook-case-0000000012')='held'
 and public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',10),'CANCELED',0,'webhook-case-0000000010')='not_applicable'
 and public.service_begin_goods_provider_cancellation_check(pg_temp.hold_id('attempt',10)) is null
 and public.service_flag_goods_provider_cancellation(gen_random_uuid(),'CANCELED',0,'webhook-case-0000000008')='not_applicable'
 then 1 else 0 end as assert_in_flight_only_for_issued_cancels;
reset role;
-- 대기 기록은 sweep이 다시 본다. 처리가 이어지는 동안은 그대로 대기이고, 요청이 거절(결제사 취소를 우리가 내지 않음)되면 저장한 관측으로 보류한다.
select private.sweep_goods_provider_cancellation_checks() as sweep_while_processing \gset
select 1/case when :'sweep_while_processing'='0' and pg_temp.reasons(9)='' and pg_temp.reasons(10)=''
 and (select pending and pending_since is not null and observed_balance=0 and last_verdict='in_flight'
   from private.goods_provider_cancellation_checks where attempt_id=pg_temp.hold_id('attempt',9))
 then 1 else 0 end as assert_in_flight_recorded_pending;
set local session_replication_role=replica;
update public.order_cancellation_requests set status='rejected',stage='rejected',decision_note='TEST 고객 철회로 거절 처리합니다',decided_at=now()
 where id='a1d00000-0000-4006-8000-000000000009';
set local session_replication_role=origin;
select private.sweep_goods_provider_cancellation_checks() as sweep_after_reject \gset
select 1/case when :'sweep_after_reject'='1' and pg_temp.reasons(9)='provider_canceled'
 and (select not pending and pending_since is null and last_verdict='held' from private.goods_provider_cancellation_checks where attempt_id=pg_temp.hold_id('attempt',9))
 and pg_temp.reasons(11)='provider_canceled' and pg_temp.reasons(12)='provider_canceled'
 and (select count(*)=1 from cron.job where jobname='goods-provider-cancellation-sweep' and schedule='*/5 * * * *')
 then 1 else 0 end as assert_sweep_settles_after_own_process_ends;

-- ---------------------------------------------------------------------------
-- 3. 출고 경로가 보류를 읽는다(아직 나가지 않은 물건만 막는다)
-- ---------------------------------------------------------------------------
-- 자동 발주확인: 결제완료 시각을 남기고 2032년 실행으로 고정한다(실제 매분 틱과 겹치지 않는다).
update private.auto_order_confirmation_settings set enabled=true,run_time='16:30',enabled_at='2032-03-13 10:00:00+09',revision=1 where singleton;
insert into private.order_paid_marks(order_id,paid_at) values
 (pg_temp.hold_id('order',1),'2032-03-14 11:00:00+09'),(pg_temp.hold_id('order',2),'2032-03-14 11:00:00+09'),(pg_temp.hold_id('order',6),'2032-03-14 11:00:00+09')
 on conflict(order_id) do update set paid_at=excluded.paid_at;
select private.run_auto_order_confirmation('2032-03-14 16:31:00+09');
select 1/case when private.auto_order_confirmation_blocker(pg_temp.hold_id('order',1))='fulfillment_hold'
 and (select status='paid' from public.orders where id=pg_temp.hold_id('order',1))
 and (select status='paid' from public.orders where id=pg_temp.hold_id('order',6))
 and (select status='confirmed' from public.orders where id=pg_temp.hold_id('order',2))
 and (select jsonb_object_agg(order_id,outcome) from private.auto_order_confirmation_outcomes where run_date='2032-03-14')
  =jsonb_build_object(pg_temp.hold_id('order',1),'fulfillment_hold',pg_temp.hold_id('order',2),'confirmed',pg_temp.hold_id('order',6),'fulfillment_hold')
 then 1 else 0 end as assert_auto_confirmation_excludes_held;

-- 수동 발주확인·출고 경로 공통 검사·출고지시 후보·묶음 출고·내보내기·발송 전이.
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error($$select public.admin_update_order_status('a1d00000-0000-4001-8000-000000000001','confirmed',null,null)$$,'order fulfillment hold');
select 1/case when exists(select 1 from jsonb_array_elements_text(public.admin_origin_pending_export_ids('a1d00000-0000-4000-8000-0000000000f1')->'ids') id
  where id::uuid=pg_temp.hold_id('shipment',8))
 and not exists(select 1 from jsonb_array_elements_text(public.admin_origin_pending_export_ids('a1d00000-0000-4000-8000-0000000000f1')->'ids') id
  where id::uuid=pg_temp.hold_id('shipment',7))
 then 1 else 0 end as assert_export_candidates_skip_held;
select pg_temp.expect_error($$select public.admin_shipment_export(array['a1d00000-0000-4004-8000-000000000007'::uuid])$$,'order fulfillment hold');
reset role;
select pg_temp.expect_error($$select private.assert_order_dispatch_allowed('a1d00000-0000-4001-8000-000000000007')$$,'order fulfillment hold');
select private.assert_order_dispatch_allowed(pg_temp.hold_id('order',8));
select 1/case when not private.shipment_pack_ready(pg_temp.hold_id('shipment',7)) then 1 else 0 end as assert_pack_not_ready_when_held;
select pg_temp.expect_error($$update public.orders set status='shipping' where id='a1d00000-0000-4001-8000-000000000007'$$,'order fulfillment hold');

-- 발송 뒤 보류(13번: 배송 건 하나가 발송됨, 14번: 하나는 발송·하나는 발송 전). 배송완료는 막지 않고, 발송 전 배송 건의 발송만 막는다.
select pg_temp.hold_order(13,'confirmed'),pg_temp.hold_order(14,'confirmed');
select pg_temp.approve(13),pg_temp.approve(14);
insert into public.order_items(id,order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
 values('a1d00000-0000-4005-8000-000000000141',pg_temp.hold_id('order',14),'hold-goods',1,0,'TEST 출고 보류 굿즈','문구','hold-ip',
  (select id from public.goods_variants where good_id='hold-goods' and is_default));
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values('a1d00000-0000-4004-8000-000000000141',pg_temp.hold_id('order',14),'a1d00000-0000-4000-8000-0000000000f2','TEST 출고 보류 창고 2',0,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 values(pg_temp.hold_id('order',14),'a1d00000-0000-4004-8000-000000000141','a1d00000-0000-4005-8000-000000000141',1);
set local session_replication_role=replica;
update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='TRK'||right(replace(id::text,'-',''),10),shipped_at=now()
 where id in (pg_temp.hold_id('shipment',13),'a1d00000-0000-4004-8000-000000000141');
update public.orders set status='shipping' where id in (pg_temp.hold_id('order',13),pg_temp.hold_id('order',14));
set local session_replication_role=origin;
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',13),'CANCELED',0,'webhook-case-0000000013') as shipped_flag13 \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',14),'CANCELED',0,'webhook-case-0000000014') as shipped_flag14 \gset
reset role;
select 1/case when :'shipped_flag13'='held' and :'shipped_flag14'='held'
 and not private.order_fulfillment_blocking(pg_temp.hold_id('order',13)) and private.order_fulfillment_blocking(pg_temp.hold_id('order',14))
 and private.order_fulfillment_blocking(pg_temp.hold_id('order',7)) and private.order_fulfillment_blocking(pg_temp.hold_id('order',1))
 then 1 else 0 end as assert_blocking_only_before_goods_leave;
select private.assert_order_dispatch_allowed(pg_temp.hold_id('order',13));
-- 강제 배송완료 미리보기: 아직 나가지 않은 물건이 있는 보류 주문(7·14번)만 막는다.
set local role authenticated;
select 1/case when (public.admin_force_order_delivery_preview((select order_number from public.orders where id=pg_temp.hold_id('order',7)))->'blockers') ? 'fulfillment_hold'
 and (public.admin_force_order_delivery_preview((select order_number from public.orders where id=pg_temp.hold_id('order',14)))->'blockers') ? 'fulfillment_hold'
 and not ((public.admin_force_order_delivery_preview((select order_number from public.orders where id=pg_temp.hold_id('order',13)))->'blockers') ? 'fulfillment_hold')
 and not ((public.admin_force_order_delivery_preview((select order_number from public.orders where id=pg_temp.hold_id('order',8)))->'blockers') ? 'fulfillment_hold')
 then 1 else 0 end as assert_forced_delivery_preview_blocks_unshipped_only;
-- 배송완료: 발송 뒤 보류는 막지 않는다(마지막 배송 건이어도). 14번의 발송 전 배송 건 발송은 막힌다.
select public.admin_update_shipment_status(pg_temp.hold_id('shipment',13),'delivered',null,null);
select public.admin_update_shipment_status('a1d00000-0000-4004-8000-000000000141','delivered',null,null);
select pg_temp.expect_error($$select public.admin_update_shipment_status('a1d00000-0000-4004-8000-000000000014','shipping','hanjin','TRK1400000001')$$,'order fulfillment hold');
reset role;
select 1/case when (select status='delivered' from public.orders where id=pg_temp.hold_id('order',13))
 and (select status='delivered' from public.order_shipments where id='a1d00000-0000-4004-8000-000000000141')
 and (select status='ready' from public.order_shipments where id=pg_temp.hold_id('shipment',14))
 and pg_temp.reasons(13)='provider_canceled'
 then 1 else 0 end as assert_delivered_not_blocked_after_shipping;

-- 서원 회신 후보·예약 할당 목록에 보류를 싣는다(화면이 그 줄·그 주문만 뺀다).
set local session_replication_role=replica;
update public.order_shipments set exported_at=now() where id in (pg_temp.hold_id('shipment',7),pg_temp.hold_id('shipment',8));
insert into private.goods_preorder_reservations(order_item_id,order_id,policy_id,qty,state)
 select i.id,i.order_id,'a1d00000-0000-4007-8000-000000000001',1,'reserved' from public.order_items i where i.order_id in (pg_temp.hold_id('order',7),pg_temp.hold_id('order',8));
set local session_replication_role=origin;
set local role authenticated;
select 1/case when (select bool_and(((s->>'fulfillmentHold')::boolean)=(s->>'id'=pg_temp.hold_id('shipment',7)::text)) and count(*)=2
   from jsonb_array_elements(public.admin_origin_tracking_candidates('a1d00000-0000-4000-8000-0000000000f1','{}'::text[],array['01000000000'])->'shipments') s
   where s->>'id' in (pg_temp.hold_id('shipment',7)::text,pg_temp.hold_id('shipment',8)::text))
 and (select bool_and(((r->>'fulfillmentHold')::boolean)=(r->>'orderId'=pg_temp.hold_id('order',7)::text)) and count(*)=2
   from jsonb_array_elements(public.admin_list_goods_preorder_reservations('hold-goods','reserved',100,0)->'items') r)
 then 1 else 0 end as assert_reply_candidates_and_preorders_flag_held;
reset role;
-- 교환 재출고: 보류 주문(12번, 교환 처리 중)에는 새 교환품을 내보내지 않는다(옛 진입점의 물리 기록 단계 — 공개 RPC는 종결 건 재생만 연다).
select pg_temp.expect_error($$select private.record_order_claim_reshipment_physical('a1d00000-0000-4006-8000-000000000012','hanjin','TRK1200000001','[]'::jsonb)$$,'order_fulfillment_hold');
-- 운영 화면의 클레임 연락처 진입점도 기록 전에 같은 검사를 한다(재고 증감 본체는 그대로다).
select 1/case when position('order_fulfillment_held(p_order_id)' in pg_get_functiondef('public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)'::regprocedure))
   between 1 and position('private.record_order_claim_shipment_reshipment(' in pg_get_functiondef('public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)'::regprocedure))
 and position('order_fulfillment' in pg_get_functiondef('private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure))=0
 then 1 else 0 end as assert_reshipment_entry_points_check_hold;

-- ---------------------------------------------------------------------------
-- 4. 화면 읽기와 운영 할 일
-- ---------------------------------------------------------------------------
-- 보류 중: 1·4·5(테스트 결제) 6·7·9·11·12·13·14(결제사 취소) = 10건.
set local role authenticated;
select 1/case when (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',1),pg_temp.hold_id('order',2),pg_temp.hold_id('order',7)])
   ?& array[pg_temp.hold_id('order',1)::text,pg_temp.hold_id('order',7)::text])
 and not (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',2)]) ? pg_temp.hold_id('order',2)::text)
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',7)])->pg_temp.hold_id('order',7)::text->0->>'unexplainedAmount')='3000'
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',7)])->pg_temp.hold_id('order',7)::text->0->>'outboundBlocked')='true'
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',13)])->pg_temp.hold_id('order',13)::text->0->>'outboundBlocked')='false'
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',1)])->pg_temp.hold_id('order',1)::text->0->>'reason')='test_payment'
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',5)])->pg_temp.hold_id('order',5)::text->0->>'placedAt') is not null
 and (public.admin_list_order_fulfillment_holds()->>'total')::integer=10
 and jsonb_array_length(public.admin_list_order_fulfillment_holds(2)->'items')=2
 and public.admin_shipment_fulfillment_hold_flags(array[pg_temp.hold_id('shipment',7),pg_temp.hold_id('shipment',8)])=jsonb_build_array(pg_temp.hold_id('shipment',7))
 and exists(select 1 from jsonb_array_elements(public.admin_operation_tasks()) t where t->>'id'='fulfillment_hold' and (t->>'count')::integer=10
   and t->>'href'='/admin/sales/orders' and t->>'label'='출고 보류')
 then 1 else 0 end as assert_screen_reads;
select pg_temp.expect_error($$select public.admin_order_fulfillment_holds(array_fill(gen_random_uuid(),array[201]))$$,'invalid_fulfillment_hold_query');
reset role;
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error($$select public.admin_order_fulfillment_holds(array['a1d00000-0000-4001-8000-000000000001'::uuid])$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_list_order_fulfillment_holds()$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_shipment_fulfillment_hold_flags(array['a1d00000-0000-4004-8000-000000000001'::uuid])$$,'operator_capability_required');
select pg_temp.expect_error($$select public.admin_release_order_fulfillment_hold('a1d00000-0000-4001-8000-000000000001','test_payment','TEST 해제 사유',gen_random_uuid())$$,'operator_capability_required');
reset role;

-- ---------------------------------------------------------------------------
-- 5. 해제
-- ---------------------------------------------------------------------------
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error($$select public.admin_release_order_fulfillment_hold('a1d00000-0000-4001-8000-000000000007','provider_canceled','짧음',gen_random_uuid())$$,'invalid_fulfillment_hold_release');
select pg_temp.expect_error($$select public.admin_release_order_fulfillment_hold('a1d00000-0000-4001-8000-000000000007','other','TEST 해제 사유',gen_random_uuid())$$,'invalid_fulfillment_hold_release');
select pg_temp.expect_error($$select public.admin_release_order_fulfillment_hold('a1d00000-0000-4001-8000-000000000002','test_payment','TEST 해제 사유',gen_random_uuid())$$,'fulfillment_hold_not_active');
select public.admin_release_order_fulfillment_hold(pg_temp.hold_id('order',7),'provider_canceled','TEST 고객과 통화해 남은 금액으로 출고',
 'a1d00000-0000-4000-8000-0000000000a1') as first_release \gset
select public.admin_release_order_fulfillment_hold(pg_temp.hold_id('order',7),'provider_canceled','TEST 고객과 통화해 남은 금액으로 출고',
 'a1d00000-0000-4000-8000-0000000000a1') as replay_release \gset
select pg_temp.expect_error($$select public.admin_release_order_fulfillment_hold('a1d00000-0000-4001-8000-000000000007','test_payment','TEST 다른 사유로 재요청','a1d00000-0000-4000-8000-0000000000a1')$$,'fulfillment_hold_operation_conflict');
-- 키 모드로만 읽히던 보류(행 없음)도 해제한다.
select public.admin_release_order_fulfillment_hold(pg_temp.hold_id('order',5),'test_payment','TEST 리허설 주문 확인 후 해제','a1d00000-0000-4000-8000-0000000000a2') as derived_release \gset
reset role;
select 1/case when (:'first_release'::jsonb->>'released')='1' and (:'first_release'::jsonb->>'replayed')='false'
 and (:'replay_release'::jsonb->>'replayed')='true' and (:'derived_release'::jsonb->>'released')='1'
 and pg_temp.reasons(7)='' and pg_temp.reasons(5)=''
 and (select release_kind='operator' and released_by='a1d00000-0000-4000-8000-000000000001' and release_note='TEST 고객과 통화해 남은 금액으로 출고'
   from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',7))
 and (select count(*)=1 from public.audit_log where id='a1d00000-0000-4000-8000-0000000000a1' and action='admin.order.fulfillment_hold_released'
   and actor_id='a1d00000-0000-4000-8000-000000000001' and target='order:'||pg_temp.hold_id('order',7) and diff->>'reason'='provider_canceled')
 then 1 else 0 end as assert_release_audited_and_idempotent;
-- 해제한 근거(설명되지 않은 금액 3,000원)는 재전송에도, 그 뒤 우리 부분 취소(2,000원)가 적용된 뒤의 웹훅에도 다시 걸리지 않는다.
-- 결제사에서 더 취소되면(설명되지 않은 금액이 늘면) 새 보류다. 해제 뒤 출고 경로가 열린다.
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'PARTIAL_CANCELED',7000,'webhook-case-0000000015') as same_after_release \gset
reset role;
select private.assert_order_dispatch_allowed(pg_temp.hold_id('order',7));
set local session_replication_role=replica;
insert into private.order_partial_cancellations(order_id,payment_id,provider,sequence,reason_code,customer_decision,warehouse_stop_confirmed,payment_amount,balance_before,
  goods_refund_amount,shipping_refund_amount,refund_amount,state,provider_transaction_key,provider_confirmed_at,operation_id,created_by,applied_at,completed_at)
values(pg_temp.hold_id('order',7),pg_temp.hold_id('payment',7),'toss',1,'out_of_stock','TEST 고객 동의',false,10000,7000,2000,0,2000,'completed','tx-hold-7',now(),
  gen_random_uuid(),'a1d00000-0000-4000-8000-000000000001',now(),now());
set local session_replication_role=origin;
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'PARTIAL_CANCELED',5000,'webhook-case-0000000016') as our_partial_after_release \gset
reset role;
select pg_temp.reasons(7) as reasons_after_our_partial \gset
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'CANCELED',0,'webhook-case-0000000017') as more_after_release \gset
reset role;
select 1/case when :'same_after_release'='already_recorded' and :'our_partial_after_release'='already_recorded' and :'reasons_after_our_partial'=''
 and :'more_after_release'='held' and pg_temp.reasons(7)='provider_canceled'
 and (select count(*)=2 from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',7))
 and exists(select 1 from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',7) and released_at is null
   and evidence_key='provider_canceled:'||pg_temp.hold_id('attempt',7)||':8000' and detail->>'recordedRefundedAmount'='2000')
 then 1 else 0 end as assert_released_evidence_not_reapplied;

-- ---------------------------------------------------------------------------
-- 6. 주문 취소는 보류를 닫는다
-- ---------------------------------------------------------------------------
-- 운영자 전액 취소가 결제사 '이미 취소됨'으로 환불을 닫은 뒤 주문을 취소한 상태를 합성한다(결제 원장은 트리거 없이 바꾼다).
set local session_replication_role=replica;
update public.payments set status='refunded' where id=pg_temp.hold_id('payment',6);
set local session_replication_role=origin;
update public.orders set status='canceled' where id=pg_temp.hold_id('order',6);
select 1/case when pg_temp.reasons(6)='' and not private.order_fulfillment_held(pg_temp.hold_id('order',6))
 and (select bool_and(release_kind='order_canceled' and released_at is not null and release_note is null)
   from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',6))
 and (select count(*)=1 from public.audit_log where target='order:'||pg_temp.hold_id('order',6) and action='system.order.fulfillment_hold_released'
   and diff->>'trigger'='order_canceled')
 then 1 else 0 end as assert_cancel_closes_holds;
-- 없는 주문의 판정은 빈 값이다(null이 아니다 — 'not held' 조건이 null로 행을 버리지 않게).
select 1/case when private.order_fulfillment_hold_reasons(gen_random_uuid())='{}'::text[] and private.order_fulfillment_held(gen_random_uuid())=false
 and private.order_fulfillment_blocking(gen_random_uuid())=false
 then 1 else 0 end as assert_missing_order_not_held;

-- ---------------------------------------------------------------------------
-- 7. 디지털 파일 제공도 보류를 읽는다(내려받기 경로는 출고 공통 검사를 거치지 않는다)
-- ---------------------------------------------------------------------------
-- 15번: 디지털 품목만 있는 테스트 키 결제 주문. 첫 제공도(배송 건 ready·주문 paid) 재다운로드도 보류 중에는 열지 않는다.
select pg_temp.hold_order(15);
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
 ('a1d00000-0000-4008-8000-000000000001','a1d00000-0000-4000-8000-000000000001',now(),now(),now()+interval '1 hour'),
 ('a1d00000-0000-4008-8000-000000000002','a1d00000-0000-4000-8000-000000000002',now(),now(),now()+interval '1 hour');
insert into private.goods_digital_assets(id,actor_id,session_id,filename,mime_type,path,size_bytes,sha256,state,expires_at,verified_at)
 values('a1d00000-0000-4009-8000-000000000001','a1d00000-0000-4000-8000-000000000001','a1d00000-0000-4008-8000-000000000001','TEST 보류 파일.txt','text/plain',
  'a1d00000-0000-4000-8000-000000000001/a1d00000-0000-4009-8000-000000000001.txt',32,repeat('b',64),'verified',now()+interval '1 day',now());
set local session_replication_role=replica;
update public.order_items set fulfillment_terms_snapshot=jsonb_build_object('mode','digital','files',jsonb_build_array(jsonb_build_object('id','a1d00000-0000-4009-8000-000000000001')))
 where order_id=pg_temp.hold_id('order',15);
update public.order_shipments set delivery_method='digital',fulfillment_partition='digital',delivery_selection_id=gen_random_uuid(),
 delivery_method_snapshot='{"version":"2","confirmationRule":"protected_download"}' where id=pg_temp.hold_id('shipment',15);
set local session_replication_role=origin;
set local role service_role;
select public.service_record_goods_payment_key_mode(pg_temp.hold_id('attempt',15),'test');
reset role;
select pg_temp.approve(15);
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(pg_temp.hold_id('attempt',15),'confirm',now());
select id as dl_item from public.order_items where order_id=pg_temp.hold_id('order',15) \gset
set local role service_role;
select pg_temp.expect_error(format('select public.service_get_digital_download_info(%L,%L,%L,%L)','a1d00000-0000-4000-8000-000000000002',
 'a1d00000-0000-4008-8000-000000000002',:'dl_item','a1d00000-0000-4009-8000-000000000001'),'digital_access_on_hold');
select pg_temp.expect_error(format('select public.service_record_digital_download(%L,%L,%L,%L,%L,%L)','a1d00000-0000-4000-8000-000000000002',
 'a1d00000-0000-4008-8000-000000000002',:'dl_item','a1d00000-0000-4009-8000-000000000001','a1d00000-0000-400a-8000-000000000001',repeat('b',64)),'digital_access_on_hold');
reset role;
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000002');
set local role authenticated;
select public.get_my_order_downloads(pg_temp.hold_id('order',15))#>>'{items,0,available}' as dl_available_held \gset
reset role;
-- 디지털 첫 제공처럼 신규주문에서 바로 배송완료로 넘어가는 전이도 막는다.
select pg_temp.expect_error($$update public.orders set status='delivered' where id='a1d00000-0000-4001-8000-000000000015'$$,'order fulfillment hold');
select 1/case when :'dl_available_held'='false' and private.order_fulfillment_blocking(pg_temp.hold_id('order',15))
 and (select status='paid' from public.orders where id=pg_temp.hold_id('order',15))
 and (select status='ready' from public.order_shipments where id=pg_temp.hold_id('shipment',15))
 and not exists(select 1 from private.order_digital_downloads where order_id=pg_temp.hold_id('order',15))
 then 1 else 0 end as assert_digital_held_not_provided;
-- 운영자가 결제를 확인하고 해제하면 받을 수 있고, 첫 제공이 배송완료로 기록된다.
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_release_order_fulfillment_hold(pg_temp.hold_id('order',15),'test_payment','TEST 결제 확인 후 파일 제공','a1d00000-0000-4000-8000-0000000000a5');
reset role;
set local role service_role;
select public.service_record_digital_download('a1d00000-0000-4000-8000-000000000002','a1d00000-0000-4008-8000-000000000002',:'dl_item',
 'a1d00000-0000-4009-8000-000000000001','a1d00000-0000-400a-8000-000000000001',repeat('b',64));
reset role;
select 1/case when (select status='delivered' from public.order_shipments where id=pg_temp.hold_id('shipment',15))
 and (select status='delivered' from public.orders where id=pg_temp.hold_id('order',15))
 and (select count(*)=1 from private.order_digital_downloads where order_id=pg_temp.hold_id('order',15))
 then 1 else 0 end as assert_digital_provided_after_release;

-- 수령 확인 코드: 일부만 나간 보류 주문(16번: 퀵 배송 건은 인계 끝, 택배 배송 건은 발송 전)에서 인계된 배송 건의 수령 코드는 발급한다.
select pg_temp.hold_order(16,'confirmed');
insert into public.order_items(id,order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
 values('a1d00000-0000-4005-8000-000000000161',pg_temp.hold_id('order',16),'hold-goods',1,0,'TEST 출고 보류 굿즈','문구','hold-ip',
  (select id from public.goods_variants where good_id='hold-goods' and is_default));
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values('a1d00000-0000-4004-8000-000000000161',pg_temp.hold_id('order',16),'a1d00000-0000-4000-8000-0000000000f2','TEST 출고 보류 창고 2',0,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 values(pg_temp.hold_id('order',16),'a1d00000-0000-4004-8000-000000000161','a1d00000-0000-4005-8000-000000000161',1);
select pg_temp.approve(16);
set local session_replication_role=replica;
update public.order_shipments set delivery_method='quick',fulfillment_partition='quick',delivery_policy_id=gen_random_uuid(),delivery_selection_id=gen_random_uuid(),
 delivery_method_snapshot='{"version":"2"}',status='shipping',shipped_at=now() where id='a1d00000-0000-4004-8000-000000000161';
update public.orders set status='shipping' where id=pg_temp.hold_id('order',16);
set local session_replication_role=origin;
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',16),'CANCELED',0,'webhook-case-0000000018') as partial_shipped_flag \gset
reset role;
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000002');
set local role authenticated;
select public.issue_shipment_receipt_confirmation('a1d00000-0000-4004-8000-000000000161')->>'code' as receipt_code \gset
reset role;
select 1/case when :'partial_shipped_flag'='held' and private.order_fulfillment_blocking(pg_temp.hold_id('order',16))
 and :'receipt_code' ~ '^[0-9A-F]{12}$'
 then 1 else 0 end as assert_receipt_code_for_handed_over_shipment;

rollback;
