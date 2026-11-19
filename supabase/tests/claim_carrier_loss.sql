\set ON_ERROR_STOP on
-- 배송 분실(택배사 확인)의 회수 없는 반품 환불(원장 #15 SHP-095, ADR-0018 보완 2026-11-19). 합성 데이터만 쓰고 롤백한다. 결제사 API는 부르지 않는다.
--  1. 진입점 권한·분류, 입력 검사(사고 번호·근거 사진·리비전), 반품만(사유 무관)·발송된 배송 건만·입고 전 회수만.
--     김포 배송중(분실)·남양주 발송 전인 일부 발송 주문의 배송 중 반품: 남양주는 분실로 기록할 수 없고 '창고 보관 확인'으로 회수를
--     끝내며, 김포 분실 기록과 함께 입고완료가 되어 환불된다(남양주 품목은 재고로 돌아오고 김포 분실 품목은 돌아오지 않는다, 리뷰 P3).
--  2. 김포 입고 + 남양주 분실: 회수 완료(입고완료)·회수 완료일 = 분실 결정일, 반품 알림 문구, 같은 작업 재전송 멱등·다른 결정 충돌,
--     운영 상세(사고 번호·리비전)·고객 회수 문서(분실 표시). 환불 확정 때 분실 품목은 판매 재고로 되돌리지 않고 기록만 남긴다.
--     재고 대조는 분실 품목을 돌아온 수량으로 세지 않는다. 반품배송비 차감 없음(판매자 귀책).
--  3. 모두 분실: 실제 입고 없이 회수 완료. 하자 교환으로 전환해도 효력이 남고, 교환 사유를 단순 변심으로 정정하면 효력을 잃어
--     수거중으로 되돌아가며(운영 상세에 배송 분실이 보이지 않는다), 다시 하자로 정정하면 회수 완료가 된다(실제 RPC 경로).
--  3-2. 단순 변심 반품(고객 기본 사유)도 분실을 기록하고, 반품배송비 차감 대상이었던 반품이 분실 기록 뒤에는 판정·미리보기·결정
--     모두 차감하지 않는다. 단순 변심 교환으로 전환하면 효력을 잃고, 반품으로 되돌리면 다시 회수 완료가 된다(리뷰 P1).
--  4. 근거 사진 원장은 반품도 받는다(취소 클레임은 계속 거절).
begin;
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.cl_id(kind text,n integer) returns uuid language sql immutable as $$select md5('carrier-loss:'||kind||':'||n)::uuid$$;
create function pg_temp.cl_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'carrier loss assertion: %',label;end if;end$$;
create function pg_temp.cl_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected carrier loss rejection: %',expected;end$$;
create function pg_temp.cl_today() returns date language sql stable as $$select (clock_timestamp() at time zone 'Asia/Seoul')::date$$;
create function pg_temp.cl_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cl_id('user',actor),'session_id',pg_temp.cl_id('session',actor))::text,true);
end$$;
create function pg_temp.cl_loss(claim integer,shipment integer,op integer,accident text default 'HJ-ACC-20261119-01',files uuid[] default null,revision integer default null)
returns jsonb language sql as $$
 select public.admin_record_order_claim_carrier_loss(pg_temp.cl_id('claim',claim),pg_temp.cl_id('shipment',shipment),
  jsonb_build_object('reason','TEST 한진 고객센터 분실 확인 회신(11/19)','evidenceFileIds',to_jsonb(coalesce(files,array[pg_temp.cl_id('file',claim)])),'accidentNumber',accident),
  coalesce(revision,(select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',claim))),pg_temp.cl_id('operation',op))$$;
create function pg_temp.cl_stock(good text) returns integer language sql stable as $$select stock_qty from public.goods_variants where good_id=good and is_default$$;

-- 1. 진입점 권한·분류.
select pg_temp.cl_assert(
 has_function_privilege('authenticated','public.admin_record_order_claim_carrier_loss(uuid,uuid,jsonb,integer,uuid)','execute')
 and not has_function_privilege('anon','public.admin_record_order_claim_carrier_loss(uuid,uuid,jsonb,integer,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_record_order_claim_carrier_loss(uuid,uuid,jsonb,integer,uuid)','execute')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_record_order_claim_carrier_loss(uuid,uuid,jsonb,integer,uuid)'
  and capability='sales.manage' and guard_kind='write' and not legacy_admin_only)
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('claim_collection_waiver_effective','claim_has_effective_carrier_loss','order_item_lost_in_transit','guard_shipment_dispatch_during_partial_cancel')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))),
 'entry point is operator-only and helpers are sealed');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.cl_id('user',n),'authenticated','authenticated','carrier-loss-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select pg_temp.cl_id('session',n),pg_temp.cl_id('user',n),now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
