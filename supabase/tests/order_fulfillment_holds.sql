\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 주문 출고 보류(원장 PAY-050·SHP-093·OPS-074·OPS-065·CLM-051)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 운영 배포가 남긴 토스 키 모드가 test인 굿즈 결제가 승인되면 출고 보류(test_payment)가 생긴다. live·키 모드 없음(로컬)은 생기지 않는다
--   · 보류 행이 없어도(트리거 실패를 흉내) 판정은 키 모드에서 보류로 읽는다
--   · 키 모드는 결제 전에만 바꿀 수 있다
--   · 결제사 잔액 대조(provider_canceled): 새 취소 → held, 재전송 → already_recorded, 취소 없음 → consistent,
--     우리 취소 진행 중 → in_flight, 취소 주문·환불 결제 → not_applicable, 더 큰 취소 → 새 보류. 운영 알림을 남긴다
--   · 보류 중인 주문: 자동 발주확인 제외(fulfillment_hold)·수동 발주확인 거절·출고지시 후보 제외·묶음 출고 준비 아님·
--     출고 경로 공통 검사 거절·발송/배송완료 전이 거절. 거래확정(done)은 막지 않는다
--   · 해제: sales.manage만, 사유 5자 이상, 같은 요청번호 재요청은 처음 결과, 다른 내용이면 충돌. 해제한 근거는 다시 걸리지 않는다
--   · 주문이 취소되면 보류가 닫히고 판정도 비운다
--   · 화면 읽기(주문별 보류·목록·발송 행 표시)와 운영 할 일 건수
--   · 권한 봉인(선언적 확인)
-- ============================================================================

select 1/case when (
  has_function_privilege('service_role','public.service_record_goods_payment_key_mode(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.service_record_goods_payment_key_mode(uuid,text)','execute')
  and not has_function_privilege('anon','public.service_record_goods_payment_key_mode(uuid,text)','execute')
  and has_function_privilege('service_role','public.service_flag_goods_provider_cancellation(uuid,text,bigint,text)','execute')
  and not has_function_privilege('authenticated','public.service_flag_goods_provider_cancellation(uuid,text,bigint,text)','execute')
  and has_function_privilege('service_role','public.service_goods_provider_cancellation_context(uuid)','execute')
  and not has_function_privilege('authenticated','public.service_goods_provider_cancellation_context(uuid)','execute')
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
 values('a1d00000-0000-4000-8000-0000000000f1','hold-origin','TEST 출고 보류 창고',0,'합성 반송 주소');

create function pg_temp.hold_id(kind text,n integer) returns uuid language sql immutable as $$
 select ('a1d00000-0000-'||case kind when 'order' then '4001' when 'payment' then '4002' when 'attempt' then '4003' else '4004' end||'-8000-'||lpad(n::text,12,'0'))::uuid
$$;
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
 pg_temp.hold_order(6),pg_temp.hold_order(7,'confirmed'),pg_temp.hold_order(8,'confirmed'),pg_temp.hold_order(9),pg_temp.hold_order(10);

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
select pg_temp.approve(6),pg_temp.approve(7),pg_temp.approve(8),pg_temp.approve(9),pg_temp.approve(10);
set local role service_role;
select 1/case when (public.service_goods_provider_cancellation_context(pg_temp.hold_id('attempt',6))->>'paymentKey')='pk-hold-6'
 and (public.service_goods_provider_cancellation_context(pg_temp.hold_id('attempt',6))->'attempt'->>'provider_order_id')='TEST-HOLD-ORDER-6'
 and public.service_goods_provider_cancellation_context(gen_random_uuid()) is null
 then 1 else 0 end as assert_context_reads_ledger_key;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'DONE',10000,'webhook-case-0000000001') as no_cancel \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'CANCELED',0,'webhook-case-0000000002') as first_cancel \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',6),'CANCELED',0,'webhook-case-0000000003') as replayed_cancel \gset
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'PARTIAL_CANCELED',7000,'webhook-case-0000000004') as partial_cancel \gset
select pg_temp.expect_error($$select public.service_flag_goods_provider_cancellation('a1d00000-0000-4003-8000-000000000006','CANCELED',10001,'webhook-case-0000000005')$$,'invalid_provider_cancellation');
select pg_temp.expect_error($$select public.service_flag_goods_provider_cancellation('a1d00000-0000-4003-8000-000000000006','canceled',0,'webhook-case-0000000005')$$,'invalid_provider_cancellation');
reset role;
select 1/case when :'no_cancel'='consistent' and :'first_cancel'='held' and :'replayed_cancel'='already_recorded' and :'partial_cancel'='held'
 and pg_temp.reasons(6)='provider_canceled' and pg_temp.reasons(7)='provider_canceled'
 and (select detail->>'providerCanceledAmount'='3000' and detail->>'providerStatus'='PARTIAL_CANCELED' and detail->>'recordedRefundedAmount'='0'
   from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',7))
 and (select count(*)=1 from public.audit_log where target='order:'||pg_temp.hold_id('order',6) and action='system.order.fulfillment_hold_placed'
   and diff->>'reason'='provider_canceled' and diff->>'caseRef'='webhook-case-0000000002')
 and (select count(*)=1 from private.admin_operation_alerts a join private.order_fulfillment_holds h on a.event_key='order_fulfillment_holds:'||h.id||':placed'
   where h.order_id=pg_temp.hold_id('order',6) and a.category='orders' and a.href='/admin/sales/orders/'||pg_temp.hold_id('order',6))
 then 1 else 0 end as assert_provider_cancel_flags_once;

-- 우리 취소가 진행 중이면 미룬다. 취소된 주문·환불된 결제·종결 전 시도는 대상이 아니다.
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage)
 values(pg_temp.hold_id('order',9),'a1d00000-0000-4000-8000-000000000002','TEST 취소 진행','cancel','requested');
