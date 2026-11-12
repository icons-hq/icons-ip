\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bb160000-0000-4000-8000-000000000001','authenticated','authenticated','purchase-confirm-admin@example.test',now(),'{}','{}',now(),now()),
 ('bb160000-0000-4000-8000-000000000002','authenticated','authenticated','purchase-confirm-buyer@example.test',now(),'{}','{}',now(),now()),
 ('bb160000-0000-4000-8000-000000000003','authenticated','authenticated','purchase-confirm-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 구매확정 SQL '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bb160000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('bb160000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('purchase-confirm-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bb160000-0000-4000-8000-000000000010','purchase-confirm-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('purchase-confirm-a','purchase-confirm-ip','TEST 상품 A','문구',10000,'ok',100,'bb160000-0000-4000-8000-000000000010','policy',0),
 ('purchase-confirm-b','purchase-confirm-ip','TEST 상품 B','문구',5000,'ok',100,'bb160000-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','confirmation-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='purchase-confirm-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='purchase-confirm-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='purchase-confirm-ip';
select id as variant_a from public.goods_variants where good_id='purchase-confirm-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='purchase-confirm-b' and is_default \gset


insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('bb160000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('bb160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','bb160000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','bb160000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','bb160000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.confirm_order(n integer,delivered_at_value timestamptz default clock_timestamp()-interval '2 days') returns uuid language plpgsql as $$
declare oid uuid:=('bb160000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid uuid:=gen_random_uuid();item uuid;
begin
 insert into public.orders(id,user_id,status,total,address,store_credit_policy_snapshot) values(oid,'bb160000-0000-4000-8000-000000000002','confirmed',10000,
 '{"recipientName":"TEST 구매확정","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
 '{"enabled":true,"earnKind":"fixed","earnValue":100,"earnMaxPerOrder":1000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":1000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits"}');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select oid,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='purchase-confirm-a' returning id into item;
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key) values('bb160000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','purchase-confirm-payment-'||n);
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values(sid,oid,'bb160000-0000-4000-8000-000000000010','TEST 출고지',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='TESTCONFIRM'||n,shipped_at=delivered_at_value-interval '1 day',delivered_at=delivered_at_value where id=sid;
 update public.orders set status='delivered',delivered_at=delivered_at_value where id=oid;
 return oid;
end $$;
-- Rollback-only baseline allows rerunning after synthetic browser settings.
update private.purchase_confirmation_policy set auto_enabled=false,auto_after_days=null,buyer_extension_days=null,revision=1 where singleton;
select 1/case when public.settle_delivered_orders()=0 and (select not auto_enabled and auto_after_days is null from private.purchase_confirmation_policy where singleton) then 1 else 0 end as default_off;
select pg_temp.confirm_order(1) as order_a \gset
select pg_temp.confirm_order(2) as order_b \gset
select pg_temp.as_actor(1);
set local role authenticated;
select '{"autoEnabled":true,"autoAfterDays":1,"buyerExtensionDays":3,"evidence":"TEST ONLY","acknowledged":true}' as settings \gset
select public.admin_save_purchase_confirmation_policy(:'settings',1,'bb160000-0000-4002-8000-000000000001','bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001') as policy \gset
select 1/case when public.admin_save_purchase_confirmation_policy(:'settings',1,'bb160000-0000-4002-8000-000000000001','bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001')=:'policy'::jsonb then 1 else 0 end as policy_replay;
select pg_temp.transaction_expect_error(format('select public.admin_save_purchase_confirmation_policy(%L,1,gen_random_uuid(),%L,%L)',:'settings','bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001'),'purchase_confirmation_changed');
reset role;
select pg_temp.confirm_order(3) as order_c \gset
select pg_temp.confirm_order(4) as order_d \gset
select pg_temp.confirm_order(5) as order_e \gset
select pg_temp.confirm_order(6) as order_f \gset
-- D11(2026-10-27): 켜는 순간 꺼져 있던 기간의 배송완료 주문도 배송완료 시각 + 현재 기간을 받는다.
select 1/case when (select auto_due_at=o.delivered_at+interval '1 day' and policy_snapshot->>'retroactive'='true' and revision=1
  from private.order_purchase_confirmations c join public.orders o on o.id=c.order_id where c.order_id=:'order_a') and
 (select auto_due_at is not null and policy_snapshot->>'autoAfterDays'='1' and not policy_snapshot ? 'retroactive' from private.order_purchase_confirmations where order_id=:'order_c')
 and (select diff->>'retroactiveDueDates'='2' from public.audit_log where id='bb160000-0000-4002-8000-000000000001') then 1 else 0 end as retroactive_deadline_on_enable;
-- 구매확정 도입 전 배송완료(확정 행 없음)도 다음 정책 저장 때 같은 기준으로 채운다.
-- 상태 전이 트리거를 거치지 않도록 처음부터 배송완료로 넣는다(도입 전 배송완료와 같은 모양).
insert into public.orders(id,user_id,status,total,address,delivered_at) values('bb160000-0000-4001-8000-000000000099','bb160000-0000-4000-8000-000000000002','delivered',10000,'{}',clock_timestamp()-interval '10 days');
select 1/case when not exists(select 1 from private.order_purchase_confirmations where order_id='bb160000-0000-4001-8000-000000000099')
 then 1 else 0 end as no_row_before_feature;
select private.backfill_purchase_confirmation_due_dates() as first_backfill \gset
select private.backfill_purchase_confirmation_due_dates() as second_backfill \gset
select 1/case when :'first_backfill'='1' and :'second_backfill'='0'
 and (select auto_due_at=o.delivered_at+interval '1 day' from private.order_purchase_confirmations c join public.orders o on o.id=c.order_id where c.order_id='bb160000-0000-4001-8000-000000000099')
 then 1 else 0 end as backfills_rows_missing_before_feature;
-- 이 주문은 결제 원장이 없어 이후 자동 확정 대상(purchase_confirmation_eligible)이 아니다.
-- Requests are an in-app operational notice, one per order. Retries preserve history.
select pg_temp.as_actor(1);
set local role authenticated;
-- order_a는 켤 때 소급 기한을 받으며 revision이 1이 됐다.
select public.admin_change_purchase_confirmation(:'order_a','request','',1,'bb160000-0000-4002-8000-000000000002','bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
select public.admin_change_purchase_confirmation(:'order_a','request','',1,'bb160000-0000-4002-8000-000000000002','bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
select public.admin_change_purchase_confirmation(:'order_a','hold','TEST 구매자에게 표시할 보류',2,gen_random_uuid(),'bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
select pg_temp.as_actor(2);
select 1/case when public.get_my_purchase_confirmation(:'order_a')->>'canConfirm'='false' then 1 else 0 end as held_cannot_confirm;
select pg_temp.transaction_expect_error(format('select public.confirm_my_purchase(%L,%L,3,gen_random_uuid(),%L,%L,true)',:'order_a','confirm','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'purchase_confirmation_held');
select pg_temp.as_actor(1);
select public.admin_change_purchase_confirmation(:'order_a','resume','',3,gen_random_uuid(),'bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
select pg_temp.as_actor(2);
select public.confirm_my_purchase(:'order_a','confirm',4,'bb160000-0000-4002-8000-000000000003','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002',true) as confirmed \gset
select 1/case when public.confirm_my_purchase(:'order_a','confirm',4,'bb160000-0000-4002-8000-000000000003','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002',true)=:'confirmed'::jsonb then 1 else 0 end as confirm_replay;
select public.confirm_my_purchase(:'order_c','extend',0,gen_random_uuid(),'bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002',true);
select pg_temp.transaction_expect_error(format('select public.confirm_my_purchase(%L,%L,1,gen_random_uuid(),%L,%L,true)',:'order_c','extend','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'purchase_confirmation_extension_unavailable');
select pg_temp.as_actor(3);
select pg_temp.transaction_expect_error(format('select public.get_my_purchase_confirmation(%L)',:'order_a'),'insufficient_privilege');
select pg_temp.transaction_expect_error(format('select public.confirm_my_purchase(%L,%L,0,gen_random_uuid(),%L,%L,true)',:'order_b','confirm','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'purchase_confirmation_auth_changed');
reset role;
select 1/case when (select count(*)=1 from public.store_credit_ledger where order_id=:'order_a' and kind='grant')
 and (select count(*)=1 from public.notifications where source_type='purchase_confirmation' and source_id=:'order_a') then 1 else 0 end as one_earning_one_notice;
-- A confirmed order still accepts a return within its original delivery window.
set local role service_role;
select 1/case when public.request_order_claim(:'order_a','bb160000-0000-4000-8000-000000000002','return','TEST 확정 후 반품','change_of_mind')='requested' then 1 else 0 end as return_after_buyer_confirmation;
reset role;
insert into public.order_cancellation_requests(order_id,requested_by,reason,reason_type,claim_type,stage)
 values(:'order_d','bb160000-0000-4000-8000-000000000002','TEST 진행 클레임','defect','return','requested');
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_change_purchase_confirmation(:'order_e','hold','TEST 자동 확정 보류',0,gen_random_uuid(),'bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
select public.admin_save_purchase_confirmation_policy(:'settings'::jsonb||'{"autoEnabled":false}',2,gen_random_uuid(),'bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
reset role;
set local role service_role;
select 1/case when public.settle_delivered_orders()=0 then 1 else 0 end as global_stop;
reset role;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_save_purchase_confirmation_policy(:'settings'::jsonb||'{"autoAfterDays":30}',3,gen_random_uuid(),'bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
reset role;
set local role service_role;
select 1/case when public.settle_delivered_orders()=2 and public.settle_delivered_orders()=0 then 1 else 0 end as eligible_automatic_orders;
reset role;
-- order_b는 꺼져 있던 기간의 배송완료라 켤 때 받은 1일 기한(소급)으로, order_f는 배송완료 당시 저장한 1일 정책으로 확정된다.
select 1/case when (select status='done' from public.orders where id=:'order_f') and
 (select count(*)=1 and sum(amount)=100 from public.store_credit_ledger where order_id=:'order_f' and kind='grant') and
 (select status='done' from public.orders where id=:'order_b') and
 (select confirmation_kind='automatic' from private.order_purchase_confirmations where order_id=:'order_b') and
 (select count(*)=3 from public.orders where id=any(array[:'order_c'::uuid,:'order_d'::uuid,:'order_e'::uuid]) and status='delivered') then 1 else 0 end as frozen_policy_and_all_blockers;
select 1/case when not has_table_privilege('authenticated','private.order_purchase_confirmations','update') and
 not has_function_privilege('service_role','public.confirm_my_purchase(uuid,text,bigint,uuid,uuid,uuid,boolean)','execute') and
 not has_function_privilege('anon','public.get_my_purchase_confirmation(uuid)','execute') then 1 else 0 end as sealed_acl;

-- T14c(1014-079): 리뷰 등록 = 구매확정. 리뷰는 늘 구매확정된 주문에만 남는다.
-- 자동 구매확정이 켜진(배송완료 후 30일) 상태에서 시작한다. 확정·적립은 [구매확정] 버튼과 같은 함수·trigger를 탄다.
create function pg_temp.expect_error_detail(statement text,expected text,expected_detail text) returns void language plpgsql as $$
declare detail text;begin
 begin execute statement;exception when others then get stacked diagnostics detail=pg_exception_detail;
  if position(expected in sqlerrm)>0 and detail is not distinct from expected_detail then return;end if;raise;end;
 raise exception 'Expected error: % / %',expected,expected_detail;
end $$;
select pg_temp.confirm_order(20) as review_order \gset
select pg_temp.confirm_order(21) as review_claim_order \gset
select pg_temp.confirm_order(22) as review_held_order \gset
select pg_temp.confirm_order(23) as review_auto_order \gset
select pg_temp.confirm_order(24) as review_button_order \gset
select pg_temp.confirm_order(25) as review_legacy_order \gset
select 1/case when (select count(*)=6 from private.order_purchase_confirmations where confirmed_at is null and auto_due_at is not null and order_id=any(array[
 :'review_order'::uuid,:'review_claim_order'::uuid,:'review_held_order'::uuid,:'review_auto_order'::uuid,:'review_button_order'::uuid,:'review_legacy_order'::uuid]))
 then 1 else 0 end as review_orders_wait_for_automatic;
insert into public.order_cancellation_requests(order_id,requested_by,reason,reason_type,claim_type,stage)
 values(:'review_claim_order','bb160000-0000-4000-8000-000000000002','TEST 리뷰 전 반품','defect','return','requested');
-- 도입 전에 쓴 미확정 주문 리뷰는 그대로 둔다(소급 확정하지 않는다).
insert into public.reviews(user_id,good_id,order_id,rating,body,image_paths,review_kind)
 values('bb160000-0000-4000-8000-000000000002','purchase-confirm-a',:'review_legacy_order',4,'TEST 도입 전 미확정 주문 리뷰','{}','ordinary') returning id as legacy_review \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_change_purchase_confirmation(:'review_held_order','hold','TEST 사진 확인 뒤 확정',0,gen_random_uuid(),'bb160000-0000-4000-8000-000000000001','bb160000-0000-4000-9000-000000000001');
reset role;
select pg_temp.as_actor(2);
set local role authenticated;
-- 확정 안내를 거치지 않는 기존 작성 함수는 미확정 주문에 리뷰를 남기지 않는다.
select pg_temp.transaction_expect_error(format($q$select public.create_good_review_v2(%L,'purchase-confirm-a',5,'TEST 확정 없는 리뷰','{}','ordinary')$q$,:'review_order'),'review_purchase_confirmation_required');
select pg_temp.transaction_expect_error(format($q$select public.create_good_review(%L,'purchase-confirm-a',5,'TEST 확정 없는 리뷰')$q$,:'review_order'),'review_purchase_confirmation_required');
-- 쓰기 화면: 미확정이면 확정 안내가 필요하고, 확정할 수 없으면 같은 이유로 막는다.
select 1/case when (select writable and purchase_confirmation_required and purchase_confirmation_block is null and purchase_confirmation_hold_reason is null
  from public.my_review_targets_v3(:'review_order') where review_kind='ordinary')
 and (select not writable and purchase_confirmation_required and purchase_confirmation_block='claim_in_progress' and purchase_confirmation_hold_reason is null
  from public.my_review_targets_v3(:'review_claim_order') where review_kind='ordinary')
 and (select not writable and purchase_confirmation_block='held' and purchase_confirmation_hold_reason='TEST 사진 확인 뒤 확정'
  from public.my_review_targets_v3(:'review_held_order') where review_kind='ordinary')
 and (select not writable and editable and review_id=:'legacy_review' and purchase_confirmation_block is null
  from public.my_review_targets_v3(:'review_legacy_order') where review_kind='ordinary')
 and (select writable and order_number is not null from public.my_review_targets_v2(:'review_claim_order') where review_kind='ordinary')
 then 1 else 0 end as review_targets_show_confirmation_state;
-- 확인 체크가 없거나 세션이 다르면 확정도 리뷰도 하지 않는다.
select pg_temp.transaction_expect_error(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'TEST 확인 없는 리뷰','{}','ordinary',false,%L,%L)$q$,
 :'review_order','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'review_purchase_confirmation_ack_required');
select pg_temp.transaction_expect_error(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'TEST 다른 세션 리뷰','{}','ordinary',true,%L,%L)$q$,
 :'review_order','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000003'),'purchase_confirmation_auth_changed');
-- 반품 진행·보류 주문은 구매확정과 같은 이유로 리뷰도 막는다.
select pg_temp.expect_error_detail(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'TEST 반품 중 리뷰','{}','ordinary',true,%L,%L)$q$,
 :'review_claim_order','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'review_purchase_confirmation_blocked','claim_in_progress');
select pg_temp.expect_error_detail(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'TEST 보류 중 리뷰','{}','ordinary',true,%L,%L)$q$,
 :'review_held_order','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'review_purchase_confirmation_blocked','held');
-- 리뷰 저장이 실패하면 먼저 한 구매확정도 함께 되돌아간다.
select pg_temp.transaction_expect_error(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'짧음','{}','ordinary',true,%L,%L)$q$,
 :'review_order','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'invalid_review_body');
reset role;
select 1/case when (select status='delivered' from public.orders where id=:'review_order')
 and not exists(select 1 from private.purchase_confirmation_events where order_id=any(array[:'review_order'::uuid,:'review_claim_order'::uuid]))
 and (select count(*)=1 and min(kind)='hold' from private.purchase_confirmation_events where order_id=:'review_held_order')
 and not exists(select 1 from public.reviews where order_id=any(array[:'review_order'::uuid,:'review_claim_order'::uuid,:'review_held_order'::uuid]))
 then 1 else 0 end as rejected_reviews_leave_orders_unconfirmed;
select pg_temp.as_actor(2);
set local role authenticated;
-- 확인하고 등록하면 같은 트랜잭션에서 구매확정된다. 같은 리뷰를 다시 보내도 확정·적립은 늘지 않는다.
select public.create_good_review_v3(:'review_order','purchase-confirm-a',5,'TEST 리뷰 등록과 구매확정','{}','ordinary',true,
 'bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002') as review_confirmed \gset
select pg_temp.transaction_expect_error(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'TEST 리뷰 등록과 구매확정','{}','ordinary',true,%L,%L)$q$,
 :'review_order','bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002'),'review_already_exists');
select 1/case when (select not writable and not purchase_confirmation_required and review_id is not null from public.my_review_targets_v3(:'review_order') where review_kind='ordinary')
 then 1 else 0 end as confirmed_review_target;
-- 다른 계정은 남의 주문에 리뷰도 확정도 남기지 못한다.
select pg_temp.as_actor(3);
select pg_temp.transaction_expect_error(format($q$select public.create_good_review_v3(%L,'purchase-confirm-a',5,'TEST 남의 주문 리뷰','{}','ordinary',true,%L,%L)$q$,
 :'review_button_order','bb160000-0000-4000-8000-000000000003','bb160000-0000-4000-9000-000000000003'),'review_order_not_found');
reset role;
select 1/case when (:'review_confirmed'::jsonb->>'purchaseConfirmed')::boolean
 and (select status='done' and done_at is not null from public.orders where id=:'review_order')
 and (select confirmation_kind='buyer' and confirmed_by='bb160000-0000-4000-8000-000000000002' and confirmed_at is not null from private.order_purchase_confirmations where order_id=:'review_order')
 and (select count(*)=1 and min(kind)='confirm' and min(note)='리뷰 등록과 함께 확정' from private.purchase_confirmation_events where order_id=:'review_order')
 and (select count(*)=1 and sum(amount)=100 from public.store_credit_ledger where order_id=:'review_order' and kind='grant')
 and (select count(*)=1 from public.reviews where order_id=:'review_order' and id=(:'review_confirmed'::jsonb->>'reviewId')::uuid)
 and (select count(*)=1 from public.audit_log where action='order.purchase_confirmation.confirm' and target='order:'||:'review_order')
 and (select status='delivered' from public.orders where id=:'review_button_order')
 then 1 else 0 end as review_confirms_once;
-- 자동 구매확정이 켜진 상태: 리뷰로 확정한 주문은 자동 작업이 다시 확정하지 않고, 보류 주문은 건너뛴다.
update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 second'
 where order_id=any(array[:'review_order'::uuid,:'review_auto_order'::uuid,:'review_held_order'::uuid]);
set local role service_role;
select public.settle_delivered_orders() as review_settled \gset
reset role;
select 1/case when (select confirmation_kind='buyer' from private.order_purchase_confirmations where order_id=:'review_order')
 and not exists(select 1 from private.purchase_confirmation_events where order_id=:'review_order' and kind='automatic')
 and (select o.status='done' and c.confirmation_kind='automatic' from public.orders o join private.order_purchase_confirmations c on c.order_id=o.id where o.id=:'review_auto_order')
 and (select status='delivered' from public.orders where id=:'review_held_order')
 then 1 else 0 end as automatic_respects_review_confirmation;
select pg_temp.as_actor(2);
set local role authenticated;
-- 자동 확정된 주문은 확정 안내 없이(체크 없이) 리뷰만 저장한다.
select 1/case when (select writable and not purchase_confirmation_required and purchase_confirmation_block is null from public.my_review_targets_v3(:'review_auto_order') where review_kind='ordinary')
 then 1 else 0 end as automatic_target_needs_no_confirmation;
select public.create_good_review_v3(:'review_auto_order','purchase-confirm-a',4,'TEST 자동 확정 뒤 리뷰','{}','ordinary',false,
 'bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002') as review_after_automatic \gset
-- 리뷰 없이 [구매확정]만 누르는 길은 그대로다. 그 뒤 리뷰는 확정을 다시 하지 않는다.
select public.confirm_my_purchase(:'review_button_order','confirm',0,gen_random_uuid(),'bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002',true);
select public.create_good_review_v3(:'review_button_order','purchase-confirm-a',3,'TEST 구매확정 버튼 뒤 리뷰','{}','ordinary',false,
 'bb160000-0000-4000-8000-000000000002','bb160000-0000-4000-9000-000000000002') as review_after_button \gset
-- 도입 전 리뷰는 수정해도 구매확정하지 않는다.
select public.update_good_review(:'legacy_review',5,'TEST 도입 전 리뷰 수정','{}');
reset role;
select 1/case when not (:'review_after_automatic'::jsonb->>'purchaseConfirmed')::boolean and not (:'review_after_button'::jsonb->>'purchaseConfirmed')::boolean
 and (select count(*)=1 and min(kind)='automatic' from private.purchase_confirmation_events where order_id=:'review_auto_order')
 and (select count(*)=1 and min(kind)='confirm' and min(note)='' from private.purchase_confirmation_events where order_id=:'review_button_order')
 and (select count(*)=1 from public.store_credit_ledger where order_id=:'review_auto_order' and kind='grant')
 and (select count(*)=1 from public.store_credit_ledger where order_id=:'review_button_order' and kind='grant')
 and (select count(*)=1 from public.reviews where order_id=:'review_auto_order')
 and (select count(*)=1 from public.reviews where order_id=:'review_button_order')
 and (select status='delivered' from public.orders where id=:'review_legacy_order')
 and not exists(select 1 from private.purchase_confirmation_events where order_id=:'review_legacy_order')
 and (select body='TEST 도입 전 리뷰 수정' from public.reviews where id=:'legacy_review')
 then 1 else 0 end as button_and_automatic_paths_unchanged;
select 1/case when has_function_privilege('authenticated','public.create_good_review_v3(uuid,text,integer,text,text[],text,boolean,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.create_good_review_v3(uuid,text,integer,text,text[],text,boolean,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.create_good_review_v3(uuid,text,integer,text,text[],text,boolean,uuid,uuid)','execute')
 and has_function_privilege('authenticated','public.my_review_targets_v3(uuid,text,integer)','execute')
 and not has_function_privilege('anon','public.my_review_targets_v3(uuid,text,integer)','execute')
 and not has_function_privilege('authenticated','private.purchase_confirmation_block_reason(uuid)','execute')
 then 1 else 0 end as review_confirmation_sealed_acl;
rollback;
