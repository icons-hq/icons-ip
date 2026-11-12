\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 운영 강제 배송완료 (1014-083, ADR-0025 보완)
--
--   · 스테이징 허용 행이 없는 DB(운영과 같은 모양)에서도 배송 처리 권한(sales.manage)이면 실행한다
--   · 사유 필수, 확인창용 미리보기는 대상·출고지시 전달 여부·막는 사유만 읽고 바꾸지 않는다
--   · 택배는 운송장 없이, 택배 외(퀵·방문수령 등)는 'forced_delivered' 증거로 배송완료한다. 택배 발송 메일은 없고
--     주문이 배송완료되면 고객 앱 알림('배송이 완료됐어요')은 정상 배송완료와 같이 생긴다
--   · 예외: 디지털 파일(구매자 내려받기로만 제공 시작), 발주확인 전, 진행 중 클레임, 예약 재고 미할당.
--     이미 끝난 주문(배송완료·거래확정·취소)은 '발주확인 먼저'가 아니라 '처리할 배송 건 없음'으로 막는다(QA1 S-T04-05)
--   · 배송 방식 가드는 강제 증거 외에는 여전히 실제 인계·일회 수령 확인값을 요구한다
--   · 구매확정 기한 저장·합포장 동반 처리·감사(사유)·같은 요청 재전송은 정상 배송완료·테스트 도구와 같다
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_force_order_delivery_preview(text)','execute')
  and not has_function_privilege('anon','public.admin_force_order_delivery_preview(text)','execute')
  and not has_function_privilege('service_role','public.admin_force_order_delivery_preview(text)','execute')
  and has_function_privilege('authenticated','public.admin_force_order_delivered(text,text,uuid)','execute')
  and not has_function_privilege('anon','public.admin_force_order_delivered(text,text,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_force_order_delivered(text,text,uuid)','execute')
  and not has_function_privilege('authenticated','private.forced_delivery_order_number(text)','execute')
) then 1 else 0 end as assert_sealed_acl;

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('f0dd0000-0000-4000-8000-000000000001','authenticated','authenticated','forced-delivery-operator@example.test',now(),'{}','{}',now(),now()),
 ('f0dd0000-0000-4000-8000-000000000002','authenticated','authenticated','forced-delivery-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 강제 배송완료 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='f0dd0000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('f0dd0000-0000-4000-8000-000000000001','f0dd0000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('f0dd0000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;
insert into public.ips(id,title,vertical_key) values('forced-delivery-ip','TEST 강제 배송완료 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('forced-delivery-goods','forced-delivery-ip','TEST 강제 배송완료 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
 values('f0dd0000-0000-4000-8000-0000000000f1','forced-delivery-origin','TEST 강제 배송완료 창고',0,'합성 반송 주소',true);
insert into private.fulfillment_delivery_policies(id,origin_id,method,state,terms,revision,activated_at) values
 ('f0dd0000-0000-4000-8000-0000000000a1','f0dd0000-0000-4000-8000-0000000000f1','quick','active',
  '{"contactName":"합성 퀵 담당","contactPhone":"02-0000-0000","handoffLocation":"TEST 인계 장소","handoffInstructions":"TEST 인계 안내","appointmentInstructions":"TEST 예약 안내","allowDelegate":false,"completionInstructions":"TEST 완료 기준","cancellationInstructions":"TEST 취소 안내","approvalReference":"TEST 승인"}',1,now()),
 ('f0dd0000-0000-4000-8000-0000000000a2','f0dd0000-0000-4000-8000-0000000000f1','pickup','active',
  '{"contactName":"합성 방문 담당","contactPhone":"02-0000-0001","handoffLocation":"TEST 방문 장소","handoffInstructions":"TEST 방문 안내","appointmentInstructions":"TEST 방문 예약","allowDelegate":false,"completionInstructions":"TEST 수령 기준","cancellationInstructions":"TEST 취소 안내","approvalReference":"TEST 승인"}',1,now());
create function pg_temp.order_with(n integer,status public.order_status,shipment_status text default 'ready') returns uuid language plpgsql as $$
declare oid uuid:=('f0dd0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=('f0dd0000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,'f0dd0000-0000-4000-8000-000000000002',status,10000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',case when status<>'paid' then now() end);
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'forced-delivery-goods',1,10000,'TEST 강제 배송완료 굿즈','문구','forced-delivery-ip',(select id from public.goods_variants where good_id='forced-delivery-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at)
  values(sid,oid,'f0dd0000-0000-4000-8000-0000000000f1','TEST 강제 배송완료 창고',0,'{}',shipment_status,
   case when shipment_status='shipping' then 'hanjin' end,case when shipment_status='shipping' then 'FORCEDTEST'||n end,case when shipment_status='shipping' then now() end);
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values('f0dd0000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk-forced-delivery-'||n,'idem-forced-delivery-'||n);
 return oid;
end $$;
-- 디지털 파일 배송 건(구매자 내려받기로만 제공 시작). 결제 경로 없이 만들려고 이 트랜잭션에서만 가드를 끈다.
create function pg_temp.add_digital_shipment(target uuid,n integer) returns uuid language plpgsql as $$
declare sid uuid:=('f0dd0000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid;begin
 alter table public.order_shipments disable trigger shipment_delivery_method_guard;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,fulfillment_partition,delivery_method,delivery_method_snapshot,delivery_selection_id)
  values(sid,target,'f0dd0000-0000-4000-8000-0000000000f1','TEST 강제 배송완료 창고',0,'{}','ready','digital','digital','{"version":2,"confirmationRule":"protected_download"}',gen_random_uuid());
 alter table public.order_shipments enable trigger shipment_delivery_method_guard;
 return sid;
end $$;
select pg_temp.order_with(1,'confirmed') as ready_order \gset
select order_number as ready_number from public.orders where id=:'ready_order' \gset
update public.order_shipments set exported_at=now() where order_id=:'ready_order';
select pg_temp.order_with(2,'paid') as paid_order \gset
select order_number as paid_number from public.orders where id=:'paid_order' \gset
select pg_temp.order_with(3,'shipping','shipping') as shipping_order \gset
select order_number as shipping_number from public.orders where id=:'shipping_order' \gset
select pg_temp.order_with(6,'confirmed') as claimed_order \gset
select order_number as claimed_number from public.orders where id=:'claimed_order' \gset
insert into public.order_cancellation_requests(order_id,requested_by,reason,status) values(:'claimed_order','f0dd0000-0000-4000-8000-000000000002','TEST 취소 요청','requested');
select pg_temp.order_with(7,'confirmed') as quick_order \gset
select order_number as quick_number from public.orders where id=:'quick_order' \gset
select pg_temp.order_with(8,'confirmed') as pickup_order \gset
select order_number as pickup_number from public.orders where id=:'pickup_order' \gset
select pg_temp.order_with(9,'confirmed') as mixed_order \gset
select order_number as mixed_number from public.orders where id=:'mixed_order' \gset
select pg_temp.add_digital_shipment(:'mixed_order',9) as mixed_digital \gset
select pg_temp.order_with(10,'confirmed') as digital_order \gset
select order_number as digital_number from public.orders where id=:'digital_order' \gset
delete from public.order_shipment_items where order_id=:'digital_order';
delete from public.order_shipments where order_id=:'digital_order';
select pg_temp.add_digital_shipment(:'digital_order',10) as only_digital \gset
-- 취소된 주문(QA1 S-T04-05): 옮길 배송 건이 없고 이미 끝난 주문이라 '발주확인 먼저'가 아니라 '처리할 배송 건 없음'으로 막는다.
select pg_temp.order_with(11,'confirmed') as canceled_order \gset
select order_number as canceled_number from public.orders where id=:'canceled_order' \gset
set local session_replication_role=replica;
update public.order_shipments set status='canceled' where order_id=:'canceled_order';
update public.orders set status='canceled' where id=:'canceled_order';
set local session_replication_role=origin;

-- 운영과 같은 모양: 스테이징 허용 행이 없어도 강제 배송완료는 열려 있다.
delete from private.staging_test_tools;

select pg_temp.as_actor('f0dd0000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_force_order_delivery_preview(%L)',:'ready_number'),'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number','TEST 사유'),'operator_capability_required');
reset role;

select pg_temp.as_actor('f0dd0000-0000-4000-8000-000000000001');
set local role authenticated;
-- 택배 외 배송 건을 만든다(발송처리 화면의 방법 적용, 인계 전). 퀵·방문수령 모두 운송장·수령 확인값이 없다.
select public.admin_dispatch_apply_delivery((select jsonb_agg(jsonb_build_object('shipmentId',id,'updatedAt',updated_at)) from public.order_shipments where order_id=:'quick_order'),
 'quick','TEST 퀵 요청',null,gen_random_uuid())->>'changed' as quick_changed \gset
select public.admin_dispatch_apply_delivery((select jsonb_agg(jsonb_build_object('shipmentId',id,'updatedAt',updated_at)) from public.order_shipments where order_id=:'pickup_order'),
 'pickup','TEST 방문 요청',null,gen_random_uuid())->>'changed' as pickup_changed \gset
select 1/case when :'quick_changed'='1' and :'pickup_changed'='1' then 1 else 0 end as assert_non_parcel_fixture;
reset role;
-- 가드는 강제 증거 없이 택배 외 배송 건을 배송완료로 옮기지 못한다(일회 수령 확인값 계약 유지).
select pg_temp.expect_error(format('update public.order_shipments set status=%L,delivered_at=now(),shipped_at=now() where order_id=%L',
 'delivered',:'pickup_order'),'delivery_method_evidence_required');
select pg_temp.as_actor('f0dd0000-0000-4000-8000-000000000001');
set local role authenticated;

-- 확인창 미리보기: 대상·출고지시 전달 여부와 막는 사유만 읽고 아무것도 바꾸지 않는다.
select public.admin_force_order_delivery_preview(:'ready_number') as preview \gset
select 1/case when :'preview'::jsonb->'blockers'='[]'::jsonb and (:'preview'::jsonb->>'orderCount')='1'
 and jsonb_array_length(:'preview'::jsonb->'shipments')=1 and :'preview'::jsonb#>>'{shipments,0,status}'='ready'
 and :'preview'::jsonb#>>'{shipments,0,exportedAt}' is not null and :'preview'::jsonb#>>'{shipments,0,method}'='parcel'
 and :'preview'::jsonb->>'buyerName'='TEST 강제 배송완료 2' and :'preview'::jsonb->>'firstItemName'='TEST 강제 배송완료 굿즈'
 and (select status='confirmed' from public.orders where id=:'ready_order') then 1 else 0 end as assert_preview_reads_only;
select 1/case when public.admin_force_order_delivery_preview(:'paid_number')->'blockers'='["requires_confirmed"]'::jsonb
 and public.admin_force_order_delivery_preview(:'claimed_number')->'blockers'='["claim_in_progress"]'::jsonb
 and public.admin_force_order_delivery_preview(:'canceled_number')->'blockers'='["nothing_to_deliver"]'::jsonb
 and public.admin_force_order_delivery_preview(:'quick_number')->'blockers'='[]'::jsonb
 and public.admin_force_order_delivery_preview(:'quick_number')#>>'{shipments,0,method}'='quick'
 and public.admin_force_order_delivery_preview(:'digital_number')->'blockers'='["digital_access_only"]'::jsonb
 and public.admin_force_order_delivery_preview(:'mixed_number')->'blockers'='[]'::jsonb
 and jsonb_array_length(public.admin_force_order_delivery_preview(:'mixed_number')->'shipments')=2
 then 1 else 0 end as assert_preview_blockers;
select pg_temp.expect_error($$select public.admin_force_order_delivery_preview('2031031419999999')$$,'forced_delivery_order_not_found');
select pg_temp.expect_error($$select public.admin_force_order_delivery_preview('not-a-number')$$,'invalid_forced_delivery');

-- 사유는 필수다. 상태·클레임·디지털 예외는 실행 때 다시 막는다.
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number','   '),'forced_delivery_reason_required');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number',repeat('가',501)),'forced_delivery_reason_required');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'paid_number','TEST 사유'),'forced_delivery_requires_confirmed');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'claimed_number','TEST 사유'),'order cancellation in progress');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'digital_number','TEST 사유'),'forced_delivery_digital_access_only');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'canceled_number','TEST 사유'),'forced_delivery_nothing_to_deliver');

