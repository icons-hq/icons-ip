\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 운영 강제 배송완료 (1014-083, ADR-0025 보완)
--
--   · 스테이징 허용 행이 없는 DB(운영과 같은 모양)에서도 배송 처리 권한(sales.manage)이면 실행한다
--   · 사유 필수, 확인창용 미리보기는 대상·막는 사유만 읽고 바꾸지 않는다
--   · 발주확인 이후 택배 주문의 남은 배송 건만 운송장 없이 배송완료로 옮기고 발송 메일을 만들지 않는다
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
  '{"contactName":"합성 퀵 담당","contactPhone":"02-0000-0000","handoffLocation":"TEST 인계 장소","handoffInstructions":"TEST 인계 안내","appointmentInstructions":"TEST 예약 안내","allowDelegate":false,"completionInstructions":"TEST 완료 기준","cancellationInstructions":"TEST 취소 안내","approvalReference":"TEST 승인"}',1,now());
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
select pg_temp.order_with(1,'confirmed') as ready_order \gset
select order_number as ready_number from public.orders where id=:'ready_order' \gset
select pg_temp.order_with(2,'paid') as paid_order \gset
select order_number as paid_number from public.orders where id=:'paid_order' \gset
select pg_temp.order_with(3,'shipping','shipping') as shipping_order \gset
select order_number as shipping_number from public.orders where id=:'shipping_order' \gset
select pg_temp.order_with(6,'confirmed') as claimed_order \gset
select order_number as claimed_number from public.orders where id=:'claimed_order' \gset
insert into public.order_cancellation_requests(order_id,requested_by,reason,status) values(:'claimed_order','f0dd0000-0000-4000-8000-000000000002','TEST 취소 요청','requested');
select pg_temp.order_with(7,'confirmed') as quick_order \gset
select order_number as quick_number from public.orders where id=:'quick_order' \gset

-- 운영과 같은 모양: 스테이징 허용 행이 없어도 강제 배송완료는 열려 있다.
delete from private.staging_test_tools;

select pg_temp.as_actor('f0dd0000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_force_order_delivery_preview(%L)',:'ready_number'),'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number','TEST 사유'),'operator_capability_required');
reset role;

select pg_temp.as_actor('f0dd0000-0000-4000-8000-000000000001');
set local role authenticated;
-- 택배 외 배송 건을 하나 만든다(발송처리 화면의 방법 적용, 인계 전).
select public.admin_dispatch_apply_delivery((select jsonb_agg(jsonb_build_object('shipmentId',id,'updatedAt',updated_at)) from public.order_shipments where order_id=:'quick_order'),
 'quick','TEST 퀵 요청',null,gen_random_uuid())->>'changed' as quick_changed \gset
select 1/case when :'quick_changed'='1' then 1 else 0 end as assert_quick_fixture;

-- 확인창 미리보기: 대상과 막는 사유만 읽고 아무것도 바꾸지 않는다.
select public.admin_force_order_delivery_preview(:'ready_number') as preview \gset
select 1/case when :'preview'::jsonb->'blockers'='[]'::jsonb and (:'preview'::jsonb->>'orderCount')='1'
 and jsonb_array_length(:'preview'::jsonb->'shipments')=1 and :'preview'::jsonb#>>'{shipments,0,status}'='ready'
 and :'preview'::jsonb->>'buyerName'='TEST 강제 배송완료 2' and :'preview'::jsonb->>'firstItemName'='TEST 강제 배송완료 굿즈'
 and (select status='confirmed' from public.orders where id=:'ready_order') then 1 else 0 end as assert_preview_reads_only;
select 1/case when public.admin_force_order_delivery_preview(:'paid_number')->'blockers'='["requires_confirmed"]'::jsonb
 and public.admin_force_order_delivery_preview(:'claimed_number')->'blockers'='["claim_in_progress"]'::jsonb
 and public.admin_force_order_delivery_preview(:'quick_number')->'blockers'='["parcel_only"]'::jsonb
 then 1 else 0 end as assert_preview_blockers;
select pg_temp.expect_error($$select public.admin_force_order_delivery_preview('2031031419999999')$$,'forced_delivery_order_not_found');
select pg_temp.expect_error($$select public.admin_force_order_delivery_preview('not-a-number')$$,'invalid_forced_delivery');

-- 사유는 필수다. 상태·클레임·택배 외 조건은 실행 때 다시 막는다.
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number','   '),'forced_delivery_reason_required');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number',repeat('가',501)),'forced_delivery_reason_required');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'paid_number','TEST 사유'),'forced_delivery_requires_confirmed');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'claimed_number','TEST 사유'),'order cancellation in progress');
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'quick_number','TEST 사유'),'forced_delivery_parcel_only');

select public.admin_force_order_delivered(:'ready_number','구매확정·리뷰 시험 주문','f0dd0000-0000-4000-8000-0000000000c1') as delivered \gset
select 1/case when public.admin_force_order_delivered(:'ready_number','구매확정·리뷰 시험 주문','f0dd0000-0000-4000-8000-0000000000c1')=:'delivered'::jsonb
 and (:'delivered'::jsonb->>'status')='delivered' and (:'delivered'::jsonb->>'deliveredShipments')='1' and (:'delivered'::jsonb->>'orderCount')='1'
 then 1 else 0 end as assert_delivered_and_replay;
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,%L)',:'ready_number','다른 사유','f0dd0000-0000-4000-8000-0000000000c1'),'operation_conflict');
select public.admin_force_order_delivered(:'shipping_number','배송 조회가 끊긴 주문',gen_random_uuid());
select pg_temp.expect_error(format('select public.admin_force_order_delivered(%L,%L,gen_random_uuid())',:'ready_number','TEST 사유'),'forced_delivery_requires_confirmed');
reset role;
select 1/case when (select status='delivered' and delivered_at is not null and shipped_at is not null from public.orders where id=:'ready_order')
 and (select bool_and(status='delivered' and carrier is null and tracking_number is null and delivered_at is not null) from public.order_shipments where order_id=:'ready_order')
 and (select status='delivered' and tracking_number='FORCEDTEST3' from public.order_shipments where order_id=:'shipping_order')
 and not exists(select 1 from public.order_shipment_email_jobs where order_id in(:'ready_order',:'shipping_order'))
 and (select count(*)=2 from private.order_purchase_confirmations where order_id in(:'ready_order',:'shipping_order'))
 and (select count(*)=1 from public.audit_log where id='f0dd0000-0000-4000-8000-0000000000c1' and action='admin.order.forced_delivered'
  and target='order:'||:'ready_order' and actor_id='f0dd0000-0000-4000-8000-000000000001' and diff->>'forced'='true'
  and diff->>'reason'='구매확정·리뷰 시험 주문' and diff#>>'{request,reason}'='구매확정·리뷰 시험 주문')
 and (select status='confirmed' from public.orders where id=:'paid_order') is false
 and (select status='paid' from public.orders where id=:'paid_order')
 then 1 else 0 end as assert_production_shape_delivers_without_email;

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