update public.profiles set nickname='TEST 분실 '||right(id::text,6),
 role=case when id=pg_temp.cl_id('user',2) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.cl_id('user',n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.cl_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.cl_id('user',1),'primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('cl-ip','TEST 배송 분실','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.cl_id('origin',1),'cl-gimpo','TEST 김포','hanjin',0,'TEST 김포 반송지',true),
 (pg_temp.cl_id('origin',2),'cl-namyangju','TEST 남양주','hanjin',0,'TEST 남양주 반송지',true);
insert into public.goods(id,ip_id,name,price,stock,stock_qty,origin_id) values
 ('cl-good-1','cl-ip','TEST 김포 굿즈',2000,'ok',10,pg_temp.cl_id('origin',1)),
 ('cl-good-2','cl-ip','TEST 남양주 굿즈',3000,'ok',10,pg_temp.cl_id('origin',2));
create function pg_temp.cl_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;

-- 주문 1: 김포(배송완료) + 남양주(배송중, 분실). 주문 2: 남양주 한 건(배송중, 분실). 주문 3: 김포(배송중) + 남양주(발송 전).
-- 주문 4: 단순 변심 반품. 주문 5: 하자 교환. 주문 6: 취소 요청(근거 사진 거절 확인). 주문 7: 승인 뒤 발송이 정정돼 발송 전으로
-- 돌아간 배송 건(분실 기록 불가). 결제는 모두 토스 5,000원, 배송비 0원.
insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at)
 select pg_temp.cl_id('order',n),pg_temp.cl_id('user',2),'confirmed',5000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 분실로 1','address2','101호'),
  now()-interval '5 days' from generate_series(1,7)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_ip_id_snapshot)
 select pg_temp.cl_id('item',item),pg_temp.cl_id('order',purchase),good,pg_temp.cl_default(good),1,price,'TEST 굿즈 '||item,'cl-ip'
 from (values(1,1,'cl-good-1',2000),(2,1,'cl-good-2',3000),(3,2,'cl-good-2',5000),(4,3,'cl-good-1',2000),(5,3,'cl-good-2',3000),
  (6,4,'cl-good-2',5000),(7,5,'cl-good-2',5000),(8,6,'cl-good-2',5000),(9,7,'cl-good-2',5000)) spec(item,purchase,good,price);
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 select pg_temp.cl_id('shipment',s),pg_temp.cl_id('order',purchase),pg_temp.cl_id('origin',origin),case origin when 1 then 'TEST 김포' else 'TEST 남양주' end,0,'{}'
 from (values(1,1,1),(2,1,2),(3,2,2),(4,3,1),(5,3,2),(6,4,2),(7,5,2),(8,6,2),(9,7,2)) spec(s,purchase,origin);
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.cl_id('order',purchase),pg_temp.cl_id('shipment',s),pg_temp.cl_id('item',item),1
 from (values(1,1,1),(1,2,2),(2,3,3),(3,4,4),(3,5,5),(4,6,6),(5,7,7),(6,8,8),(7,9,9)) spec(purchase,s,item);
-- 발송·배송완료(배송 건 상태 갱신 트리거가 주문 상태를 다시 센다).
update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='CLTEST'||upper(right(replace(id::text,'-',''),10)),shipped_at=now()-interval '4 days'
 where id in(select pg_temp.cl_id('shipment',s) from unnest(array[1,2,3,4,6,7,9]) s);
update public.order_shipments set status='delivered',delivered_at=now()-interval '3 days' where id=pg_temp.cl_id('shipment',1);
insert into public.payments(id,user_id,purpose,ref_id,amount,status,idempotency_key,provider,payment_key)
 select pg_temp.cl_id('payment',n),pg_temp.cl_id('user',2),'order',pg_temp.cl_id('order',n),5000,'paid','cl-pay-'||n,'toss','TEST-CL-KEY-'||n from generate_series(1,7)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type)
 select pg_temp.cl_id('claim',n),pg_temp.cl_id('order',n),pg_temp.cl_id('user',2),'TEST 배송 분실 '||n,
  case n when 5 then 'exchange' when 6 then 'cancel' else 'return' end,'requested',case n when 4 then 'change_of_mind' else 'defect' end
 from generate_series(1,7)n;