select public.admin_force_order_delivered(:'ready_number','구매확정·리뷰 시험 주문','f0dd0000-0000-4000-8000-0000000000c1') as delivered \gset
select 1/case when public.admin_force_order_delivered(:'ready_number','구매확정·리뷰 시험 주문','f0dd0000-0000-4000-8000-0000000000c1')=:'delivered'::jsonb
 and (:'delivered'::jsonb->>'status')='delivered' and (:'delivered'::jsonb->>'deliveredShipments')='1' and (:'delivered'::jsonb->>'orderCount')='1'
 then 1 else 0 end as assert_delivered_and_replay;
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,%L)',:'ready_number','다른 사유','f0dd0000-0000-4000-8000-0000000000c1'),'operation_conflict');
select public.admin_force_order_delivered(:'shipping_number','배송 조회가 끊긴 주문',gen_random_uuid());
select public.admin_force_order_delivered(:'quick_number','퀵 인계 기록을 놓친 시험 주문','f0dd0000-0000-4000-8000-0000000000c2') as quick_delivered \gset
select public.admin_force_order_delivered(:'pickup_number','방문수령 시험 주문',gen_random_uuid()) as pickup_delivered \gset
select public.admin_force_order_delivered(:'mixed_number','디지털이 섞인 시험 주문',gen_random_uuid()) as mixed_delivered \gset
-- 이미 배송완료한 주문을 다시 고르면 '처리할 배송 건 없음'이다(신규주문의 '발주확인 먼저'와 가른다).
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number','TEST 사유'),'forced_delivery_nothing_to_deliver');
select 1/case when public.admin_force_order_delivery_preview(:'ready_number')->'blockers'='["nothing_to_deliver"]'::jsonb
 and public.admin_force_order_delivery_preview(:'paid_number')->'blockers'='["requires_confirmed"]'::jsonb
 then 1 else 0 end as assert_finished_order_reason;
