\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 발송처리 화면의 배송 방법 선택·택배 외 일괄 발송(인계) (S36-072·S36-X04)
--
--   · 권한: 출고 권한(sales.dispatch — 물류출고관리, sales.manage가 포함)만, anon·service_role 실행 불가
--     (통합 migration 20261112200000이 private.dispatch_console_capability()를 sales.dispatch로 바꿨다)
--   · 그 출고지에서 켜진 운영 조건의 방법만 고를 수 있고, 고객이 고른 방법과 다르면 사유가 필수다
--   · 출고지시 전달·운송장·합포장·진행 중 클레임 건은 방법을 바꾸지 않는다(행별 결과, 나머지는 처리)
--   · 퀵·직접배송·화물배송은 인계 근거까지 한 번에 남겨 배송 중이 되고, 택배 발송 메일은 만들지 않는다
--   · 배송비·결제 금액은 그대로이고, 같은 요청 번호는 같은 결과를 돌려준다
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_dispatch_delivery_options(uuid[])','execute')
  and not has_function_privilege('anon','public.admin_dispatch_delivery_options(uuid[])','execute')
  and not has_function_privilege('service_role','public.admin_dispatch_delivery_options(uuid[])','execute')
  and has_function_privilege('authenticated','public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid)','execute')
) then 1 else 0 end as assert_sealed_acl;

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('d15a0000-0000-4000-8000-000000000001','authenticated','authenticated','dispatch-console-operator@example.test',now(),'{}','{}',now(),now()),
 ('d15a0000-0000-4000-8000-000000000002','authenticated','authenticated','dispatch-console-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 발송처리 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='d15a0000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('d15a0000-0000-4000-8000-000000000001','d15a0000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('d15a0000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;
insert into public.ips(id,title,vertical_key) values('dispatch-console-ip','TEST 발송처리 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('dispatch-console-goods','dispatch-console-ip','TEST 발송처리 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values
 ('d15a0000-0000-4000-8000-0000000000f1','dispatch-console-quick','TEST 퀵·방문 출고지',0,'합성 반송 주소',true),
 ('d15a0000-0000-4000-8000-0000000000f2','dispatch-console-parcel','TEST 택배 전용 출고지',0,'합성 반송 주소',true);
-- 첫 출고지에만 퀵·방문수령 운영 조건이 켜져 있다(초안 직접배송은 고를 수 없다).
insert into private.fulfillment_delivery_policies(id,origin_id,method,state,terms,revision,activated_at) values
 ('d15a0000-0000-4000-8000-0000000000a1','d15a0000-0000-4000-8000-0000000000f1','quick','active',
  '{"contactName":"합성 퀵 담당","contactPhone":"02-0000-0000","handoffLocation":"TEST 인계 장소","handoffInstructions":"TEST 인계 안내","appointmentInstructions":"TEST 예약 안내","allowDelegate":false,"completionInstructions":"TEST 완료 기준","cancellationInstructions":"TEST 취소 안내","approvalReference":"TEST 승인"}',1,now()),
 ('d15a0000-0000-4000-8000-0000000000a2','d15a0000-0000-4000-8000-0000000000f1','pickup','active',
  '{"contactName":"합성 방문 담당","contactPhone":"02-0000-0001","handoffLocation":"TEST 방문 장소","handoffInstructions":"TEST 방문 안내","appointmentInstructions":"TEST 방문 예약","allowDelegate":true,"completionInstructions":"TEST 수령 기준","cancellationInstructions":"TEST 취소 안내","approvalReference":"TEST 승인"}',1,now()),
 ('d15a0000-0000-4000-8000-0000000000a3','d15a0000-0000-4000-8000-0000000000f1','direct','draft',
  '{"contactName":null,"contactPhone":null,"handoffLocation":null,"handoffInstructions":null,"appointmentInstructions":null,"allowDelegate":null,"completionInstructions":null,"cancellationInstructions":null,"approvalReference":null}',1,null);
create function pg_temp.order_with(n integer,status public.order_status,origin uuid default 'd15a0000-0000-4000-8000-0000000000f1') returns uuid language plpgsql as $$
declare oid uuid:=('d15a0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=('d15a0000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at) values(oid,'d15a0000-0000-4000-8000-000000000002',status,13000,3000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',case when status<>'paid' then now() end);
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'dispatch-console-goods',1,10000,'TEST 발송처리 굿즈','문구','dispatch-console-ip',(select id from public.goods_variants where good_id='dispatch-console-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status)
  values(sid,oid,origin,'TEST 출고지',3000,'{}','ready');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 return sid;
end $$;
select pg_temp.order_with(1,'confirmed') as quick_shipment \gset
select pg_temp.order_with(2,'paid') as pickup_shipment \gset
select pg_temp.order_with(3,'confirmed') as exported_shipment \gset
update public.order_shipments set exported_at=now() where id=:'exported_shipment';
select pg_temp.order_with(4,'confirmed') as packed_shipment \gset
insert into private.shipment_packs(id,created_by) values('d15a0000-0000-4000-8000-0000000000b1','d15a0000-0000-4000-8000-000000000001');
insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest) values('d15a0000-0000-4000-8000-0000000000b1',:'packed_shipment','TEST');
select pg_temp.order_with(5,'confirmed','d15a0000-0000-4000-8000-0000000000f2') as parcel_only_shipment \gset
select pg_temp.order_with(6,'confirmed') as claimed_shipment \gset
insert into public.order_cancellation_requests(order_id,requested_by,reason,status)
 select order_id,'d15a0000-0000-4000-8000-000000000002','TEST 취소 요청','requested' from public.order_shipments where id=:'claimed_shipment';
select pg_temp.order_with(7,'confirmed') as stale_shipment \gset
create function pg_temp.targets(variadic ids uuid[]) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('shipmentId',s.id,'updatedAt',s.updated_at) order by s.id) from public.order_shipments s where s.id=any(ids);
$$;
create function pg_temp.handoff() returns jsonb language sql as $$
 select jsonb_build_object('operatorName','TEST 출고 담당','providerName','TEST 퀵 업체','providerPhone','02-1234-5678',
  'handoffReference','TEST 인계 확인 메모','occurredAt',to_jsonb(clock_timestamp())#>>'{}');
$$;
grant execute on function pg_temp.targets(uuid[]),pg_temp.handoff() to authenticated;
select jsonb_build_object('total',total,'shippingFee',shipping_fee) as money_before from public.orders where id='d15a0000-0000-4001-8000-000000000001' \gset

-- 구매자(운영자 아님)는 읽기·쓰기 모두 막힌다.
select pg_temp.as_actor('d15a0000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_dispatch_delivery_options(array[%L]::uuid[])',:'quick_shipment'),'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_dispatch_apply_delivery(pg_temp.targets(%L),%L,null,null,gen_random_uuid())',:'quick_shipment','quick'),'operator_capability_required');
reset role;

select pg_temp.as_actor('d15a0000-0000-4000-8000-000000000001');
set local role authenticated;
-- 고른 건의 고객 선택 방법과 처리 가능 여부, 그 출고지의 켜진 운영 조건만 돌려준다.
select public.admin_dispatch_delivery_options(array[:'quick_shipment',:'pickup_shipment',:'exported_shipment',:'packed_shipment',:'parcel_only_shipment',:'claimed_shipment']::uuid[]) as options \gset
select 1/case when jsonb_array_length(:'options'::jsonb->'shipments')=6
 and (select bool_and(value->>'customerMethod'='parcel' and value->>'method'='parcel') from jsonb_array_elements(:'options'::jsonb->'shipments'))
 and (select (value->>'canSelect')::boolean and (value->>'canHandoff')::boolean from jsonb_array_elements(:'options'::jsonb->'shipments') where value->>'id'=:'quick_shipment')
 and (select (value->>'canSelect')::boolean and not (value->>'canHandoff')::boolean from jsonb_array_elements(:'options'::jsonb->'shipments') where value->>'id'=:'pickup_shipment')
 and (select not (value->>'canSelect')::boolean from jsonb_array_elements(:'options'::jsonb->'shipments') where value->>'id'=:'exported_shipment')
 and (select not (value->>'canSelect')::boolean and (value->>'packed')::boolean from jsonb_array_elements(:'options'::jsonb->'shipments') where value->>'id'=:'packed_shipment')
 and (select not (value->>'canSelect')::boolean and (value->>'claimOpen')::boolean from jsonb_array_elements(:'options'::jsonb->'shipments') where value->>'id'=:'claimed_shipment')
 and (select array_agg(value->>'method' order by value->>'method') from jsonb_array_elements(:'options'::jsonb->'policies'))=array['pickup','quick']
 and not (:'options'::jsonb::text like '%TEST 승인%')
 then 1 else 0 end as assert_options_shape;
select pg_temp.expect_error('select public.admin_dispatch_delivery_options(array[]::uuid[])','invalid_dispatch_delivery_request');

-- 입력 형식: 방법·대상·인계 방법 조합을 검사한다.
select pg_temp.expect_error(format('select public.admin_dispatch_apply_delivery(pg_temp.targets(%L),%L,null,null,gen_random_uuid())',:'quick_shipment','none'),'invalid_dispatch_delivery_request');
select pg_temp.expect_error(format('select public.admin_dispatch_apply_delivery(%L::jsonb,%L,null,null,gen_random_uuid())','[{"shipmentId":"x","updatedAt":"y"}]','quick'),'invalid_dispatch_delivery_request');
select pg_temp.expect_error(format('select public.admin_dispatch_apply_delivery(pg_temp.targets(%L),%L,%L,pg_temp.handoff(),gen_random_uuid())',:'pickup_shipment','pickup','TEST 사유'),'invalid_dispatch_delivery_request');
select pg_temp.expect_error(format('select public.admin_dispatch_apply_delivery(pg_temp.targets(%L),%L,%L,%L::jsonb,gen_random_uuid())',:'quick_shipment','quick','TEST 사유','{"operatorName":"TEST"}'),'invalid_delivery_evidence');

-- 고객이 택배를 골랐으므로 퀵은 사유가 필요하다. 사유 없이 보낸 건은 그 행만 실패한다.
select public.admin_dispatch_apply_delivery(pg_temp.targets(:'quick_shipment'),'quick',null,pg_temp.handoff(),gen_random_uuid()) as no_reason \gset
select 1/case when (:'no_reason'::jsonb->>'failed')='1' and :'no_reason'::jsonb#>>'{results,0,error}'='dispatch_method_reason_required'
 and (select delivery_method='parcel' and status='ready' from public.order_shipments where id=:'quick_shipment') then 1 else 0 end as assert_reason_required;

-- 퀵 적용 + 인계 기록을 한 번에: 배송 중이 되고, 같은 요청 번호는 같은 결과를 돌려준다.
select pg_temp.targets(:'quick_shipment',:'exported_shipment',:'packed_shipment',:'parcel_only_shipment',:'claimed_shipment') as batch_targets \gset
select pg_temp.handoff() as batch_handoff \gset
select public.admin_dispatch_apply_delivery(:'batch_targets'::jsonb,'quick','고객 전화 요청 · 근거리 퀵 발송',:'batch_handoff'::jsonb,'d15a0000-0000-4000-8000-0000000000c1') as applied \gset
select 1/case when (:'applied'::jsonb->>'changed')='1' and (:'applied'::jsonb->>'handedOff')='1' and (:'applied'::jsonb->>'failed')='4'
 and (:'applied'::jsonb->>'replayed')='false'
 and (select value->>'error' from jsonb_array_elements(:'applied'::jsonb->'results') where value->>'shipmentId'=:'exported_shipment')='delivery_method_selection_unavailable'
 and (select value->>'error' from jsonb_array_elements(:'applied'::jsonb->'results') where value->>'shipmentId'=:'packed_shipment')='shipment_pack_method_locked'
 and (select value->>'error' from jsonb_array_elements(:'applied'::jsonb->'results') where value->>'shipmentId'=:'parcel_only_shipment')='delivery_policy_unavailable'
 and (select value->>'error' from jsonb_array_elements(:'applied'::jsonb->'results') where value->>'shipmentId'=:'claimed_shipment')='order cancellation in progress'
 and (select (value->>'methodChanged')::boolean and (value->>'handedOff')::boolean from jsonb_array_elements(:'applied'::jsonb->'results') where value->>'shipmentId'=:'quick_shipment')
 then 1 else 0 end as assert_row_results;
select 1/case when public.admin_dispatch_apply_delivery(:'batch_targets'::jsonb,'quick','고객 전화 요청 · 근거리 퀵 발송',:'batch_handoff'::jsonb,'d15a0000-0000-4000-8000-0000000000c1')
  =(:'applied'::jsonb||'{"replayed":true}') then 1 else 0 end as assert_replay;
select pg_temp.expect_error(format('select public.admin_dispatch_apply_delivery(%L::jsonb,%L,%L,%L::jsonb,%L)',:'batch_targets','quick','다른 사유',:'batch_handoff','d15a0000-0000-4000-8000-0000000000c1'),'operation_conflict');
reset role;
select 1/case when (select status='shipping' and delivery_method='quick' and delivery_policy_id='d15a0000-0000-4000-8000-0000000000a1'
   and fulfillment_partition='parcel' and carrier is null and tracking_number is null and shipped_at is not null
   and delivery_method_snapshot->>'feeRule'='order_fee_unchanged' and not delivery_method_snapshot ? 'approvalReference'
  from public.order_shipments where id=:'quick_shipment')
 and (select status='shipping' from public.orders where id='d15a0000-0000-4001-8000-000000000001')
 and (select jsonb_build_object('total',total,'shippingFee',shipping_fee) from public.orders where id='d15a0000-0000-4001-8000-000000000001')=:'money_before'::jsonb
 and (select count(*)=2 from private.shipment_delivery_operations where shipment_id=:'quick_shipment')
 and exists(select 1 from private.shipment_delivery_operations where shipment_id=:'quick_shipment' and kind='method_selected'
  and evidence->>'fromMethod'='parcel' and evidence->>'toMethod'='quick' and evidence->>'customerMethod'='parcel'
  and evidence->>'dispatchReason'='고객 전화 요청 · 근거리 퀵 발송' and evidence->>'source'='dispatch_console')
 and exists(select 1 from private.shipment_delivery_operations where shipment_id=:'quick_shipment' and kind='quick_handoff'
  and evidence->>'providerName'='TEST 퀵 업체' and evidence->>'source'='dispatch_console')
 and not exists(select 1 from public.order_shipment_email_jobs where shipment_id=:'quick_shipment')
 and (select delivery_method='parcel' and exported_at is not null from public.order_shipments where id=:'exported_shipment')
 and (select count(*)=1 from public.audit_log where id='d15a0000-0000-4000-8000-0000000000c1' and action='admin.shipment.dispatch_delivery_applied'
  and actor_id='d15a0000-0000-4000-8000-000000000001' and diff#>>'{request,reason}'='고객 전화 요청 · 근거리 퀵 발송')
 and exists(select 1 from public.audit_log where target='order:d15a0000-0000-4001-8000-000000000001' and action='admin.shipment.delivery_method_selected'
  and diff->>'reason'='고객 전화 요청 · 근거리 퀵 발송' and diff->>'customerMethod'='parcel')
 and exists(select 1 from public.audit_log where target='order:d15a0000-0000-4001-8000-000000000001' and action='admin.shipment.delivery_evidence_recorded'
  and diff->>'kind'='quick_handoff')
 then 1 else 0 end as assert_quick_dispatched_without_money_change;
-- QA 라운드 1 m3·m4: 배송 방식 요약이 고객이 고른 방식과 마지막 방식 변경의 출처를 싣는다(발송처리 화면 = 판매자).
-- 주문 상세의 고객 요청 경로(고객 요청 근거가 있는 변경 기록)는 'customer', 변경 기록이 없으면 null이다.
select 1/case when private.shipment_delivery_summary(:'quick_shipment')->>'method'='quick'
 and private.shipment_delivery_summary(:'quick_shipment')->>'customerMethod'='parcel'
 and private.shipment_delivery_summary(:'quick_shipment')->>'changedBy'='store'
 and private.shipment_delivery_summary(:'exported_shipment')->>'customerMethod'='parcel'
 and private.shipment_delivery_summary(:'exported_shipment')->'changedBy'='null'::jsonb
 then 1 else 0 end as assert_summary_change_source;
insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
values(gen_random_uuid(),:'stale_shipment','method_selected','d15a0000-0000-4000-8000-000000000001','\x00',
 jsonb_build_object('fromMethod','parcel','toMethod','parcel','customerRequestReference','TEST 고객 요청 근거','feeConsentReference','TEST 배송비 동의'));
select 1/case when private.shipment_delivery_summary(:'stale_shipment')->>'changedBy'='customer' then 1 else 0 end as assert_summary_customer_change;
delete from private.shipment_delivery_operations where shipment_id=:'stale_shipment' and evidence ? 'customerRequestReference';

-- 결제완료(발주확인 전) 주문은 방법만 바꾸고 인계는 막는다. 방문수령은 인계 없이 적용만 한다.
select pg_temp.as_actor('d15a0000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_dispatch_apply_delivery(pg_temp.targets(:'pickup_shipment'),'pickup','고객 방문 수령 요청',null,gen_random_uuid()) as pickup \gset
select 1/case when (:'pickup'::jsonb->>'changed')='1' and (:'pickup'::jsonb->>'handedOff')='0' then 1 else 0 end as assert_pickup_applied;
-- 고객이 고른 택배로 되돌릴 때는 사유가 없어도 된다.
select public.admin_dispatch_apply_delivery(pg_temp.targets(:'pickup_shipment'),'parcel',null,null,gen_random_uuid()) as back_to_parcel \gset
select 1/case when (:'back_to_parcel'::jsonb->>'changed')='1' then 1 else 0 end as assert_back_to_customer_method_without_reason;
-- 같은 방법이고 인계도 없으면 바꿀 것이 없다.
select public.admin_dispatch_apply_delivery(pg_temp.targets(:'pickup_shipment'),'parcel',null,null,gen_random_uuid()) as unchanged \gset
select 1/case when :'unchanged'::jsonb#>>'{results,0,error}'='dispatch_delivery_unchanged' then 1 else 0 end as assert_unchanged_reported;
select public.admin_dispatch_apply_delivery(pg_temp.targets(:'pickup_shipment'),'quick','TEST 퀵 요청',pg_temp.handoff(),gen_random_uuid()) as paid_handoff \gset
select 1/case when :'paid_handoff'::jsonb#>>'{results,0,error}'='delivery_method_evidence_required'
 and (select delivery_method='parcel' and status='ready' from public.order_shipments where id=:'pickup_shipment') then 1 else 0 end as assert_paid_handoff_rolled_back;
-- 화면을 연 뒤 다른 처리가 먼저 끝났으면 그 건은 바꾸지 않는다.
select pg_temp.targets(:'stale_shipment') as stale_targets \gset
reset role;
update public.order_shipments set updated_at=clock_timestamp() where id=:'stale_shipment';
select pg_temp.as_actor('d15a0000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_dispatch_apply_delivery(:'stale_targets'::jsonb,'quick','TEST 사유',null,gen_random_uuid()) as stale \gset
select 1/case when :'stale'::jsonb#>>'{results,0,error}'='shipment_delivery_changed' then 1 else 0 end as assert_stale_version_rejected;
reset role;
select 1/case when (select delivery_method='parcel' and status='ready' from public.order_shipments where id=:'stale_shipment')
 and (select count(*)=2 from private.shipment_delivery_operations where shipment_id=:'pickup_shipment')
 then 1 else 0 end as assert_history_kept;
rollback;
