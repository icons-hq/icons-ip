\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 배송 상태 오처리 정정과 실제 도착 시각 (원장 #14, ADR-0045)
--
--   · 선택 배송완료에 택배사 배송완료 일시를 넣는다: 발송 등록 시각 이후·지금 이전(10분 시계 차이는 지금으로), 처리 시각보다 7일 넘게 이르면
--     판매 관리 권한 + 사유(물류 계정은 7일 이내만). 건별로 실제 기록한 배송 건(arrivalIds)을 돌려준다.
--     주문 배송완료 시각·구매확정 기한·청약철회 기한이 그 시각을 따른다. 옛 일괄 함수(admin_complete_shipments)는 그대로 처리 시각이다.
--   · 배송완료 되돌리기(sales.manage): 배송 중으로, 합포장 묶음 전체. 구매확정·리뷰·클레임(진행·완료)·부분 취소 진행 중·택배 외는 막는다.
--     구매확정 기한 행과 "배송이 완료됐어요"·구매확정 요청 알림을 지우고 다음 배송완료 때 새로 잡는다. 구매확정 보류 중이면 막는다.
--     운송장 없이 강제 배송완료한 건은 발송 대기(주문 발주확인)로 되돌리고 배송 시작 알림을 만들지 않는다. 사유·작업 ID 재전송·화면이 본 시각 대조·감사.
--   · 발송 되돌리기(sales.manage): 발송 대기로, 대표·추가 운송장·발송 시각을 비워 번호를 다른 배송 건에 다시 쓸 수 있다. 출고지시 전달은
--     그대로, 주문은 발주확인으로 돌아간다. 보내지 않은 발송 메일 작업은 지우고(다시 발송하면 새로), 보낸 메일은 남기고 알린다.
--     중복 등록 승인도 지워, 승인으로 등록했던 다른 주문의 번호를 되돌린 뒤 승인 없이 다시 등록할 수 없다(#679).
--   · 택배 추적 자동 배송완료는 되돌린 배송 건을 같은 발송 동안 다시 완료하지 않는다.
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_complete_shipments_at(uuid[],timestamptz,text)','execute')
  and not has_function_privilege('anon','public.admin_complete_shipments_at(uuid[],timestamptz,text)','execute')
  and not has_function_privilege('service_role','public.admin_complete_shipments_at(uuid[],timestamptz,text)','execute')
  and has_function_privilege('authenticated','public.admin_revert_shipment_delivery(uuid,text,uuid,timestamptz)','execute')
  and not has_function_privilege('anon','public.admin_revert_shipment_delivery(uuid,text,uuid,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_revert_shipment_delivery(uuid,text,uuid,timestamptz)','execute')
  and has_function_privilege('authenticated','public.admin_revert_shipment_dispatch(uuid,text,uuid,text)','execute')
  and not has_function_privilege('anon','public.admin_revert_shipment_dispatch(uuid,text,uuid,text)','execute')
  and not has_function_privilege('service_role','public.admin_revert_shipment_dispatch(uuid,text,uuid,text)','execute')
  and not has_function_privilege('authenticated','private.shipment_operator_delivered_at(timestamptz)','execute')
  and not has_function_privilege('authenticated','private.shipment_revert_blocker(uuid,text)','execute')
  and (select capability='sales.dispatch' and guard_kind='write' from private.operator_rpc_contracts where signature='public.admin_complete_shipments_at(uuid[],timestamp with time zone,text)')
  and (select capability='sales.manage' and guard_kind='write' from private.operator_rpc_contracts where signature='public.admin_revert_shipment_delivery(uuid,text,uuid,timestamp with time zone)')
  and (select capability='sales.manage' and guard_kind='write' from private.operator_rpc_contracts where signature='public.admin_revert_shipment_dispatch(uuid,text,uuid,text)')
) then 1 else 0 end as assert_sealed_acl;

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Shipment revert assertion: %',label;end if;
end $$;
-- 계정: 1 주매니저(sales.manage), 2 구매자, 3 물류 출고 담당(sales.dispatch만).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c3a00000-0000-4000-8000-000000000001','authenticated','authenticated','shipment-revert-operator@example.test',now(),'{}','{}',now(),now()),
 ('c3a00000-0000-4000-8000-000000000002','authenticated','authenticated','shipment-revert-buyer@example.test',now(),'{}','{}',now(),now()),
 ('c3a00000-0000-4000-8000-000000000003','authenticated','authenticated','shipment-revert-logistics@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 배송 정정 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case right(id::text,1) when '1' then 'admin'::public.user_role when '3' then 'staff'::public.user_role else 'user'::public.user_role end
 where id::text like 'c3a00000-0000-4000-8000-00000000000%';
insert into private.operator_memberships(profile_id,manager_role) values('c3a00000-0000-4000-8000-000000000001','primary'),('c3a00000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=7,buyer_extension_days=3 where singleton;
insert into public.ips(id,title,vertical_key) values('shipment-revert-ip','TEST 배송 정정 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('shipment-revert-goods','shipment-revert-ip','TEST 배송 정정 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
 values('c3a00000-0000-4000-8000-0000000000f1','shipment-revert-origin','TEST 배송 정정 창고',0,'합성 반송 주소',true);
-- 주문 n: 결제·품목·택배 배송 건 하나. 배송 중이면 운송장 1000000nnn·발송 3일 전, 출고지시는 4일 전 전달.
create function pg_temp.order_with(n integer,status public.order_status,shipment_status text default 'ready') returns uuid language plpgsql as $$
declare oid uuid:=('c3a00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=('c3a00000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,'c3a00000-0000-4000-8000-000000000002',status,10000,
  jsonb_build_object('recipientName','TEST 수령인'||n,'phone','010000000'||lpad(n::text,2,'0'),'postalCode','12345','address1','합성 주소','address2',n||'층'),now()-interval '5 days');
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'shipment-revert-goods',1,10000,'TEST 배송 정정 굿즈','문구','shipment-revert-ip',(select id from public.goods_variants where good_id='shipment-revert-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,exported_at)
  values(sid,oid,'c3a00000-0000-4000-8000-0000000000f1','TEST 배송 정정 창고',0,'{}',shipment_status,
   case when shipment_status='shipping' then 'hanjin' end,case when shipment_status='shipping' then '1000000'||lpad(n::text,3,'0') end,
   case when shipment_status='shipping' then now()-interval '3 days' end,now()-interval '4 days');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values('c3a00000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk-shipment-revert-'||n,'idem-shipment-revert-'||n);
 return oid;
end $$;
create function pg_temp.sid(n integer) returns uuid language sql immutable as $$select ('c3a00000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.oid(n integer) returns uuid language sql immutable as $$select ('c3a00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid$$;
-- 1 기본 흐름 · 2 거래확정 · 3 리뷰 · 4 반품 진행 · 5 거절된 반품(허용) · 6 부분 취소 진행 · 7 택배 외 · 8·9 합포장
-- 10 발송 되돌리기 · 11 번호 재사용 대상 · 12 보낸 발송 메일 · 13 자동 배송완료 · 14 배송 중 반품(발송 되돌리기 막음) · 15 늦은 처리
-- 16 운송장 없는 강제 배송완료 · 17 구매확정 요청 알림 · 18 구매확정 보류 · 19·20 중복 승인 번호 · 21 이미 배송완료된 건에 일시
do $$begin
 perform pg_temp.order_with(n,'shipping','shipping') from unnest(array[1,2,3,4,5,6,7,8,9,13,14,15,17,18,20,21]) n;
 perform pg_temp.order_with(n,'confirmed') from unnest(array[10,11,12,16,19]) n;
end $$;
-- 합포장(8·9). 둘 다 배송 중이고 같은 묶음이다.
insert into private.shipment_packs(id,created_by) values('c3a00000-0000-4005-8000-000000000001','c3a00000-0000-4000-8000-000000000001');
insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest) values
 ('c3a00000-0000-4005-8000-000000000001',pg_temp.sid(8),'test'),('c3a00000-0000-4005-8000-000000000001',pg_temp.sid(9),'test');
update public.order_shipments set tracking_number='1000000008' where id=pg_temp.sid(9);

-- ---------------------------------------------------------------------------
-- 1. 택배사 도착 일시를 넣은 배송완료(물류 출고 담당).
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_complete_shipments_at(array[%L]::uuid[],now()+interval %L,null)',pg_temp.sid(1),'1 hour'),'delivered_at_in_future');
-- 처리 시각보다 7일 넘게 이른 일시는 물류 계정이 사유를 적어도 받지 않는다(판매 관리 권한만, 리뷰 R3).
select pg_temp.expect_error(format('select public.admin_complete_shipments_at(array[%L]::uuid[],now()-interval %L,null)',pg_temp.sid(1),'8 days'),'delivered_at_late_requires_manager');
select pg_temp.expect_error(format('select public.admin_complete_shipments_at(array[%L]::uuid[],now()-interval %L,%L)',pg_temp.sid(1),'30 days','택배사확인'),'delivered_at_late_requires_manager');
select pg_temp.expect_error(format('select public.admin_complete_shipments_at(array[%L]::uuid[],now()-interval %L,%L)',pg_temp.sid(1),'8 days','짧음'),'delivered_at_reason_invalid');
-- 발송 등록(3일 전)보다 이른 도착은 그 배송 건만 실패로 돌려준다(일괄 처리의 건별 결과).
select public.admin_complete_shipments_at(array[pg_temp.sid(1)],now()-interval '4 days','택배사 조회 결과 확인') as early \gset
select pg_temp.check((:'early'::jsonb->0->>'ok')='false' and (:'early'::jsonb->0->>'error')='delivered_at_before_shipped','arrival before dispatch registration is refused per shipment');
select (now()-interval '1 day')::timestamptz as arrival_one \gset
select public.admin_complete_shipments_at(array[pg_temp.sid(1)],:'arrival_one',null) as completed \gset
-- 시계 차이로 몇 분 앞선 값은 지금으로 맞춘다(10분 이내).
select public.admin_complete_shipments_at(array[pg_temp.sid(15)],now()+interval '3 minutes',null)->0->>'ok' as skew_ok \gset
reset role;
select pg_temp.check((:'completed'::jsonb->0->>'ok')='true' and :'completed'::jsonb->0->'arrivalIds'=to_jsonb(array[pg_temp.sid(1)]),'arrival completion succeeded and reports the recorded shipment');
select 1/count(*) as one_row from (select pg_temp.check(s.status='delivered' and s.delivered_at=:'arrival_one'::timestamptz and o.status='delivered' and o.delivered_at=:'arrival_one'::timestamptz,'shipment and order use the carrier arrival time')
 from public.order_shipments s join public.orders o on o.id=s.order_id where s.id=pg_temp.sid(1)) checked;
select 1/count(*) as one_row from (select pg_temp.check(c.auto_due_at=:'arrival_one'::timestamptz+interval '7 days' and c.confirmed_at is null,'purchase confirmation due follows the arrival time')
 from private.order_purchase_confirmations c where c.order_id=pg_temp.oid(1)) checked;
select pg_temp.check(exists(select 1 from public.audit_log where action='admin.shipment.arrival_recorded' and target='order:'||pg_temp.oid(1)
 and (diff->>'deliveredAt')::timestamptz=:'arrival_one'::timestamptz and diff->'shipmentIds'=to_jsonb(array[pg_temp.sid(1)])
 and actor_id='c3a00000-0000-4000-8000-000000000003'),'arrival time is audited with the processing actor');
select pg_temp.check(exists(select 1 from public.notifications where dedupe_key='order:delivered:'||pg_temp.oid(1)),'delivered notification exists');
select pg_temp.check(:'skew_ok'='true' and (select delivered_at<=clock_timestamp() and delivered_at>now()-interval '1 minute' from public.order_shipments where id=pg_temp.sid(15)),'slight clock skew is clamped to now');
select pg_temp.check(current_setting('icons.shipment_delivered_at',true) is not distinct from '' ,'arrival time is not left for later statements');
-- 옛 일괄 함수는 그대로 처리 시각이다.
update public.order_shipments set status='shipping',delivered_at=null where id=pg_temp.sid(15);
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_complete_shipments(array[pg_temp.sid(15)])->0->>'ok' as legacy_ok \gset
reset role;
select pg_temp.check(:'legacy_ok'='true' and (select delivered_at>now()-interval '1 minute' from public.order_shipments where id=pg_temp.sid(15)),'legacy bulk completion keeps processing time');

-- ---------------------------------------------------------------------------
-- 2. 배송완료 되돌리기 — 권한·입력·대조.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(1),'엉뚱한 배송 건 처리',:'arrival_one'),'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_revert_shipment_dispatch(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(2),'엉뚱한 배송 건 처리','1000000002'),'operator_capability_required');
reset role;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(1),'짧음',:'arrival_one'),'shipment_revert_reason_required');
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(1),'엉뚱한 배송 건 처리',now()),'shipment_revert_changed');
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),now())',pg_temp.sid(2),'엉뚱한 배송 건 처리'),'shipment_revert_not_delivered');
select public.admin_revert_shipment_delivery(pg_temp.sid(1),' 엉뚱한 배송 건을 배송완료로 눌렀음 ','c3a00000-0000-4009-8000-000000000001',:'arrival_one') as reverted \gset
-- 같은 작업 ID 재전송은 같은 결과, 다른 내용이면 거절한다.
select public.admin_revert_shipment_delivery(pg_temp.sid(1),'엉뚱한 배송 건을 배송완료로 눌렀음','c3a00000-0000-4009-8000-000000000001',:'arrival_one') as replayed \gset
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,%L,%L)',pg_temp.sid(1),'다른 사유로 다시 보냄','c3a00000-0000-4009-8000-000000000001',:'arrival_one'),'operation_conflict');
reset role;
select pg_temp.check(:'reverted'::jsonb=:'replayed'::jsonb and (:'reverted'::jsonb->>'orderStatus')='shipping'
 and (:'reverted'::jsonb->>'previousDeliveredAt')::timestamptz=:'arrival_one'::timestamptz and (:'reverted'::jsonb->>'orderCount')='1','revert receipt and replay');