reset role;
select 1/case when (select status='delivered' and delivered_at is not null and shipped_at is not null from public.orders where id=:'ready_order')
 and (select bool_and(status='delivered' and carrier is null and tracking_number is null and delivered_at is not null) from public.order_shipments where order_id=:'ready_order')
 and (select status='delivered' and tracking_number='FORCEDTEST3' from public.order_shipments where order_id=:'shipping_order')
 and not exists(select 1 from public.order_shipment_email_jobs where order_id in(:'ready_order',:'shipping_order',:'quick_order',:'pickup_order',:'mixed_order'))
 and (select count(*)=2 from private.order_purchase_confirmations where order_id in(:'ready_order',:'shipping_order'))
 and exists(select 1 from public.notifications where user_id='f0dd0000-0000-4000-8000-000000000002' and type='order_delivered' and source_id=:'ready_order')
 and (select count(*)=1 from public.audit_log where id='f0dd0000-0000-4000-8000-0000000000c1' and action='admin.order.forced_delivered'
  and target='order:'||:'ready_order' and actor_id='f0dd0000-0000-4000-8000-000000000001' and diff->>'forced'='true'
  and diff->>'reason'='구매확정·리뷰 시험 주문' and diff#>>'{request,reason}'='구매확정·리뷰 시험 주문')
 and (select status='paid' from public.orders where id=:'paid_order')
 then 1 else 0 end as assert_production_shape_delivers_without_email;
-- 택배 외 배송 건은 강제 증거로 배송완료되고 주문도 배송완료·구매확정 기한을 받는다.
select 1/case when (select status='delivered' and delivery_method='quick' and carrier is null and shipped_at=delivered_at from public.order_shipments where order_id=:'quick_order')
 and (select status='delivered' from public.orders where id=:'quick_order')
 and (select status='delivered' from public.orders where id=:'pickup_order')
 and exists(select 1 from private.shipment_delivery_operations op join public.order_shipments s on s.delivery_event_id=op.id
  where s.order_id=:'quick_order' and op.kind='forced_delivered' and op.evidence->>'reason'='퀵 인계 기록을 놓친 시험 주문'
   and op.evidence->>'operationId'='f0dd0000-0000-4000-8000-0000000000c2' and (op.evidence->>'occurredAt')::timestamptz=s.delivered_at)
 and exists(select 1 from private.shipment_delivery_operations op join public.order_shipments s on s.delivery_event_id=op.id
  where s.order_id=:'pickup_order' and op.kind='forced_delivered' and op.evidence->>'method'='pickup')
 and (select count(*)=2 from private.order_purchase_confirmations where order_id in(:'quick_order',:'pickup_order'))
 and (:'quick_delivered'::jsonb->>'deliveredShipments')='1' and (:'pickup_delivered'::jsonb->>'deliveredShipments')='1'
 then 1 else 0 end as assert_non_parcel_forced_delivered;
-- 디지털 파일 배송 건은 남기고 나머지만 옮긴다.
select 1/case when (:'mixed_delivered'::jsonb->>'deliveredShipments')='1'
 and (select status='ready' from public.order_shipments where id=:'mixed_digital')
 and (select status='delivered' from public.order_shipments where order_id=:'mixed_order' and delivery_method='parcel')
 and (select status='ready' from public.order_shipments where id=:'only_digital')
 then 1 else 0 end as assert_digital_left_for_buyer_download;

-- 합포장 소속 배송 건은 운영 배송완료와 같이 묶음 전체를 함께 옮기고, 함께 옮긴 주문에도 사유를 남긴다.
select pg_temp.order_with(4,'confirmed') as packed_one \gset
select order_number as packed_one_number from public.orders where id=:'packed_one' \gset
select pg_temp.order_with(5,'confirmed') as packed_two \gset
insert into private.shipment_packs(id,created_by) values('f0dd0000-0000-4000-8000-0000000000b1','f0dd0000-0000-4000-8000-000000000001');
insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest)
 select 'f0dd0000-0000-4000-8000-0000000000b1',id,'TEST' from public.order_shipments where order_id in(:'packed_one',:'packed_two');
select pg_temp.as_actor('f0dd0000-0000-4000-8000-000000000001');
set local role authenticated;
select 1/case when (public.admin_force_order_delivery_preview(:'packed_one_number')->>'orderCount')='2'
 and jsonb_array_length(public.admin_force_order_delivery_preview(:'packed_one_number')->'shipments')=2 then 1 else 0 end as assert_preview_shows_pack;
select public.admin_force_order_delivered(:'packed_one_number','합포장 시험',gen_random_uuid()) as packed \gset
reset role;
select 1/case when (:'packed'::jsonb->>'orderCount')='2' and (:'packed'::jsonb->>'deliveredShipments')='2'
 and (select count(*)=2 from public.orders where id in(:'packed_one',:'packed_two') and status='delivered')
 and not exists(select 1 from public.order_shipment_email_jobs where order_id in(:'packed_one',:'packed_two'))
 and exists(select 1 from public.audit_log where action='admin.order.forced_delivered' and target='order:'||:'packed_two'
  and diff->>'viaPackOf'=:'packed_one' and diff->>'reason'='합포장 시험')
 then 1 else 0 end as assert_pack_moves_together;
rollback;