set local session_replication_role=replica;
update public.payments set status='refunded' where id=pg_temp.hold_id('payment',10);
set local session_replication_role=origin;
set local role service_role;
select 1/case when public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',9),'CANCELED',0,'webhook-case-0000000006')='in_flight'
 and public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',10),'CANCELED',0,'webhook-case-0000000007')='not_applicable'
 and public.service_goods_provider_cancellation_context(pg_temp.hold_id('attempt',10)) is null
 and public.service_flag_goods_provider_cancellation(gen_random_uuid(),'CANCELED',0,'webhook-case-0000000008')='not_applicable'
 then 1 else 0 end as assert_in_flight_and_not_applicable;
reset role;
select 1/case when pg_temp.reasons(9)='' and pg_temp.reasons(10)='' then 1 else 0 end as assert_no_hold_for_own_or_closed_cancel;

-- ---------------------------------------------------------------------------
-- 3. 출고 경로가 보류를 읽는다
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
select pg_temp.expect_error($$update public.orders set status='delivered' where id='a1d00000-0000-4001-8000-000000000007'$$,'order fulfillment hold');

-- ---------------------------------------------------------------------------
-- 4. 화면 읽기와 운영 할 일
-- ---------------------------------------------------------------------------
set local role authenticated;
select 1/case when (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',1),pg_temp.hold_id('order',2),pg_temp.hold_id('order',7)])
   ?& array[pg_temp.hold_id('order',1)::text,pg_temp.hold_id('order',7)::text])
 and not (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',2)]) ? pg_temp.hold_id('order',2)::text)
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',7)])->pg_temp.hold_id('order',7)::text->0->>'providerCanceledAmount')='3000'
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',1)])->pg_temp.hold_id('order',1)::text->0->>'reason')='test_payment'
 and (public.admin_order_fulfillment_holds(array[pg_temp.hold_id('order',5)])->pg_temp.hold_id('order',5)::text->0->>'placedAt') is not null
 and (public.admin_list_order_fulfillment_holds()->>'total')::integer=5
 and jsonb_array_length(public.admin_list_order_fulfillment_holds(2)->'items')=2
 and public.admin_shipment_fulfillment_hold_flags(array[pg_temp.hold_id('shipment',7),pg_temp.hold_id('shipment',8)])=jsonb_build_array(pg_temp.hold_id('shipment',7))
 and exists(select 1 from jsonb_array_elements(public.admin_operation_tasks()) t where t->>'id'='fulfillment_hold' and (t->>'count')::integer=5
   and t->>'href'='/admin/sales/orders' and t->>'label'='출고 보류')
 then 1 else 0 end as assert_screen_reads;
select pg_temp.expect_error($$select public.admin_order_fulfillment_holds(array_fill(gen_random_uuid(),array[201]))$$,'invalid_fulfillment_hold_query');
reset role;
select pg_temp.as_actor('a1d00000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error($$select public.admin_order_fulfillment_holds(array['a1d00000-0000-4001-8000-000000000001'::uuid])$$,'operator_capability_required');
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
-- 해제한 근거(같은 취소 금액)는 웹훅 재전송에도 다시 걸리지 않고, 더 취소되면 새 보류다. 해제 뒤 발송 전이가 열린다.
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'PARTIAL_CANCELED',7000,'webhook-case-0000000009') as same_after_release \gset
reset role;
select private.assert_order_dispatch_allowed(pg_temp.hold_id('order',7));
set local role service_role;
select public.service_flag_goods_provider_cancellation(pg_temp.hold_id('attempt',7),'CANCELED',0,'webhook-case-0000000010') as more_after_release \gset
reset role;
select 1/case when :'same_after_release'='already_recorded' and :'more_after_release'='held' and pg_temp.reasons(7)='provider_canceled'
 and (select count(*)=2 from private.order_fulfillment_holds where order_id=pg_temp.hold_id('order',7))
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
 then 1 else 0 end as assert_missing_order_not_held;

rollback;