select 1/count(*) as one_row from (select pg_temp.check(s.status='shipping' and s.delivered_at is null and s.tracking_number='1000000001' and s.shipped_at is not null
 and o.status='shipping' and o.delivered_at is null and not public.order_withdrawal_deadline_passed(o.delivered_at,'change_of_mind',now()+interval '1 year'),
 'delivery revert returns to shipping and clears the withdrawal start')
 from public.order_shipments s join public.orders o on o.id=s.order_id where s.id=pg_temp.sid(1)) checked;
select pg_temp.check(not exists(select 1 from private.order_purchase_confirmations where order_id=pg_temp.oid(1))
 and not exists(select 1 from public.notifications where dedupe_key='order:delivered:'||pg_temp.oid(1)),'confirmation due and delivered notification are cleared');
select pg_temp.check((select count(*)=1 from private.shipment_status_reverts r where r.operation_id='c3a00000-0000-4009-8000-000000000001' and r.kind='delivery'
  and r.shipment_id=pg_temp.sid(1) and (r.previous->>'deliveredAt')::timestamptz=:'arrival_one'::timestamptz and r.reason='엉뚱한 배송 건을 배송완료로 눌렀음'
  and (r.previous->'purchaseConfirmation'->>'auto_due_at')::timestamptz=:'arrival_one'::timestamptz+interval '7 days' and (r.previous->>'deliveredNotificationRemoved')::boolean),
 'revert ledger keeps the previous delivery and confirmation row');