insert into private.claim_evidence_files(id,claim_id,actor_id,mime_type,size_bytes,sha256,path)
 select pg_temp.cl_id('file',n),pg_temp.cl_id('claim',n),pg_temp.cl_id('user',1),'image/png',10,repeat('a',64),pg_temp.cl_id('claim',n)::text||'/'||pg_temp.cl_id('file',n)::text||'.png'
 from unnest(array[1,2,3,4,5,7])n;
select pg_temp.cl_assert((select status='shipping' from public.orders where id=pg_temp.cl_id('order',1))
 and (select status='shipping' from public.orders where id=pg_temp.cl_id('order',3)),'fixture orders are in transit');

select pg_temp.cl_auth();
select public.admin_decide_order_claim(pg_temp.cl_id('claim',n),'approve',null) from unnest(array[1,2,3,4,5,7])n;
-- 주문 7: 승인 뒤 배송 상태가 발송 전으로 정정된 배송 건(배송 상태 정정)은 분실로 기록할 수 없다.
update public.order_shipments set status='ready',carrier=null,tracking_number=null,shipped_at=null where id=pg_temp.cl_id('shipment',9);
select pg_temp.cl_assert((select count(*)=2 from public.order_claim_collections where claim_id=pg_temp.cl_id('claim',1))
 and (select stage='collecting' from public.order_cancellation_requests where id=pg_temp.cl_id('claim',1)),'approval opens origin collections');

-- 2. 입력·상태 검사 ---------------------------------------------------------------------------------------------------------
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,1,' HJ-1')$$,'invalid_carrier_accident_number');
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,1,'X')$$,'invalid_carrier_accident_number');
select pg_temp.cl_error(format('select public.admin_record_order_claim_carrier_loss(%L,%L,%L::jsonb,0,%L)',pg_temp.cl_id('claim',1),pg_temp.cl_id('shipment',2),
 '{"reason":"TEST 한진 고객센터 분실 확인 회신","evidenceFileIds":[]}',pg_temp.cl_id('operation',1)),'invalid_carrier_loss');
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,1,files=>array[pg_temp.cl_id('file',2)])$$,'collection_waiver_evidence_required');
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,1,revision=>0)$$,'claim_changed');
select pg_temp.cl_error($$select pg_temp.cl_loss(5,7,1)$$,'carrier_loss_return_only');
select pg_temp.cl_error($$select pg_temp.cl_loss(7,9,1)$$,'carrier_loss_shipment_not_dispatched');
select pg_temp.cl_error($$select pg_temp.cl_loss(3,5,1)$$,'carrier_loss_shipment_not_dispatched');
select pg_temp.cl_assert(not exists(select 1 from public.order_claim_collection_waivers where kind='carrier_loss'),'rejections leave no decision');
-- 권한: 운영자가 아니면 거절.
select pg_temp.cl_auth(2);
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,1)$$,'operator_capability_required');
select pg_temp.cl_auth();

-- 3. 김포 입고 + 남양주 분실 ------------------------------------------------------------------------------------------------
select public.admin_record_order_claim_origin_collection(pg_temp.cl_id('claim',1),pg_temp.cl_id('shipment',1),'TEST 김포 입고 1개 대조',pg_temp.cl_today()-2);
select pg_temp.cl_error($$select pg_temp.cl_loss(1,1,1)$$,'collection_waiver_not_needed');
select pg_temp.cl_loss(1,2,1) as first_loss \gset
select pg_temp.cl_assert((:'first_loss'::jsonb)->>'replayed'='false' and ((:'first_loss'::jsonb)->>'collectionComplete')::boolean
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.cl_today() from public.order_cancellation_requests where id=pg_temp.cl_id('claim',1))
 and private.claim_collection_waived(pg_temp.cl_id('claim',1),pg_temp.cl_id('shipment',2))
 and private.claim_collections_complete(pg_temp.cl_id('claim',1))
 and (select kind='carrier_loss' and carrier_accident_number='HJ-ACC-20261119-01' and waived_by=pg_temp.cl_id('user',1)
  from public.order_claim_collection_waivers where claim_id=pg_temp.cl_id('claim',1) and shipment_id=pg_temp.cl_id('shipment',2))
 and (select count(*)=1 from public.audit_log where action='admin.order.claim_carrier_loss_recorded' and diff->>'claimId'=pg_temp.cl_id('claim',1)::text
  and diff->>'accidentNumber'='HJ-ACC-20261119-01' and diff->>'trackingNumber' is not null)
 and exists(select 1 from public.notifications where user_id=pg_temp.cl_id('user',2) and source_id=pg_temp.cl_id('claim',1)::text and title='반품 확인이 끝났어요'
  and body like '%입고와 배송 중 분실 확인%'),
 'loss completes collection on the decision date and notifies a refund');
