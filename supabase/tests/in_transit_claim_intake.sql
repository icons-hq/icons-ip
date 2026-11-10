\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bd160000-0000-4000-8000-000000000001','authenticated','authenticated','transit-claim-admin@example.test',now(),'{}','{}',now(),now()),
 ('bd160000-0000-4000-8000-000000000002','authenticated','authenticated','transit-claim-buyer@example.test',now(),'{}','{}',now(),now()),
 ('bd160000-0000-4000-8000-000000000003','authenticated','authenticated','transit-claim-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 배송중 SQL '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bd160000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bd160000-0000-4000-8000-000000000001','bd160000-0000-4000-8000-000000000002','bd160000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('bd160000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('transit-claim-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bd160000-0000-4000-8000-000000000010','transit-claim-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('transit-claim-a','transit-claim-ip','TEST 상품 A','문구',10000,'ok',100,'bd160000-0000-4000-8000-000000000010','policy',0),
 ('transit-claim-b','transit-claim-ip','TEST 상품 B','문구',5000,'ok',100,'bd160000-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transit-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='transit-claim-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='transit-claim-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='transit-claim-ip';
select id as variant_a from public.goods_variants where good_id='transit-claim-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='transit-claim-b' and is_default \gset


insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('bd160000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('bd160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','bd160000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','bd160000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','bd160000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.confirm_order(n integer,delivered_at_value timestamptz default clock_timestamp()-interval '2 days') returns uuid language plpgsql as $$
declare oid uuid:=('bd160000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid uuid:=gen_random_uuid();item uuid;
begin
 insert into public.orders(id,user_id,status,total,address,store_credit_policy_snapshot) values(oid,'bd160000-0000-4000-8000-000000000002','confirmed',10000,
 '{"recipientName":"TEST 구매확정","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
 '{"enabled":true,"earnKind":"fixed","earnValue":100,"earnMaxPerOrder":1000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":1000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits"}');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select oid,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='transit-claim-a' returning id into item;
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key) values('bd160000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','transit-claim-payment-'||n);
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values(sid,oid,'bd160000-0000-4000-8000-000000000010','TEST 출고지',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='TESTCONFIRM'||n,shipped_at=delivered_at_value-interval '1 day',delivered_at=null where id=sid;
 update public.orders set status='shipping',delivered_at=null where id=oid;
 return oid;
end $$;

select pg_temp.confirm_order(1) as order_a \gset
select pg_temp.confirm_order(2) as order_b \gset
select pg_temp.confirm_order(3) as order_c \gset
select pg_temp.confirm_order(4) as order_d \gset
update public.payments set payment_key='TRANSIT-TEST-'||right(ref_id::text,1) where ref_id::text like 'bd160000-0000-4001-%';
select id as shipment_a from public.order_shipments where order_id=:'order_a' \gset
select id as shipment_b from public.order_shipments where order_id=:'order_b' \gset
select id as shipment_c from public.order_shipments where order_id=:'order_c' \gset
-- Order A has one in-transit unit and one never-dispatched unit. Both must be
-- recovered/retained at their warehouses before the whole-order refund opens.
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values('bd160000-0000-4000-8000-000000000020','transit-extra','TEST 추가 출고지',0,'TEST 추가 반송지',true);
update public.order_items set unit_price=5000 where order_id=:'order_a';
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select :'order_a',g.id,v.id,1,5000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='transit-claim-b';
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values('bd160000-0000-4000-8000-000000000030',:'order_a','bd160000-0000-4000-8000-000000000020','TEST 추가 출고지',0,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select order_id,'bd160000-0000-4000-8000-000000000030',id,1 from public.order_items where order_id=:'order_a' and good_id='transit-claim-b';
select pg_temp.as_actor(2);
set local role authenticated;
select 1/case when public.order_claim_eligibility(:'order_a')='{"cancel":false,"return":true,"exchange":true}' then 1 else 0 end as in_transit_mixed_intake;
reset role;
select 1/case when not private.order_all_items_delivered(:'order_a') then 1 else 0 end as intake_is_not_delivery;
set local role service_role;
select 1/case when public.request_order_claim(:'order_a','bd160000-0000-4000-8000-000000000002','return','TEST 배송 중 전체 반품','change_of_mind')='requested' then 1 else 0 end as customer_intake;
reset role;
select id as claim_a from public.order_cancellation_requests where order_id=:'order_a' \gset
select 1/case when (select collection_required and collection_policy='origin' from public.order_cancellation_requests where id=:'claim_a')
 and (select status='shipping' from public.orders where id=:'order_a') and not exists(select 1 from public.refunds where cancellation_request_id=:'claim_a') then 1 else 0 end as intake_preserves_money_status;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_decide_order_claim(:'claim_a','approve',null);
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)','bd160000-0000-4000-8000-000000000030','shipping','hanjin','TESTTRACK1234'),'order cancellation in progress');
select pg_temp.transaction_expect_error(format('select public.admin_record_order_claim_refund(%L,%L,%L,null)',:'claim_a','pg_cancel','filed'),'claim_collections_incomplete');
select public.admin_record_order_claim_origin_collection(:'claim_a',:'shipment_a','TEST 운송 중 회송 실물 1개 입고');
select pg_temp.transaction_expect_error(format('select public.admin_record_order_claim_refund(%L,%L,%L,null)',:'claim_a','pg_cancel','filed'),'claim_collections_incomplete');
select public.admin_record_order_claim_origin_collection(:'claim_a','bd160000-0000-4000-8000-000000000030','TEST 미출고 실물 1개 창고 보관 확인');
select public.admin_record_order_claim_refund(:'claim_a','pg_cancel','filed',null);
reset role;
select 1/case when public.assert_order_cancellation_reconciliation_allowed(:'claim_a','bd160000-0000-4000-8000-000000000001')='allowed' then 1 else 0 end as refund_opens_after_both_receipts;
-- Synthetic provider-result finalizer: no external refund request is made.
select public.complete_order_cancellation_request(:'claim_a',array['TRANSIT-TEST-1'],'bd160000-0000-4000-8000-000000000001');
select 1/case when (select status='canceled' from public.orders where id=:'order_a') and (select amount=10000 and status='done' from public.refunds where cancellation_request_id=:'claim_a') then 1 else 0 end as full_refund_after_transit_collection;
-- Seller intake uses the same server rule and preserves actual actor/evidence.
select pg_temp.as_actor(1);
set local role authenticated;
select 1/case when public.admin_seller_claim_intake_context(:'order_b')#>'{blockedReasons}'='{"change_of_mind":null,"defect":null}' then 1 else 0 end as seller_in_transit_context;
select public.admin_submit_seller_claim_intake('bd160000-0000-4002-8000-000000000001',jsonb_build_object('orderId',:'order_b','claimType','exchange','reasonType','defect','reason','TEST 배송 중 전체 교환',
 'source','phone','inquiryId',null,'customerRequestedAt',clock_timestamp(),'agreementEvidence','TEST 합성 고객 합의','agreementConfirmed',true,
 'collectionAddress','{"recipientName":"TEST","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소","address2":""}'::jsonb,
 'collections',jsonb_build_array(jsonb_build_object('shipmentId',:'shipment_b','method','not_requested','carrier',null,'trackingNumber',null,'note',''))),null);
select public.admin_decide_order_claim('bd160000-0000-4002-8000-000000000001','approve',null);
reset role;
select pg_temp.transaction_expect_error($q$select private.record_order_claim_reshipment_physical('bd160000-0000-4002-8000-000000000001','hanjin','TESTRESHIP1234','[]')$q$,'claim_collections_incomplete');
set local role authenticated;
select public.admin_record_order_claim_origin_collection('bd160000-0000-4002-8000-000000000001',:'shipment_b','TEST 교환 대상 실물 회송 완료');
reset role;
-- The sealed physical engine is tested directly; contact-version binding is
-- independently tested by the current public contact-v2 contract suite.
select private.record_order_claim_reshipment_physical('bd160000-0000-4002-8000-000000000001','hanjin','TESTRESHIP1234','[]');
select 1/case when not private.order_all_items_delivered(:'order_b') and not private.order_return_intake_eligible(:'order_b') then 1 else 0 end as replacement_in_transit_blocks_new_claim;
set local role authenticated;
select public.admin_record_order_claim_reshipment_delivery('bd160000-0000-4002-8000-000000000001','TEST 교환품 최초 수령 확인');
reset role;
select 1/case when private.order_all_items_delivered(:'order_b') and (select status='delivered' and delivered_at is not null from public.orders where id=:'order_b')
 and (select status='shipping' and delivered_at is null from public.order_shipments where id=:'shipment_b') then 1 else 0 end as replacement_receipt_is_first_supply_original_preserved;
-- Recording arrival of an already dispatched parcel remains possible during
-- collection. It must not acknowledge recovery or release a refund.
set local role service_role;
select public.request_order_claim(:'order_c','bd160000-0000-4000-8000-000000000002','return','TEST 도착 중 접수','change_of_mind');
reset role;
select id as claim_c from public.order_cancellation_requests where order_id=:'order_c' \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_update_shipment_status(:'shipment_c','delivered',null,null);
reset role;
select 1/case when (select status='delivered' from public.orders where id=:'order_c') and (select stage='requested' and collected_at is null from public.order_cancellation_requests where id=:'claim_c')
 and not private.purchase_confirmation_eligible(:'order_c') and not exists(select 1 from public.refunds where cancellation_request_id=:'claim_c') then 1 else 0 end as arrived_with_claim_no_automatic_financial_progress;
-- Missing quantities never become a valid full-order intake.
delete from public.order_shipment_items where order_id=:'order_d';
select 1/case when not private.order_return_intake_eligible(:'order_d') then 1 else 0 end as missing_quantity_denied;
select 1/case when not has_function_privilege('authenticated','private.order_return_intake_eligible(uuid)','execute') then 1 else 0 end as private_gate_sealed;
rollback;