select pg_temp.check((select count(*)=1 from public.audit_log a where a.id='c3a00000-0000-4009-8000-000000000001' and a.action='admin.shipment.delivery_reverted'
  and a.target='order:'||pg_temp.oid(1) and a.actor_id='c3a00000-0000-4000-8000-000000000001' and a.diff->>'reason'='엉뚱한 배송 건을 배송완료로 눌렀음'
  and (a.diff->'previous'->0->>'deliveredAt')::timestamptz=:'arrival_one'::timestamptz and a.diff->>'shipmentId'=pg_temp.sid(1)::text),'revert audit');
-- 다시 배송완료하면 그 시각과 지금 정책으로 기한·알림이 새로 잡힌다. 늦게 처리한 시각이면 철회 기한이 그 시각부터다.
update private.purchase_confirmation_policy set auto_after_days=10,revision=revision+1 where singleton;
-- 실제로는 12일 전에 발송했고 9일 전에 도착했는데 처리를 놓친 경우(SHP-051·CLM-028).
update public.order_shipments set shipped_at=now()-interval '12 days' where id=pg_temp.sid(1);
select (now()-interval '9 days')::timestamptz as arrival_late \gset
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_complete_shipments_at(array[%L]::uuid[],%L,null)',pg_temp.sid(1),:'arrival_late'),'delivered_at_late_reason_required');
select public.admin_complete_shipments_at(array[pg_temp.sid(1)],:'arrival_late','고객 확인 결과 9일 전에 받음')->0->>'ok' as redelivered \gset
reset role;
select 1/count(*) as one_row from (select pg_temp.check(:'redelivered'='true' and c.auto_due_at=:'arrival_late'::timestamptz+interval '10 days' and (c.policy_snapshot->>'autoAfterDays')='10'
 and o.delivered_at=:'arrival_late'::timestamptz and public.order_withdrawal_deadline_passed(o.delivered_at,'change_of_mind',now())
 and exists(select 1 from public.notifications where dedupe_key='order:delivered:'||o.id),'re-delivery recaptures the due date, notification and withdrawal start')
 from private.order_purchase_confirmations c join public.orders o on o.id=c.order_id where c.order_id=pg_temp.oid(1)) checked;