-- 같은 작업의 재전송은 같은 결과, 다른 작업·다른 사고 번호는 충돌이다.
select pg_temp.cl_assert((pg_temp.cl_loss(1,2,1,revision=>0))->>'replayed'='true'
 and (select count(*)=1 from public.audit_log where action='admin.order.claim_carrier_loss_recorded' and diff->>'claimId'=pg_temp.cl_id('claim',1)::text),'replay is idempotent');
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,2)$$,'collection_waiver_conflict');
select pg_temp.cl_error($$select pg_temp.cl_loss(1,2,1,'HJ-OTHER-02')$$,'collection_waiver_conflict');
-- 운영 상세·고객 회수 문서.
select pg_temp.cl_assert((public.admin_order_claim_detail(pg_temp.cl_id('claim',1))#>>'{claim,claimRevision}')::integer
  =(select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',1))
 and (select x#>>'{carrierLoss,accidentNumber}'='HJ-ACC-20261119-01' and (x->>'shipmentDispatched')::boolean and (x->>'collectionWaived')::boolean
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.cl_id('claim',1))#>'{claim,collections}') x where x->>'shipmentId'=pg_temp.cl_id('shipment',2)::text)
 and (select x->'carrierLoss'='null'::jsonb from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.cl_id('claim',1))#>'{claim,collections}') x
  where x->>'shipmentId'=pg_temp.cl_id('shipment',1)::text)
 and (select (r->>'carrierLoss')::boolean and (r->>'collectionWaived')::boolean from jsonb_array_elements(private.claim_collection_document(pg_temp.cl_id('claim',1))->'rows') r
  where r->>'shipmentId'=pg_temp.cl_id('shipment',2)::text)
 and (select not (r ? 'carrierLoss') from jsonb_array_elements(private.claim_collection_document(pg_temp.cl_id('claim',1))->'rows') r
  where r->>'shipmentId'=pg_temp.cl_id('shipment',1)::text),'detail and customer document show the lost shipment');
-- 환불: 판매자 귀책이라 차감 없이 결제액 전부. 확정 때 김포 품목만 재고로 되돌리고 남양주(분실) 품목은 기록만 남긴다.
select public.admin_record_order_claim_refund(pg_temp.cl_id('claim',1),'pg_cancel','filed',null);
select pg_temp.cl_assert((select amount=5000 from public.refunds where payment_id=pg_temp.cl_id('payment',1)),'refund intent is the whole payment');
select pg_temp.cl_assert(pg_temp.cl_stock('cl-good-1')=10 and pg_temp.cl_stock('cl-good-2')=10,'stocks before refund');
select public.complete_order_cancellation_request(pg_temp.cl_id('claim',1),array['TEST-CL-KEY-1'],pg_temp.cl_id('user',1));
select pg_temp.cl_assert(pg_temp.cl_stock('cl-good-1')=11 and pg_temp.cl_stock('cl-good-2')=10
 and (select status='canceled' from public.orders where id=pg_temp.cl_id('order',1))
 and exists(select 1 from public.audit_log where action='order.option_stock_restored' and target='order:'||pg_temp.cl_id('order',1) and diff->>'orderItemId'=pg_temp.cl_id('item',1)::text)
 and not exists(select 1 from public.audit_log where action='order.option_stock_restored' and target='order:'||pg_temp.cl_id('order',1) and diff->>'orderItemId'=pg_temp.cl_id('item',2)::text)
 and (select count(*)=1 from public.audit_log where action='order.option_stock_lost_in_transit' and target='order:'||pg_temp.cl_id('order',1)
  and diff->>'orderItemId'=pg_temp.cl_id('item',2)::text and (diff->>'qty')::integer=1),
 'lost item is not restocked and leaves a record');
-- 재고 대조: 분실 품목은 나갔고 돌아오지 않았다(회수·복원 어느 쪽에도 없다). 김포 품목은 입고로 돌아왔다.
select pg_temp.cl_assert((select returned_since_qty=0 and awaiting_return_qty=0 from private.stock_reconcile_flows(array[pg_temp.cl_default('cl-good-2')],now()-interval '10 days'))
 and (select returned_since_qty=1 from private.stock_reconcile_flows(array[pg_temp.cl_default('cl-good-1')],now()-interval '10 days')),'reconcile reads the lost item as never returned');

-- 3-1. 일부 발송 주문(김포 배송중·분실, 남양주 발송 전): 남양주는 창고 보관 확인, 김포는 분실 기록 → 입고완료 → 환불.
select pg_temp.cl_assert((select x->>'shipmentDispatched'='false' from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.cl_id('claim',3))#>'{claim,collections}') x
  where x->>'shipmentId'=pg_temp.cl_id('shipment',5)::text),'unsent shipment is marked for the warehouse retention check');