select pg_temp.check(exists(select 1 from public.audit_log where action='admin.shipment.arrival_recorded' and target='order:'||pg_temp.oid(1) and diff->>'reason'='고객 확인 결과 9일 전에 받음'),'late arrival reason is audited');
update private.purchase_confirmation_policy set auto_after_days=7,revision=revision+1 where singleton;

-- ---------------------------------------------------------------------------
-- 3. 막는 조건. 2 거래확정 · 3 리뷰 · 4 반품 진행 · 5 거절된 반품(허용) · 6 부분 취소 진행 · 7 택배 외.
update public.order_shipments set shipped_at=now()-interval '10 days' where id=pg_temp.sid(2);
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_complete_shipments_at(array[pg_temp.sid(2)],now()-interval '8 days','택배사 조회 결과 8일 전 도착') is not null as done_ready \gset
reset role;
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_complete_shipments_at(array(select pg_temp.sid(n) from generate_series(3,7) n),null,null) is not null as others_ready \gset
reset role;
select public.settle_delivered_orders() as settled \gset
select pg_temp.check((select status='done' from public.orders where id=pg_temp.oid(2)),'auto confirmation settled order 2');
set local session_replication_role=replica;
insert into public.reviews(user_id,good_id,order_id,rating,body) values('c3a00000-0000-4000-8000-000000000002','shipment-revert-goods',pg_temp.oid(3),5,'합성 리뷰 본문');
update public.order_shipments set status='delivered',delivered_at=now(),carrier=null,tracking_number=null,delivery_method='quick',
 delivery_policy_id=gen_random_uuid(),delivery_method_snapshot='{}',delivery_selection_id=gen_random_uuid() where id=pg_temp.sid(7);
insert into private.order_partial_cancellations(order_id,payment_id,provider,sequence,reason_code,customer_decision,warehouse_stop_confirmed,payment_amount,balance_before,
 goods_refund_amount,shipping_refund_amount,refund_amount,state,operation_id,created_by)
 select pg_temp.oid(6),p.id,'toss',1,'out_of_stock','합성 고객 결정',false,10000,10000,0,0,0,'processing',gen_random_uuid(),'c3a00000-0000-4000-8000-000000000001'
 from public.payments p where p.ref_id=pg_temp.oid(6);
set local session_replication_role=origin;
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type) values(pg_temp.oid(4),'c3a00000-0000-4000-8000-000000000002','TEST 반품 요청','return');
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type) values(pg_temp.oid(5),'c3a00000-0000-4000-8000-000000000002','TEST 거절된 반품','return');
update public.order_cancellation_requests set stage='rejected',status='rejected' where order_id=pg_temp.oid(5);
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(2),'엉뚱한 배송 건 처리',
 (select delivered_at from public.order_shipments where id=pg_temp.sid(2))),'shipment_revert_purchase_confirmed');
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(3),'엉뚱한 배송 건 처리',
 (select delivered_at from public.order_shipments where id=pg_temp.sid(3))),'shipment_revert_review_exists');
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(4),'엉뚱한 배송 건 처리',
 (select delivered_at from public.order_shipments where id=pg_temp.sid(4))),'shipment_revert_claim_exists');
select public.admin_revert_shipment_delivery(pg_temp.sid(5),'거절된 반품 뒤 오처리 정정',gen_random_uuid(),(select delivered_at from public.order_shipments where id=pg_temp.sid(5)))->>'orderStatus' as rejected_claim_ok \gset
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(6),'엉뚱한 배송 건 처리',
 (select delivered_at from public.order_shipments where id=pg_temp.sid(6))),'shipment_revert_partial_cancel_in_progress');
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(7),'엉뚱한 배송 건 처리',
 (select delivered_at from public.order_shipments where id=pg_temp.sid(7))),'shipment_revert_parcel_only');
reset role;
select pg_temp.check(:'rejected_claim_ok'='shipping','a rejected claim does not block');
select pg_temp.check((select status='delivered' from public.order_shipments where id=pg_temp.sid(3)) and (select status='delivered' from public.order_shipments where id=pg_temp.sid(4)),'blocked reverts change nothing');

-- ---------------------------------------------------------------------------
-- 4. 합포장: 한 건을 되돌리면 묶음 전체, 함께 옮긴 주문에도 감사가 남는다.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_complete_shipments_at(array[pg_temp.sid(8)],now()-interval '2 hours',null)->0->'affectedIds' as pack_affected \gset
reset role;
select pg_temp.check(:'pack_affected'::jsonb@>to_jsonb(array[pg_temp.sid(8),pg_temp.sid(9)]) and (select bool_and(status='delivered') from public.order_shipments where id in(pg_temp.sid(8),pg_temp.sid(9))),'pack delivered together');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_revert_shipment_delivery(pg_temp.sid(9),'합포장 묶음을 잘못 배송완료',gen_random_uuid(),(select delivered_at from public.order_shipments where id=pg_temp.sid(9))) as pack_revert \gset
reset role;
select pg_temp.check((:'pack_revert'::jsonb->>'orderCount')='2' and (select bool_and(s.status='shipping' and s.delivered_at is null and o.status='shipping')
 from public.order_shipments s join public.orders o on o.id=s.order_id where s.id in(pg_temp.sid(8),pg_temp.sid(9)))
 and (select count(*)=2 from private.shipment_status_reverts where shipment_id in(pg_temp.sid(8),pg_temp.sid(9)) and kind='delivery')
 and exists(select 1 from public.audit_log where action='admin.shipment.delivery_reverted' and target='order:'||pg_temp.oid(8) and diff->>'viaPackOf'=pg_temp.oid(9)::text)
 and not exists(select 1 from private.order_purchase_confirmations where order_id in(pg_temp.oid(8),pg_temp.oid(9))),'pack revert moves the whole pack');

-- ---------------------------------------------------------------------------
-- 5. 발송 되돌리기: 10을 잘못 발송(운송장 1000000010 + 추가 운송장). 11에 그 번호를 쓰려면 지금은 막힌다.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_update_shipment_status(pg_temp.sid(10),'shipping','hanjin','1000000010');
select public.admin_add_shipment_extra_tracking(pg_temp.sid(10),'hanjin','1000000110','두 번째 상자',gen_random_uuid())->>'status' as extra_added \gset
select pg_temp.expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',pg_temp.sid(11),'shipping','hanjin','1000000010'),'tracking_number_in_use');
reset role;
select pg_temp.check(:'extra_added'='added' and (select status='shipping' from public.orders where id=pg_temp.oid(10))
 and exists(select 1 from public.order_shipment_email_jobs where shipment_id=pg_temp.sid(10) and status='pending')
 and exists(select 1 from public.notifications where dedupe_key='order:shipping:'||pg_temp.oid(10)),'wrong dispatch recorded with email job and notification');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_revert_shipment_dispatch(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(10),'엉뚱한 배송 건 발송','1000000099'),'shipment_revert_changed');