select public.admin_record_order_claim_origin_collection(pg_temp.cl_id('claim',3),pg_temp.cl_id('shipment',5),'TEST 미출고 남양주 1개 창고 보관 확인',pg_temp.cl_today());
select pg_temp.cl_loss(3,4,30,'HJ-ACC-20261119-03') as mixed_loss \gset
select pg_temp.cl_assert(((:'mixed_loss'::jsonb)->>'collectionComplete')::boolean
 and (select stage='collected' from public.order_cancellation_requests where id=pg_temp.cl_id('claim',3)),'retained unsent shipment and lost parcel complete the mixed return');
select public.admin_record_order_claim_refund(pg_temp.cl_id('claim',3),'pg_cancel','filed',null);
select pg_temp.cl_stock('cl-good-1') as g1_before, pg_temp.cl_stock('cl-good-2') as g2_before \gset
select public.complete_order_cancellation_request(pg_temp.cl_id('claim',3),array['TEST-CL-KEY-3'],pg_temp.cl_id('user',1));
select pg_temp.cl_assert(pg_temp.cl_stock('cl-good-1')=:g1_before and pg_temp.cl_stock('cl-good-2')=:g2_before+1
 and (select status='canceled' from public.orders where id=pg_temp.cl_id('order',3))
 and exists(select 1 from public.audit_log where action='order.option_stock_lost_in_transit' and diff->>'orderItemId'=pg_temp.cl_id('item',4)::text),
 'retained unsent goods are restocked and the lost parcel is not');

-- 4. 모두 분실: 입고 없이 회수 완료. 하자 교환 전환은 효력 유지, 단순 변심 교환이면 수거중, 다시 하자면 회수 완료 ----------------
select pg_temp.cl_loss(2,3,3,'HJ-ACC-20261119-02') as only_loss \gset
select pg_temp.cl_assert(((:'only_loss'::jsonb)->>'collectionComplete')::boolean
 and (select stage='collected' and collection_received_on=pg_temp.cl_today() from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2))
 and not exists(select 1 from public.order_claim_collections where claim_id=pg_temp.cl_id('claim',2) and collected_at is not null)
 and exists(select 1 from public.notifications where source_id=pg_temp.cl_id('claim',2)::text and title='반품 확인이 끝났어요'
  and body='배송 중 분실이 확인되어 굿즈 회수 없이 환불을 준비합니다.'),'all-lost return completes collection without receipts');
-- 하자 교환으로 전환(분실 재발송): 효력이 남아 입고완료 그대로다.
select public.admin_convert_order_claim_type(pg_temp.cl_id('claim',2),pg_temp.cl_id('convert',2),
 (select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2)),'exchange','TEST 고객이 재발송을 원함(통화 합의)',true,null);
select pg_temp.cl_assert((select claim_type='exchange' and reason_type='defect' and stage='collected' from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2))
 and private.claim_collection_waived(pg_temp.cl_id('claim',2),pg_temp.cl_id('shipment',3)),'defect exchange keeps the loss decision effective');
-- 교환 사유를 단순 변심으로 정정하면 효력을 잃는다: 수거중으로 되돌아가고 운영 상세에 배송 분실이 보이지 않는다.
select public.admin_change_order_claim_reason(pg_temp.cl_id('claim',2),pg_temp.cl_id('reason',2),
 (select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2)),pg_temp.cl_id('user',1),'change_of_mind','TEST 단순 변심으로 정정','TEST 고객과 통화로 사유 확인',true,true);
select pg_temp.cl_assert((select stage='collecting' and collected_at is null and collection_received_on is null from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2))
 and not private.claim_collections_complete(pg_temp.cl_id('claim',2))
 and exists(select 1 from public.audit_log where action='admin.order.claim_collection_reopened' and diff->>'claimId'=pg_temp.cl_id('claim',2)::text)
 and (select x->'carrierLoss'='null'::jsonb and x->>'collectionWaived'='false' from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.cl_id('claim',2))#>'{claim,collections}') x)
 and (select not (r ? 'carrierLoss') from jsonb_array_elements(private.claim_collection_document(pg_temp.cl_id('claim',2))->'rows') r),
 'change of mind exchange makes the loss decision ineffective and hides it');