select pg_temp.expect_error(format('select public.admin_revert_shipment_dispatch(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(1),'엉뚱한 배송 건 발송','1000000001'),'shipment_revert_not_shipping');
reset role;
-- 메일을 보내는 중(임대 중)이면 끝난 뒤 다시 한다.
update public.order_shipment_email_jobs set status='processing',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes' where shipment_id=pg_temp.sid(10);
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_revert_shipment_dispatch(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(10),'엉뚱한 배송 건 발송','1000000010'),'shipment_revert_email_sending');
reset role;
update public.order_shipment_email_jobs set status='pending',claim_token=null,lease_until=null where shipment_id=pg_temp.sid(10);
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_revert_shipment_dispatch(pg_temp.sid(10),'엉뚱한 배송 건에 운송장을 등록',(select 'c3a00000-0000-4009-8000-000000000010'::uuid),' 1000000010 ') as dispatch_reverted \gset
select public.admin_revert_shipment_dispatch(pg_temp.sid(10),'엉뚱한 배송 건에 운송장을 등록','c3a00000-0000-4009-8000-000000000010','1000000010') as dispatch_replayed \gset
reset role;
select pg_temp.check(:'dispatch_reverted'::jsonb=:'dispatch_replayed'::jsonb and (:'dispatch_reverted'::jsonb->>'orderStatus')='confirmed'
 and (:'dispatch_reverted'::jsonb->>'emailSent')='false' and (:'dispatch_reverted'::jsonb->>'previousTrackingNumber')='1000000010','dispatch revert receipt and replay');
select 1/count(*) as one_row from (select pg_temp.check(s.status='ready' and s.carrier is null and s.tracking_number is null and s.shipped_at is null and s.exported_at is not null
 and o.status='confirmed' and o.shipped_at is null and o.confirmed_at is not null,'dispatch revert returns to ready and keeps the warehouse handover')
 from public.order_shipments s join public.orders o on o.id=s.order_id where s.id=pg_temp.sid(10)) checked;
select pg_temp.check(not exists(select 1 from public.order_shipment_extra_trackings where shipment_id=pg_temp.sid(10))
 and exists(select 1 from private.order_shipment_tracking_changes where shipment_id=pg_temp.sid(10) and action='removed' and tracking_number='1000000110'
  and source='operator' and reason='엉뚱한 배송 건에 운송장을 등록' and operation_id is not null)
 and not exists(select 1 from public.order_shipment_email_jobs where shipment_id=pg_temp.sid(10))
 and not exists(select 1 from public.notifications where dedupe_key='order:shipping:'||pg_temp.oid(10)),'extra trackings, unsent email job and shipping notification are cleared');
select pg_temp.check((select r.previous->>'trackingNumber'='1000000010' and r.previous->'extraTrackings'->0->>'trackingNumber'='1000000110'
  and r.previous->'emailJob'->>'status'='pending' and r.previous->>'shippedAt' is not null from private.shipment_status_reverts r
  where r.operation_id='c3a00000-0000-4009-8000-000000000010' and r.kind='dispatch')
 and exists(select 1 from public.audit_log where id='c3a00000-0000-4009-8000-000000000010' and action='admin.shipment.dispatch_reverted'
  and diff->'previous'->0->>'trackingNumber'='1000000010'),'dispatch revert ledger and audit keep the previous numbers');
-- 이제 그 번호를 올바른 배송 건(11)에 쓰고, 10은 새 번호로 다시 발송한다(메일 작업·알림이 새로 생긴다).
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_update_shipment_status(pg_temp.sid(11),'shipping','hanjin','1000000010');
select public.admin_update_shipment_status(pg_temp.sid(10),'shipping','hanjin','1000000210');
reset role;
select pg_temp.check((select tracking_number='1000000010' and status='shipping' from public.order_shipments where id=pg_temp.sid(11))
 and (select tracking_number='1000000210' and status='shipping' from public.order_shipments where id=pg_temp.sid(10))
 and exists(select 1 from public.order_shipment_email_jobs where shipment_id=pg_temp.sid(10) and status='pending')
 and exists(select 1 from public.notifications where dedupe_key='order:shipping:'||pg_temp.oid(10)),'number is reusable and re-dispatch enqueues again');
-- 이미 보낸 발송 메일은 남기고 알린다(같은 배송 건 메일은 다시 보내지 않는다).
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_update_shipment_status(pg_temp.sid(12),'shipping','hanjin','1000000012');
reset role;
update public.order_shipment_email_jobs set status='completed',completed_at=now() where shipment_id=pg_temp.sid(12);
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_revert_shipment_dispatch(pg_temp.sid(12),'엉뚱한 배송 건에 운송장을 등록',gen_random_uuid(),'1000000012')->>'emailSent' as sent_email \gset
reset role;
select pg_temp.check(:'sent_email'='true' and exists(select 1 from public.order_shipment_email_jobs where shipment_id=pg_temp.sid(12) and status='completed'),'sent email job stays and is reported');
-- 배송 중 반품 접수가 있으면 발송 되돌리기를 막는다.
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type) values(pg_temp.oid(14),'c3a00000-0000-4000-8000-000000000002','TEST 배송 중 반품','return');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_revert_shipment_dispatch(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(14),'엉뚱한 배송 건 발송','1000000014'),'shipment_revert_claim_exists');
-- 합포장 발송 되돌리기는 묶음 전체.
select public.admin_revert_shipment_dispatch(pg_temp.sid(8),'합포장 묶음을 잘못 발송',gen_random_uuid(),'1000000008')->>'orderCount' as pack_dispatch \gset
reset role;
select pg_temp.check(:'pack_dispatch'='2' and (select bool_and(s.status='ready' and s.tracking_number is null and o.status='confirmed')
 from public.order_shipments s join public.orders o on o.id=s.order_id where s.id in(pg_temp.sid(8),pg_temp.sid(9))),'pack dispatch revert moves the whole pack');

-- ---------------------------------------------------------------------------
-- 6. 택배 추적 자동 배송완료는 되돌린 배송 건을 같은 발송 동안 다시 완료하지 않는다.
update private.delivery_tracking_settings set auto_delivery_enabled=true,provider='fake',enabled_at=now() where singleton;
set local role service_role;
select public.service_record_delivery_tracking('fake',jsonb_build_array(jsonb_build_object('carrier','hanjin','trackingNumber','1000000013','outcome','ok',
 'events',jsonb_build_array(jsonb_build_object('eventKey','revert-13','status','delivered','occurredAt',now()-interval '1 hour','description','합성','location','합성','raw','{}'::jsonb)))))->>'recorded' as recorded \gset