select public.admin_change_order_claim_reason(pg_temp.cl_id('claim',2),pg_temp.cl_id('reason',3),
 (select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2)),pg_temp.cl_id('user',1),'defect','TEST 배송 분실로 다시 정정','TEST 택배사 분실 확인 회신 재확인',true,true);
select pg_temp.cl_assert((select stage='collected' and collected_at is not null from public.order_cancellation_requests where id=pg_temp.cl_id('claim',2))
 and private.claim_collections_complete(pg_temp.cl_id('claim',2)),'seller fault exchange again completes collection');

-- 3-2. 단순 변심 반품의 분실(고객 기본 사유). 반품배송비 차감을 켜 둔 상태에서 분실 기록이 차감을 끈다.
update private.return_fee_deduction_settings set enabled=true,one_way_amount=1000,evidence='TEST 반품배송비 차감 시험',enabled_at=now()-interval '1 day' where singleton;
select pg_temp.cl_assert((private.return_fee_deduction_plan(pg_temp.cl_id('claim',4))->>'applicable')::boolean,'change of mind return is a deduction target before the loss');
select pg_temp.cl_loss(4,6,4,'HJ-ACC-20261119-04') as com_loss \gset
select pg_temp.cl_assert(((:'com_loss'::jsonb)->>'collectionComplete')::boolean
 and private.return_fee_deduction_plan(pg_temp.cl_id('claim',4)) is null
 and private.claim_refund_deduction_view(pg_temp.cl_id('claim',4)) is null
 and (select stage='collected' from public.order_cancellation_requests where id=pg_temp.cl_id('claim',4)),'loss on a change of mind return completes collection and drops the deduction');
-- 단순 변심 교환으로 전환하면 효력을 잃고(교환 회수 생략은 판매자 귀책만), 반품으로 되돌리면 다시 회수 완료가 된다.
select public.admin_convert_order_claim_type(pg_temp.cl_id('claim',4),pg_temp.cl_id('convert',4),
 (select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',4)),'exchange','TEST 고객이 교환을 원함(통화 합의)',true,null);
select pg_temp.cl_assert((select claim_type='exchange' and stage='collecting' and collected_at is null from public.order_cancellation_requests where id=pg_temp.cl_id('claim',4))
 and not private.claim_collection_waived(pg_temp.cl_id('claim',4),pg_temp.cl_id('shipment',6)),'change of mind exchange reopens collection');
select public.admin_convert_order_claim_type(pg_temp.cl_id('claim',4),pg_temp.cl_id('convert',5),
 (select claim_revision from public.order_cancellation_requests where id=pg_temp.cl_id('claim',4)),'return','TEST 고객이 다시 환불을 원함(통화 합의)',true,null);
select pg_temp.cl_assert((select claim_type='return' and stage='collected' and collected_at is not null from public.order_cancellation_requests where id=pg_temp.cl_id('claim',4))
 and private.claim_collection_waived(pg_temp.cl_id('claim',4),pg_temp.cl_id('shipment',6)),'back to return completes collection again');
-- 환불 접수: 차감 결정이 생기지 않고 결제액 전부를 환불한다.
select public.admin_record_order_claim_refund(pg_temp.cl_id('claim',4),'pg_cancel','filed',null);
select pg_temp.cl_assert(not exists(select 1 from private.claim_refund_deductions where claim_id=pg_temp.cl_id('claim',4))
 and (select amount=5000 from public.refunds where payment_id=pg_temp.cl_id('payment',4)),'filing a lost change of mind return records no deduction');

-- 5. 근거 사진 원장: 반품은 형식 검사까지 간다(합성이라 저장 객체 확인에서 멈춤), 취소는 계속 거절.
select pg_temp.cl_error(format('select public.admin_register_claim_evidence_file(%L,%L,''image/png'',10,%L)',pg_temp.cl_id('claim',1),pg_temp.cl_id('file',20),repeat('b',64)),'claim_evidence_unverified');
select pg_temp.cl_error(format('select public.admin_register_claim_evidence_file(%L,%L,''image/png'',10,%L)',pg_temp.cl_id('claim',6),pg_temp.cl_id('file',21),repeat('b',64)),'claim_evidence_unavailable');

rollback;