select public.service_complete_tracked_deliveries(50)->'completed' as auto_first \gset
reset role;
select pg_temp.check(:'auto_first'::jsonb @> jsonb_build_array(jsonb_build_object('shipmentId',pg_temp.sid(13))),'tracking auto delivery completed shipment 13');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_revert_shipment_delivery(pg_temp.sid(13),'고객이 받지 못했다고 연락함',gen_random_uuid(),(select delivered_at from public.order_shipments where id=pg_temp.sid(13))) is not null as auto_reverted \gset
reset role;
set local role service_role;
select public.service_complete_tracked_deliveries(50) as auto_second \gset
reset role;
select pg_temp.check(not (:'auto_second'::jsonb->'completed' @> jsonb_build_array(jsonb_build_object('shipmentId',pg_temp.sid(13))))
 and (select status='shipping' from public.order_shipments where id=pg_temp.sid(13))
 and (select previous->'autoDelivery'->>'state'='completed' from private.shipment_status_reverts where shipment_id=pg_temp.sid(13)),'reverted shipment is not auto-completed again');
-- 사람이 실제 도착을 확인해 처리하면 수동 처리로 보인다.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000001');
set local role authenticated;
select public.admin_complete_shipments_at(array[pg_temp.sid(13)],now()-interval '10 minutes',null)->0->>'ok' as manual_ok \gset
select public.admin_shipment_tracking_summaries(array[pg_temp.sid(13)])->'shipments'->(pg_temp.sid(13)::text)->>'deliveredBy' as delivered_by \gset
reset role;
select pg_temp.check(:'manual_ok'='true' and :'delivered_by'='manual','manual completion after revert is shown as manual');

-- ---------------------------------------------------------------------------
-- 7. 적대적 리뷰 고정(R1·R2·R4·R5·R6). 구매확정 요청·보류는 세션이 있는 운영자만 한다.
insert into auth.sessions(id,user_id,created_at,updated_at) values('c3a00000-0000-4000-9000-000000000001','c3a00000-0000-4000-8000-000000000001',now(),now());
create function pg_temp.as_manager() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c3a00000-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c3a00000-0000-4000-8000-000000000001','role','authenticated','session_id','c3a00000-0000-4000-9000-000000000001')::text,true);
end $$;
-- 구매확정 행의 revision은 postgres로 읽어 넘긴다(앱 롤은 private 표를 읽지 못한다).
create function pg_temp.confirmation(kind text,n integer,rev bigint,note text default '') returns jsonb language sql as $$
 select public.admin_change_purchase_confirmation(pg_temp.oid(n),kind,note,rev,gen_random_uuid(),
  'c3a00000-0000-4000-8000-000000000001','c3a00000-0000-4000-9000-000000000001')$$;
-- R1: 운송장 없이 강제 배송완료(발주확인 → 배송완료)한 건은 발송 대기·발주확인으로 되돌리고 배송 시작 알림을 만들지 않는다. 그 뒤 일반 발송·배송완료가 된다.
select pg_temp.as_manager();
set local role authenticated;
select public.admin_force_order_delivered((select order_number from public.orders where id=pg_temp.oid(16)),'시험 주문 강제 배송완료',gen_random_uuid())->>'status' as forced_status \gset
select public.admin_revert_shipment_delivery(pg_temp.sid(16),'강제 배송완료를 잘못 누름',gen_random_uuid(),(select delivered_at from public.order_shipments where id=pg_temp.sid(16))) as forced_revert \gset
reset role;
select pg_temp.check(:'forced_status'='delivered' and (:'forced_revert'::jsonb->>'shipmentStatus')='ready' and (:'forced_revert'::jsonb->>'orderStatus')='confirmed'
 and (select status='ready' and tracking_number is null and shipped_at is null and delivered_at is null and exported_at is not null from public.order_shipments where id=pg_temp.sid(16))
 and (select status='confirmed' and delivered_at is null and shipped_at is null from public.orders where id=pg_temp.oid(16))
 and not exists(select 1 from public.notifications where dedupe_key in('order:shipping:'||pg_temp.oid(16),'order:delivered:'||pg_temp.oid(16))),
 'tracking-less forced delivery returns to ready without a shipping notification');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_update_shipment_status(pg_temp.sid(16),'shipping','hanjin','1000000016');
select public.admin_complete_shipments_at(array[pg_temp.sid(16)],null,null)->0->>'ok' as forced_recomplete \gset
reset role;
select pg_temp.check(:'forced_recomplete'='true' and (select status='delivered' from public.orders where id=pg_temp.oid(16)),'reverted forced delivery can be dispatched and delivered normally');
-- R2: 운영자의 구매확정 요청 알림을 지워, 다시 배송완료한 뒤의 재요청이 다시 간다.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_complete_shipments_at(array[pg_temp.sid(17)],null,null)->0->>'ok' as r2_delivered \gset
reset role;
select revision as rev from private.order_purchase_confirmations where order_id=pg_temp.oid(17) \gset
select pg_temp.as_manager();
set local role authenticated;
select pg_temp.confirmation('request',17,:rev)->>'requestedAt' is not null as r2_requested \gset
select public.admin_revert_shipment_delivery(pg_temp.sid(17),'엉뚱한 배송 건 배송완료',gen_random_uuid(),(select delivered_at from public.order_shipments where id=pg_temp.sid(17))) is not null as r2_reverted \gset
reset role;
select pg_temp.check(:'r2_requested'::boolean and not exists(select 1 from public.notifications where dedupe_key='purchase-confirmation:'||pg_temp.oid(17))
 and (select (previous->>'confirmationRequestNotificationRemoved')::boolean and previous->'purchaseConfirmation'->>'requested_at' is not null from private.shipment_status_reverts where shipment_id=pg_temp.sid(17)),
 'confirmation request notification is removed and kept in the ledger');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_complete_shipments_at(array[pg_temp.sid(17)],null,null)->0->>'ok' as r2_redelivered \gset
reset role;
select revision as rev from private.order_purchase_confirmations where order_id=pg_temp.oid(17) \gset
select pg_temp.as_manager();
set local role authenticated;
select pg_temp.confirmation('request',17,:rev) is not null as r2_rerequested \gset
reset role;
select pg_temp.check(exists(select 1 from public.notifications where dedupe_key='purchase-confirmation:'||pg_temp.oid(17) and read_at is null),'re-request after re-delivery notifies again');
-- R4: 구매확정 보류 중이면 되돌리지 않는다(보류가 조용히 풀리지 않게). 해제하면 되돌릴 수 있다.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select public.admin_complete_shipments_at(array[pg_temp.sid(18)],null,null)->0->>'ok' as r4_delivered \gset
reset role;
select revision as rev from private.order_purchase_confirmations where order_id=pg_temp.oid(18) \gset
select pg_temp.as_manager();
set local role authenticated;
select pg_temp.confirmation('hold',18,:rev,'고객 분쟁 조사 중') is not null as r4_held \gset
select pg_temp.expect_error(format('select public.admin_revert_shipment_delivery(%L,%L,gen_random_uuid(),%L)',pg_temp.sid(18),'엉뚱한 배송 건 배송완료',
 (select delivered_at from public.order_shipments where id=pg_temp.sid(18))),'shipment_revert_confirmation_held');
reset role;
select revision as rev from private.order_purchase_confirmations where order_id=pg_temp.oid(18) \gset
select pg_temp.as_manager();
set local role authenticated;
select pg_temp.confirmation('resume',18,:rev) is not null as r4_resumed \gset
select public.admin_revert_shipment_delivery(pg_temp.sid(18),'엉뚱한 배송 건 배송완료',gen_random_uuid(),(select delivered_at from public.order_shipments where id=pg_temp.sid(18)))->>'orderStatus' as r4_reverted \gset
reset role;
select pg_temp.check(:'r4_reverted'='shipping','revert works after the hold is released');
-- R5: 중복 확인 승인으로 등록한 다른 주문의 번호를 발송 되돌리기하면 승인도 지워져, 다시 등록하려면 다시 승인을 받아야 한다.
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',pg_temp.sid(19),'shipping','hanjin','1000000020'),'tracking_number_in_use');
select public.admin_register_shipment_tracking_duplicate(pg_temp.sid(19),'hanjin','1000000020','회신 파일 그대로 등록') is not null as dup_registered \gset
reset role;
select pg_temp.check((select status='shipping' and tracking_number='1000000020' from public.order_shipments where id=pg_temp.sid(19))
 and exists(select 1 from private.tracking_duplicate_approvals where shipment_id=pg_temp.sid(19)),'duplicate approval registered');
select pg_temp.as_manager();
set local role authenticated;
select public.admin_revert_shipment_dispatch(pg_temp.sid(19),'다른 주문의 운송장을 등록함','c3a00000-0000-4009-8000-000000000019','1000000020')->>'orderStatus' as r5_reverted \gset
reset role;
select pg_temp.check(:'r5_reverted'='confirmed' and not exists(select 1 from private.tracking_duplicate_approvals where shipment_id=pg_temp.sid(19))
 and (select previous->'duplicateApprovals'->0->>'trackingNumber'='1000000020' and previous->'duplicateApprovals'->0->>'reason'='회신 파일 그대로 등록'
  from private.shipment_status_reverts where operation_id='c3a00000-0000-4009-8000-000000000019')
 and exists(select 1 from public.audit_log where id='c3a00000-0000-4009-8000-000000000019' and diff->'previous'->0->'duplicateApprovals'->0->>'trackingNumber'='1000000020'),
 'dispatch revert clears and records duplicate approvals');
select pg_temp.as_actor('c3a00000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',pg_temp.sid(19),'shipping','hanjin','1000000020'),'tracking_number_in_use');
-- R6: 이미 배송완료된 건에 일시를 넣어 다시 처리하면 성공으로 보이지만 일시는 기록되지 않았다고 돌려주고 감사도 남기지 않는다.
select public.admin_complete_shipments_at(array[pg_temp.sid(21)],null,null)->0->>'ok' as r6_first \gset
select public.admin_complete_shipments_at(array[pg_temp.sid(21)],now()-interval '2 days',null) as r6_second \gset
reset role;
select pg_temp.check(:'r6_first'='true' and (:'r6_second'::jsonb->0->>'ok')='true' and :'r6_second'::jsonb->0->'arrivalIds'='[]'::jsonb
 and (select delivered_at>now()-interval '1 minute' from public.order_shipments where id=pg_temp.sid(21))
 and not exists(select 1 from public.audit_log where action='admin.shipment.arrival_recorded' and target='order:'||pg_temp.oid(21)),
 'arrival time is reported only for shipments it was actually recorded on');

rollback;
