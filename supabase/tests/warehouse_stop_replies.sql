\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 출고지시 뒤 취소: 창고 회신 기록과 '취소 뒤 출고 발견' (원장 #3 — CLM-013·SHP-063·SHP-064, ADR-0046)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 운영자 전액 취소는 출고지시가 나간 배송 건마다 그 출고지시 뒤 창고 '출고 중단' 회신 기록이 있어야 열린다.
--     확인란(true)만으로는 열리지 않고, '이미 출고' 회신이 가장 늦으면 거절한다. 더 늦은 '출고 중단' 회신이 정정한다.
--     다시 출고지시하면 예전 회신은 근거가 아니다. 쓴 회신은 그 요청에 묶여 다시 쓰이지 않는다(used)
--   · 회신 기록: 출고지시 전·발송된 배송 건·출고지시 전 시각·미래 시각·여러 주문·잘못된 입력을 거절한다. 같은 요청번호는 처음 결과,
--     다른 내용이면 충돌. 출고 담당(sales.dispatch)이 기록하고 감사가 남는다
--   · 출고지시 뒤 취소된 배송 건의 운송장 회신은 네 반입 경로(단건·김포·서원·표준 양식) 모두 그 줄만 '취소 뒤 출고 발견'으로 남기고
--     다른 줄은 정상 등록된다. 서원 파일 전체가 거절되지 않는다. 같은 운송장 재반입은 멱등, 다른 운송장은 충돌
--   · 취소된 배송 건에 '이미 출고' 회신을 기록해도 발견이 생기고, 뒤의 운송장 반입이 그 발견에 번호를 붙인다
--   · 재고는 실물 기준: 발견 때 취소가 되돌린 수량을 다시 빼고(모자라면 남은 만큼만, 모자란 수량 기록), 회수 입고면 되돌리고 손실이면 그대로.
--     재고 파일 대조 흐름이 발견을 출고·회수 입고를 회수로 센다
--   · 처리(sales.manage): 사유 필수, 한 번만, 같은 요청번호 재요청은 처음 결과. 운영 알림·감사·화면 읽기
--   · (리뷰 보완) 표준 양식의 오류 줄(운송장 빈칸·받는 분 불일치)은 취소된 배송 건이어도 발견을 만들지 않는다.
--     결제사 취소 처리 중에 기록한 '이미 출고' 회신은 취소 완료 때 발견이 된다. 발견의 운송장은 살아 있는 다른 주문에 쓸 수 없다
--   · (통합 리뷰) 배송 중 반품의 출고지시 나간 발송 전 배송 건 '창고 보관 확인'도 창고 회신이 근거다(이미 출고면 거절, 반송 입고 회신 뒤 회수).
--     발송으로 반박된 출고 중단 회신은 무효가 되어, 배송 건이 발송 대기로 돌아와도 취소 근거가 되지 않는다. 읽기 RPC는 행을 잠그지 않는다
--   · 권한 봉인
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_record_warehouse_stop_reply(uuid[],text,text,timestamp with time zone,text,uuid)','execute')
  and not has_function_privilege('anon','public.admin_record_warehouse_stop_reply(uuid[],text,text,timestamp with time zone,text,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_record_warehouse_stop_reply(uuid[],text,text,timestamp with time zone,text,uuid)','execute')
  and has_function_privilege('authenticated','public.admin_resolve_canceled_shipment_dispatch(uuid,text,text,uuid)','execute')
  and not has_function_privilege('anon','public.admin_resolve_canceled_shipment_dispatch(uuid,text,text,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_resolve_canceled_shipment_dispatch(uuid,text,text,uuid)','execute')
  and has_function_privilege('authenticated','public.admin_order_warehouse_stop_context(uuid)','execute')
  and not has_function_privilege('anon','public.admin_order_warehouse_stop_context(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_order_warehouse_stop_context(uuid)','execute')
  and not has_function_privilege('authenticated','private.record_canceled_shipment_dispatch(uuid,text,text,text,uuid,uuid)','execute')
  and not has_function_privilege('service_role','private.record_canceled_shipment_dispatch(uuid,text,text,text,uuid,uuid)','execute')
  and not has_function_privilege('service_role','private.record_dispatch_from_already_shipped_reply()','execute')
  and exists(select 1 from pg_trigger where tgname='order_shipments_canceled_after_already_shipped_reply' and tgrelid='public.order_shipments'::regclass)
  and not has_function_privilege('authenticated','private.warehouse_stop_gate(uuid[])','execute')
  and not has_function_privilege('service_role','private.consume_warehouse_stop_replies(uuid[],text,uuid,uuid)','execute')
  and not has_table_privilege('authenticated','private.warehouse_stop_replies','select,insert,update,delete')
  and not has_table_privilege('service_role','private.warehouse_stop_replies','select,insert,update,delete')
  and not has_table_privilege('service_role','private.canceled_shipment_dispatches','select,insert,update,delete')
  and not has_table_privilege('service_role','private.canceled_shipment_dispatch_stock','select,insert,update,delete')
  and (select count(*) from private.operator_rpc_contracts where (signature, capability, guard_kind) in (
    ('public.admin_record_warehouse_stop_reply(uuid[],text,text,timestamp with time zone,text,uuid)','sales.dispatch','write'),
    ('public.admin_resolve_canceled_shipment_dispatch(uuid,text,text,uuid)','sales.manage','write'),
    ('public.admin_order_warehouse_stop_context(uuid)','sales.read','read')))=3
  and not exists(select 1 from pg_proc where proname='o3d_patch_function')
) then 1 else 0 end as assert_sealed_acl;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값)
-- ---------------------------------------------------------------------------
create function pg_temp.wsr_id(kind text,n integer) returns uuid language sql immutable as $$select md5('warehouse-stop:'||kind||':'||n)::uuid$$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected error: % (statement %)',expected,statement;
end $$;
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.wsr_id('user',n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.wsr_id('user',n),'role','authenticated')::text,true);
end $$;
grant execute on function pg_temp.wsr_id(text,integer),pg_temp.expect_error(text,text),pg_temp.as_actor(integer) to authenticated,service_role;

-- 1 운영자(계정 주매니저: sales.manage) · 2 구매자 · 3 물류출고관리(sales.dispatch만) · 4 통합 매니저(권한 설정 완료 상태의 필수 1인)
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.wsr_id('user',n),'authenticated','authenticated','warehouse-stop-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,4) n;
update public.profiles set nickname='TEST 창고 회신 '||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id in (pg_temp.wsr_id('user',1),pg_temp.wsr_id('user',4)) then 'admin'::public.user_role
  when id=pg_temp.wsr_id('user',3) then 'staff'::public.user_role else 'user'::public.user_role end
 where id in (pg_temp.wsr_id('user',1),pg_temp.wsr_id('user',2),pg_temp.wsr_id('user',3),pg_temp.wsr_id('user',4));
insert into private.operator_memberships(profile_id,manager_role)
 values(pg_temp.wsr_id('user',1),'primary'),(pg_temp.wsr_id('user',3),'logistics'),(pg_temp.wsr_id('user',4),'owner');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('wsr-ip','TEST 창고 회신 IP','character');
-- F3 일반 출고지 · F1 김포(WMS 21열, 한진) · F2 남양주(서원 송장양식, 우체국)
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,export_template,default_carrier,is_active) values
 (pg_temp.wsr_id('origin',1),'wsr-gimpo','TEST 김포',0,'합성 반송 주소','wms_csv','hanjin',true),
 (pg_temp.wsr_id('origin',2),'wsr-seowon','TEST 남양주',0,'합성 반송 주소','seowon_xlsx','epost',true),
 (pg_temp.wsr_id('origin',3),'wsr-plain','TEST 일반',0,'합성 반송 주소','standard','hanjin',true);

-- n번 주문: 상품 wsr-goods-n(재고 10) 1개, 토스 결제완료. origins 배열의 출고지마다 배송 건 하나(shipment-n-k).
create function pg_temp.wsr_order(n integer,origins integer[],exported boolean default true,status public.order_status default 'confirmed') returns uuid
language plpgsql as $$
declare oid uuid:=pg_temp.wsr_id('order',n);item uuid;k integer;sid uuid;
begin
 insert into public.goods(id,ip_id,name,price,stock,stock_qty) values('wsr-goods-'||n,'wsr-ip','TEST 창고 회신 굿즈 '||n,10000,'ok',10);
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,pg_temp.wsr_id('user',2),status,10000*cardinality(origins),
  jsonb_build_object('recipientName','TEST 수령인 '||n,'phone','010000000'||lpad(n::text,2,'0'),'postalCode','12345','address1','합성 주소 '||n),now()-interval '2 hours');
 for k in 1..cardinality(origins) loop
  sid:=pg_temp.wsr_id('shipment-'||n,k);
  insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_ip_id_snapshot,variant_id)
   values(oid,'wsr-goods-'||n,1,10000,'TEST 창고 회신 굿즈 '||n,'wsr-ip',(select id from public.goods_variants where good_id='wsr-goods-'||n and is_default))
   returning id into item;
  insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,exported_at)
   values(sid,oid,pg_temp.wsr_id('origin',origins[k]),'TEST 출고지 '||origins[k],0,'{}',
    case when status='shipping' then 'shipping' else 'ready' end,case when status='shipping' then 'hanjin' end,
    case when status='shipping' then '90000000'||lpad(n::text,2,'0') end,case when status='shipping' then now()-interval '10 minutes' end,
    case when exported then now()-interval '30 minutes' end);
  insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 end loop;
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values(pg_temp.wsr_id('payment',n),pg_temp.wsr_id('user',2),'order',oid,'toss',10000*cardinality(origins),'paid','pk-wsr-'||n,'idem-wsr-'||n);
 return oid;
end $$;
create function pg_temp.stock(n integer) returns integer language sql as $$
 select stock_qty from public.goods_variants where good_id='wsr-goods-'||n and is_default$$;
create function pg_temp.complete(request uuid,n integer) returns void language plpgsql as $$begin
 execute 'set local role service_role';
 perform public.complete_order_cancellation_request(request,array['pk-wsr-'||n],pg_temp.wsr_id('user',1));
 execute 'reset role';
end $$;
create function pg_temp.reply(shipments uuid[],outcome text,replied timestamptz,operation integer,channel text default 'phone',note text default 'TEST 창고 담당 통화')
returns jsonb language sql as $$
 select public.admin_record_warehouse_stop_reply(shipments,outcome,channel,replied,note,pg_temp.wsr_id('reply-op',operation))$$;
grant execute on function pg_temp.stock(integer),pg_temp.reply(uuid[],text,timestamptz,integer,text,text) to authenticated;

select pg_temp.wsr_order(1,array[3]),pg_temp.wsr_order(2,array[3,1]),pg_temp.wsr_order(3,array[2]),pg_temp.wsr_order(4,array[2]),
 pg_temp.wsr_order(5,array[3]),pg_temp.wsr_order(6,array[3]),pg_temp.wsr_order(7,array[3],false),pg_temp.wsr_order(8,array[3],true,'shipping'),
 pg_temp.wsr_order(9,array[1]),pg_temp.wsr_order(10,array[3]),pg_temp.wsr_order(11,array[3]),pg_temp.wsr_order(12,array[3]),
 pg_temp.wsr_order(13,array[3]),pg_temp.wsr_order(14,array[3]),pg_temp.wsr_order(15,array[1,3]),pg_temp.wsr_order(16,array[3]);
-- END FIXTURE

-- ---------------------------------------------------------------------------
-- 1. 회신 기록 입력·권한 가드
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(2);
set local role authenticated;
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),1)',pg_temp.wsr_id('shipment-1',1),'stopped'),'42501');
reset role;
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),1)',pg_temp.wsr_id('shipment-1',1),'maybe'),'invalid_warehouse_stop_reply');
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),1,%L,null)',pg_temp.wsr_id('shipment-1',1),'stopped','other'),'invalid_warehouse_stop_reply');
select pg_temp.expect_error(format('select pg_temp.reply(array[%L,%L]::uuid[],%L,clock_timestamp(),1)',pg_temp.wsr_id('shipment-1',1),pg_temp.wsr_id('shipment-5',1),'stopped'),'warehouse_stop_reply_single_order');
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),1)',gen_random_uuid(),'stopped'),'shipment_not_found');
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),1)',pg_temp.wsr_id('shipment-7',1),'stopped'),'warehouse_stop_reply_not_exported');
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),1)',pg_temp.wsr_id('shipment-8',1),'stopped'),'warehouse_stop_reply_shipment_dispatched');
-- 회신은 출고지시(30분 전) 뒤의 일이고, 미래 시각은 받지 않는다.
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,now()-interval %L,1)',pg_temp.wsr_id('shipment-1',1),'stopped','40 minutes'),'warehouse_stop_reply_before_export');
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp()+interval %L,1)',pg_temp.wsr_id('shipment-1',1),'stopped','10 minutes'),'warehouse_stop_reply_in_future');
reset role;
select 1/case when not exists(select 1 from private.warehouse_stop_replies) then 1 else 0 end as assert_rejected_replies_leave_nothing;

-- ---------------------------------------------------------------------------
-- 2. 운영자 전액 취소 판정
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(1);
set local role authenticated;
-- 확인란(운영자 진술)만으로는 열리지 않는다.
select pg_temp.expect_error(format('select public.admin_start_order_cancellation(%L,%L,null,true)',pg_temp.wsr_id('order',1),'customer_request'),'warehouse_stop_reply_required');
-- 창고가 '이미 출고'라고 회신하면 거절된다.
select pg_temp.reply(array[pg_temp.wsr_id('shipment-1',1)],'already_shipped',now()-interval '20 minutes',1,'messenger',null);
select pg_temp.expect_error(format('select public.admin_start_order_cancellation(%L,%L,null,true)',pg_temp.wsr_id('order',1),'customer_request'),'warehouse_already_shipped');
-- 같은 요청번호 재요청은 처음 결과(새 행 없음), 다른 내용이면 충돌.
select 1/case when (pg_temp.reply(array[pg_temp.wsr_id('shipment-1',1)],'already_shipped',now()-interval '20 minutes',1,'messenger',null)->>'replayed')::boolean
 then 1 else 0 end as assert_reply_replay;
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,now()-interval %L,1,%L,null)',pg_temp.wsr_id('shipment-1',1),'stopped','20 minutes','messenger'),'warehouse_stop_reply_operation_conflict');
-- 더 늦은 '출고 중단' 회신이 정정한다. 그러나 그 뒤 다시 출고지시하면 예전 회신은 근거가 아니다.
select pg_temp.reply(array[pg_temp.wsr_id('shipment-1',1)],'stopped',now()-interval '10 minutes',2);
reset role;
select 1/case when private.warehouse_stop_status(pg_temp.wsr_id('shipment-1',1))='stopped' then 1 else 0 end as assert_later_stop_corrects;
update public.order_shipments set exported_at=now()-interval '5 minutes' where id=pg_temp.wsr_id('shipment-1',1);
select 1/case when private.warehouse_stop_status(pg_temp.wsr_id('shipment-1',1))='required' then 1 else 0 end as assert_reexport_makes_replies_stale;
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_start_order_cancellation(%L,%L,null,true)',pg_temp.wsr_id('order',1),'customer_request'),'warehouse_stop_reply_required');
select pg_temp.reply(array[pg_temp.wsr_id('shipment-1',1)],'stopped',clock_timestamp(),3) as reply_1 \gset
-- 회신이 근거라 확인란 값(false)과 상관없이 열린다.
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',1),'customer_request','TEST 고객 요청 취소',false) as request_1 \gset
reset role;
select 1/case when (select used_kind='staff_cancellation' and used_ref=:'request_1'::uuid and used_by=pg_temp.wsr_id('user',1)
   from private.warehouse_stop_replies where id=(:'reply_1'::jsonb->'replyIds'->>0)::uuid)
 and (select r.warehouse_stop_confirmed from public.order_cancellation_requests r where r.id=:'request_1')
 and (select a.diff->'warehouseStopReplyIds'=jsonb_build_array((:'reply_1'::jsonb->'replyIds'->>0)) from public.audit_log a
   where a.action='admin.order.staff_cancellation_started' and a.target='order:'||pg_temp.wsr_id('order',1))
 and private.warehouse_stop_status(pg_temp.wsr_id('shipment-1',1))='used'
 then 1 else 0 end as assert_reply_is_bound_to_the_request;
select pg_temp.expect_error(format('select private.warehouse_stop_gate(array[%L]::uuid[])',pg_temp.wsr_id('shipment-1',1)),'warehouse_stop_reply_used');
select 1/case when (select count(*)=3 and bool_and(diff->>'shipmentId'=pg_temp.wsr_id('shipment-1',1)::text and actor_id=pg_temp.wsr_id('user',1))
   from public.audit_log where action='admin.shipment.warehouse_stop_reply_recorded' and target='order:'||pg_temp.wsr_id('order',1))
 then 1 else 0 end as assert_replies_are_audited;
select pg_temp.complete(:'request_1',1);
select 1/case when (select status='canceled' from public.orders where id=pg_temp.wsr_id('order',1)) and pg_temp.stock(1)=11
 then 1 else 0 end as assert_cancellation_restored_stock;

-- 배송 건이 둘이면 둘 다 회신이 있어야 한다. 한 번의 기록으로 같은 주문의 여러 배송 건에 남길 수 있다.
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.reply(array[pg_temp.wsr_id('shipment-2',1)],'stopped',clock_timestamp(),4);
select pg_temp.expect_error(format('select public.admin_start_order_cancellation(%L,%L,null,true)',pg_temp.wsr_id('order',2),'out_of_stock'),'warehouse_stop_reply_required');
select pg_temp.reply(array[pg_temp.wsr_id('shipment-2',1),pg_temp.wsr_id('shipment-2',2)],'stopped',clock_timestamp(),5);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',2),'out_of_stock',null,true) as request_2 \gset
reset role;
select 1/case when (select count(*)=2 from private.warehouse_stop_replies where used_ref=:'request_2'::uuid)
 and (select count(*)=1 from private.warehouse_stop_replies where operation_id=pg_temp.wsr_id('reply-op',4) and used_at is null)
 then 1 else 0 end as assert_each_exported_shipment_uses_its_latest_reply;
select pg_temp.complete(:'request_2',2);

-- 물류출고관리(sales.dispatch만)는 회신을 기록할 수 있지만 발견 처리·주문 읽기는 못 한다.
select pg_temp.as_actor(3);
set local role authenticated;
select pg_temp.reply(array[pg_temp.wsr_id('shipment-3',1)],'stopped',clock_timestamp(),6);
select pg_temp.expect_error(format('select public.admin_order_warehouse_stop_context(%L)',pg_temp.wsr_id('order',3)),'42501');
select pg_temp.expect_error(format('select public.admin_resolve_canceled_shipment_dispatch(%L,%L,%L,%L)',gen_random_uuid(),'lost','TEST 손실 처리',gen_random_uuid()),'42501');
reset role;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',3),'out_of_stock',null,false) as request_3 \gset
select pg_temp.reply(array[pg_temp.wsr_id('shipment-5',1)],'stopped',clock_timestamp(),7);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',5),'out_of_stock',null,false) as request_5 \gset
select pg_temp.reply(array[pg_temp.wsr_id('shipment-6',1)],'stopped',clock_timestamp(),8);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',6),'out_of_stock',null,false) as request_6 \gset
select pg_temp.reply(array[pg_temp.wsr_id('shipment-10',1)],'stopped',clock_timestamp(),9);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',10),'out_of_stock',null,false) as request_10 \gset
reset role;
select pg_temp.complete(:'request_3',3),pg_temp.complete(:'request_5',5),pg_temp.complete(:'request_6',6),pg_temp.complete(:'request_10',10);
-- 6번 상품은 그사이 다시 팔려 재고가 0이 됐다(발견 때 모자란 수량을 기록한다).
select private.change_goods_variant_stock('wsr-goods-6',(select id from public.goods_variants where good_id='wsr-goods-6' and is_default),-11);

-- ---------------------------------------------------------------------------
-- 3. 취소 뒤 출고 발견 — 네 반입 경로
-- ---------------------------------------------------------------------------
select clock_timestamp() as before_discovery \gset
select pg_temp.as_actor(1);
set local role authenticated;
-- 단건: 오류가 아니라 발견 결과, 재고를 다시 뺀다.
select public.admin_import_shipment_tracking(pg_temp.wsr_id('shipment-1',1)::text,'hanjin','4100000001') as single_1 \gset
reset role;
select 1/case when (:'single_1'::jsonb->>'canceledAfterExport')::boolean and not (:'single_1'::jsonb->>'dispatched')::boolean
 and not (:'single_1'::jsonb->>'replayed')::boolean and pg_temp.stock(1)=10
 and (select status='canceled' and tracking_number is null from public.order_shipments where id=pg_temp.wsr_id('shipment-1',1))
 and (select source='tracking_reply' and carrier='hanjin' and tracking_number='4100000001' and state='open' and restored_qty=1 and withdrawn_qty=1 and shortfall_qty=0
   from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-1',1))
 and (select count(*)=1 from public.audit_log where action='order.canceled_dispatch_stock_withdrawn' and target='order:'||pg_temp.wsr_id('order',1) and (diff->>'delta')::int=-1)
 and (select count(*)=1 from private.admin_operation_alerts where category='orders' and href='/admin/sales/orders/'||pg_temp.wsr_id('order',1)
   and event_key like 'canceled_shipment_dispatch:%')
 then 1 else 0 end as assert_single_import_records_discovery;
select pg_temp.as_actor(1);
set local role authenticated;
-- 같은 운송장 재반입은 멱등(재고 그대로), 다른 운송장은 충돌.
select 1/case when (public.admin_import_shipment_tracking(pg_temp.wsr_id('shipment-1',1)::text,'hanjin','4100000001')->>'replayed')::boolean
 then 1 else 0 end as assert_same_waybill_is_idempotent;
select pg_temp.expect_error(format('select public.admin_import_shipment_tracking(%L,%L,%L)',pg_temp.wsr_id('shipment-1',1),'hanjin','4100000009'),'canceled_dispatch_tracking_conflict');
reset role;
select 1/case when pg_temp.stock(1)=10 and (select count(*)=1 from public.audit_log where action='admin.shipment.canceled_dispatch_discovered'
  and target='order:'||pg_temp.wsr_id('order',1)) then 1 else 0 end as assert_replay_changes_nothing;

-- 김포 WMS 회신: 취소 주문 줄은 발견, 같은 파일의 다른 주문은 정상 발송된다.
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_import_warehouse_tracking_batch(pg_temp.wsr_id('origin',1),jsonb_build_array(
 jsonb_build_object('line',1,'reference',pg_temp.wsr_id('order',2)::text,'trackingNumber','4100000002'),
 jsonb_build_object('line',2,'reference',pg_temp.wsr_id('order',9)::text,'trackingNumber','4100000009'))) as gimpo \gset
reset role;
select 1/case when (:'gimpo'::jsonb->0->>'ok')::boolean and (:'gimpo'::jsonb->0->>'canceledAfterExport')::boolean
 and (:'gimpo'::jsonb->1->>'ok')::boolean and (:'gimpo'::jsonb->1->>'dispatched')::boolean and :'gimpo'::jsonb->1->'canceledAfterExport' is null
 and (select status='shipping' and tracking_number='4100000009' from public.order_shipments where id=pg_temp.wsr_id('shipment-9',1))
 and (select tracking_number='4100000002' from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-2',2))
 then 1 else 0 end as assert_gimpo_reply_keeps_other_rows;

-- 서원 회신: 대조 후보에 출고지시 뒤 취소된 배송 건이 들어가고, 사전 검증이 파일 전체를 거절하지 않는다.
select pg_temp.as_actor(1);
set local role authenticated;
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_origin_tracking_candidates(pg_temp.wsr_id('origin',2),'{}',array['01000000003'])->'shipments') c
  where c->>'id'=pg_temp.wsr_id('shipment-3',1)::text and c->>'status'='canceled')
 then 1 else 0 end as assert_seowon_candidates_include_canceled_after_export;
select public.admin_import_seowon_tracking_batch(pg_temp.wsr_id('origin',2),jsonb_build_array(
 jsonb_build_object('line',1,'reference',pg_temp.wsr_id('shipment-3',1)::text,'carrier','epost','trackingNumber','6000000000003'),
 jsonb_build_object('line',2,'reference',pg_temp.wsr_id('shipment-4',1)::text,'carrier','epost','trackingNumber','6000000000004'))) as seowon \gset
select pg_temp.expect_error(format('select public.admin_import_seowon_tracking_batch(%L,%L::jsonb)',pg_temp.wsr_id('origin',2),
 jsonb_build_array(jsonb_build_object('line',1,'reference',pg_temp.wsr_id('shipment-3',1)::text,'carrier','epost','trackingNumber','6000000000003',
  'extraTrackingNumbers',jsonb_build_array('6000000000033')))),'canceled_dispatch_extra_tracking');
reset role;
select 1/case when (select bool_or((value->>'canceledAfterExport')::boolean) and count(*)=2 and bool_and((value->>'ok')::boolean) from jsonb_array_elements(:'seowon'::jsonb))
 and (select status='shipping' and tracking_number='6000000000004' from public.order_shipments where id=pg_temp.wsr_id('shipment-4',1))
 and (select carrier='epost' and tracking_number='6000000000003' from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-3',1))
 then 1 else 0 end as assert_seowon_reply_keeps_other_rows;

-- 이미 취소된 배송 건에 '이미 출고' 회신을 기록해도 발견이 생기고, 뒤의 표준 양식(상품주문) 반입이 운송장을 붙인다.
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.reply(array[pg_temp.wsr_id('shipment-5',1)],'already_shipped',clock_timestamp(),10,'warehouse_system',null) as reply_5 \gset
reset role;
select 1/case when jsonb_array_length(:'reply_5'::jsonb->'discoveryIds')=1 and pg_temp.stock(5)=10
 and (select source='warehouse_reply' and reply_id=(:'reply_5'::jsonb->'replyIds'->>0)::uuid and tracking_number is null
   from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-5',1))
 then 1 else 0 end as assert_already_shipped_reply_records_discovery;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_import_item_tracking_batch(jsonb_build_array(jsonb_build_object('line',1,
 'reference',(select id from public.order_items where order_id=pg_temp.wsr_id('order',5))::text,'carrier','hanjin','trackingNumber','4100000005'))) as item_5 \gset
reset role;
select 1/case when (:'item_5'::jsonb->0->>'canceledAfterExport')::boolean and (:'item_5'::jsonb->0->>'trackingRecorded')::boolean and pg_temp.stock(5)=10
 and (select carrier='hanjin' and tracking_number='4100000005' and tracking_recorded_at is not null from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-5',1))
 then 1 else 0 end as assert_item_reply_attaches_tracking;

-- 재고가 모자라면 남은 만큼만 빼고 모자란 수량을 기록한다.
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_import_shipment_tracking(pg_temp.wsr_id('shipment-6',1)::text,'hanjin','4100000006');
select public.admin_import_shipment_tracking(pg_temp.wsr_id('shipment-10',1)::text,'hanjin','4100000010');
reset role;
select 1/case when pg_temp.stock(6)=0 and (select withdrawn_qty=0 and shortfall_qty=1 and restored_qty=1 from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-6',1))
 then 1 else 0 end as assert_shortfall_is_recorded;

-- 재고 파일 대조: 기준 시각 뒤 발견은 출고로 센다.
select 1/case when (select shipped_since_qty=1 and returned_since_qty=0 and pending_qty=0 from private.stock_reconcile_flows(
   array[(select id from public.goods_variants where good_id='wsr-goods-1' and is_default)],:'before_discovery'::timestamptz))
 and (select shipped_since_qty=0 from private.stock_reconcile_flows(
   array[(select id from public.goods_variants where good_id='wsr-goods-1' and is_default)],clock_timestamp()))
 then 1 else 0 end as assert_reconcile_counts_discovery_as_shipped;

-- 화면 읽기: 발견·회신 기록과 처리 권한.
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_order_warehouse_stop_context(pg_temp.wsr_id('order',1)) as context_1 \gset
reset role;
select 1/case when (:'context_1'::jsonb->>'canResolve')::boolean and (:'context_1'::jsonb->>'canRecord')::boolean
 and jsonb_array_length(:'context_1'::jsonb->'discoveries')=1
 and :'context_1'::jsonb->'discoveries'->0->>'state'='open' and :'context_1'::jsonb->'discoveries'->0->>'trackingNumber'='4100000001'
 and :'context_1'::jsonb->'discoveries'->0->'lines'->0->>'goodName'='TEST 창고 회신 굿즈 1'
 and jsonb_array_length(:'context_1'::jsonb->'shipments')=1 and jsonb_array_length(:'context_1'::jsonb->'shipments'->0->'replies')=3
 and :'context_1'::jsonb->'shipments'->0->>'stopStatus'='not_applicable'
 then 1 else 0 end as assert_context_reads_replies_and_discoveries;

-- ---------------------------------------------------------------------------
-- 4. 처리: 회수 입고(재고 되돌림)·손실(그대로)
-- ---------------------------------------------------------------------------
select id as dispatch_1 from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-1',1) \gset
select id as dispatch_6 from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-6',1) \gset
select id as dispatch_10 from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-10',1) \gset
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_resolve_canceled_shipment_dispatch(%L,%L,%L,%L)',:'dispatch_1','returned','짧음',pg_temp.wsr_id('resolve-op',1)),'invalid_canceled_dispatch_resolution');
select public.admin_resolve_canceled_shipment_dispatch(:'dispatch_1','returned','TEST 고객 반송 상자 입고 확인',pg_temp.wsr_id('resolve-op',1)) as resolved_1 \gset
select 1/case when (public.admin_resolve_canceled_shipment_dispatch(:'dispatch_1','returned','TEST 고객 반송 상자 입고 확인',pg_temp.wsr_id('resolve-op',1))->>'replayed')::boolean
 then 1 else 0 end as assert_resolve_replay;
select pg_temp.expect_error(format('select public.admin_resolve_canceled_shipment_dispatch(%L,%L,%L,%L)',:'dispatch_1','lost','TEST 손실로 바꾸기',pg_temp.wsr_id('resolve-op',1)),'canceled_dispatch_operation_conflict');
select pg_temp.expect_error(format('select public.admin_resolve_canceled_shipment_dispatch(%L,%L,%L,%L)',:'dispatch_1','lost','TEST 다시 처리',pg_temp.wsr_id('resolve-op',2)),'canceled_dispatch_already_resolved');
select public.admin_resolve_canceled_shipment_dispatch(:'dispatch_6','returned','TEST 재고 부족이었던 배송 건 회수',pg_temp.wsr_id('resolve-op',3));
select public.admin_resolve_canceled_shipment_dispatch(:'dispatch_10','lost','TEST 고객 연락 불가 — 손실 처리',pg_temp.wsr_id('resolve-op',4));
reset role;
select 1/case when pg_temp.stock(1)=11 and (:'resolved_1'::jsonb->>'returnedQty')::int=1
 and (select state='returned' and returned_qty=1 and resolution_note='TEST 고객 반송 상자 입고 확인' and resolved_by=pg_temp.wsr_id('user',1)
   from private.canceled_shipment_dispatches where id=:'dispatch_1')
 and (select count(*)=1 from public.audit_log where action='order.canceled_dispatch_stock_returned' and target='order:'||pg_temp.wsr_id('order',1) and (diff->>'delta')::int=1)
 and (select count(*)=1 from public.audit_log where action='admin.shipment.canceled_dispatch_resolved' and target='order:'||pg_temp.wsr_id('order',1) and diff->>'outcome'='returned')
 -- 재고가 모자라 빼지 못한 배송 건은 회수해도 뺀 만큼(0)만 되돌린다.
 and pg_temp.stock(6)=0 and (select state='returned' and returned_qty=0 from private.canceled_shipment_dispatches where id=:'dispatch_6')
 and pg_temp.stock(10)=10 and (select state='lost' and returned_qty is null from private.canceled_shipment_dispatches where id=:'dispatch_10')
 then 1 else 0 end as assert_resolution_moves_stock_once;
select 1/case when (select returned_since_qty=1 and shipped_since_qty=1 from private.stock_reconcile_flows(
   array[(select id from public.goods_variants where good_id='wsr-goods-1' and is_default)],:'before_discovery'::timestamptz))
 and (select returned_since_qty=0 and shipped_since_qty=1 from private.stock_reconcile_flows(
   array[(select id from public.goods_variants where good_id='wsr-goods-10' and is_default)],:'before_discovery'::timestamptz))
 then 1 else 0 end as assert_reconcile_counts_returned_dispatch;

-- ---------------------------------------------------------------------------
-- 5. 리뷰 보완
-- ---------------------------------------------------------------------------
-- (1) 표준 양식의 오류 줄은 합포장 사전 검사용으로 빈 택배사·운송장을 싣고 온다. 취소된 배송 건이어도 발견이 아니다.
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.reply(array[pg_temp.wsr_id('shipment-11',1)],'stopped',clock_timestamp(),11);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',11),'customer_request',null,false) as request_11 \gset
select pg_temp.reply(array[pg_temp.wsr_id('shipment-12',1)],'stopped',clock_timestamp(),12);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',12),'customer_request',null,false) as request_12 \gset
reset role;
select pg_temp.complete(:'request_11',11),pg_temp.complete(:'request_12',12);
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_import_item_tracking_batch(jsonb_build_array(
 jsonb_build_object('line',1,'reference',(select id from public.order_items where order_id=pg_temp.wsr_id('order',11))::text,'carrier','','trackingNumber',''),
 jsonb_build_object('line',2,'reference',(select id from public.order_items where order_id=pg_temp.wsr_id('order',12))::text,'carrier','hanjin','trackingNumber','4100000012',
   'recipientName','다른 사람','recipientPhone','01099998888'))) as blank_rows \gset
select pg_temp.expect_error(format('select public.admin_import_shipment_tracking(%L,%L,%L)',pg_temp.wsr_id('shipment-11',1),'',''),'invalid_tracking_input');
reset role;
select pg_temp.expect_error(format('select private.record_canceled_shipment_dispatch(%L,null,null,%L,null,%L)',pg_temp.wsr_id('shipment-11',1),'tracking_reply',pg_temp.wsr_id('user',1)),'invalid_tracking_input');
select 1/case when (select bool_and(not (value->>'ok')::boolean) and count(*)=2 from jsonb_array_elements(:'blank_rows'::jsonb))
 and :'blank_rows'::jsonb->1->>'error'='tracking_reply_recipient_mismatch'
 and not exists(select 1 from private.canceled_shipment_dispatches where shipment_id in (pg_temp.wsr_id('shipment-11',1),pg_temp.wsr_id('shipment-12',1)))
 and pg_temp.stock(11)=11 and pg_temp.stock(12)=11
 and not exists(select 1 from private.admin_operation_alerts where href in ('/admin/sales/orders/'||pg_temp.wsr_id('order',11),'/admin/sales/orders/'||pg_temp.wsr_id('order',12)))
 then 1 else 0 end as assert_error_rows_make_no_discovery;

-- (2) 결제사 취소 처리 중에 창고가 '이미 나갔다'고 회신하면 기록은 받고, 취소가 끝나 배송 건이 취소되는 순간 발견이 된다.
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.reply(array[pg_temp.wsr_id('shipment-13',1)],'stopped',clock_timestamp()-interval '1 minute',13);
select public.admin_start_order_cancellation(pg_temp.wsr_id('order',13),'customer_request',null,false) as request_13 \gset
select pg_temp.reply(array[pg_temp.wsr_id('shipment-13',1)],'already_shipped',clock_timestamp(),14,'messenger',null) as inflight_reply \gset
reset role;
select 1/case when (:'inflight_reply'::jsonb->>'cancellationInFlight')::boolean and jsonb_array_length(:'inflight_reply'::jsonb->'discoveryIds')=0
 and private.warehouse_stop_status(pg_temp.wsr_id('shipment-13',1))='already_shipped'
 then 1 else 0 end as assert_inflight_reply_is_recorded;
select pg_temp.complete(:'request_13',13);
select 1/case when (select o.status='canceled' from public.orders o where o.id=pg_temp.wsr_id('order',13))
 and (select source='warehouse_reply' and reply_id=(:'inflight_reply'::jsonb->'replyIds'->>0)::uuid and discovered_by=pg_temp.wsr_id('user',1)
   and restored_qty=1 and withdrawn_qty=1 and state='open'
   from private.canceled_shipment_dispatches where shipment_id=pg_temp.wsr_id('shipment-13',1))
 and pg_temp.stock(13)=10
 and exists(select 1 from private.admin_operation_alerts where href='/admin/sales/orders/'||pg_temp.wsr_id('order',13) and event_key like 'canceled_shipment_dispatch:%:created')
 then 1 else 0 end as assert_inflight_already_shipped_becomes_discovery_on_completion;

-- (3) 발견의 운송장은 살아 있는 다른 주문의 배송 건에 쓸 수 없다(번호 판정·서원 대조의 쓰인 번호).
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_import_shipment_tracking(%L,%L,%L)',pg_temp.wsr_id('shipment-14',1),'hanjin','4100000001'),'tracking_number_in_use');
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_origin_tracking_candidates(pg_temp.wsr_id('origin',2),array['6000000000003'],'{}')->'usedTracking') u
   where u->>'trackingNumber'='6000000000003' and u->>'shipmentId'=pg_temp.wsr_id('shipment-3',1)::text)
 then 1 else 0 end as assert_seowon_used_tracking_includes_discovery;
-- 같은 발견의 같은 운송장 재반입은 여전히 멱등이다.
select 1/case when (public.admin_import_shipment_tracking(pg_temp.wsr_id('shipment-1',1)::text,'hanjin','4100000001')->>'replayed')::boolean
 then 1 else 0 end as assert_discovery_waybill_replay_still_allowed;
reset role;
select 1/case when (select status='ready' and tracking_number is null from public.order_shipments where id=pg_temp.wsr_id('shipment-14',1))
 then 1 else 0 end as assert_live_order_not_dispatched_with_discovery_waybill;

-- ---------------------------------------------------------------------------
-- 6. 통합 리뷰 보완
-- ---------------------------------------------------------------------------
-- (1) 주문 15: 김포(배송 건 1) 발송, 일반(배송 건 2) 출고지시·발송 전. 고객이 주문 전체 배송 중 반품을 접수했다.
update public.orders set status='shipping', shipped_at=now()-interval '2 days', created_at=now()-interval '5 days' where id=pg_temp.wsr_id('order',15);
update public.order_shipments set status='shipping', carrier='hanjin', tracking_number='4200000151', shipped_at=now()-interval '2 days'
 where id=pg_temp.wsr_id('shipment-15',1);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type,requested_at)
 values(pg_temp.wsr_id('claim',15),pg_temp.wsr_id('order',15),pg_temp.wsr_id('user',2),'TEST 배송 중 반품','return','requested','defect',clock_timestamp());
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_decide_order_claim(pg_temp.wsr_id('claim',15),'approve',null);
-- 회신이 없으면 발송 전 배송 건의 창고 보관 확인을 받지 않는다.
select pg_temp.expect_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,%L,%L::date)',pg_temp.wsr_id('claim',15),pg_temp.wsr_id('shipment-15',2),
 'TEST 창고 보관 확인',(clock_timestamp() at time zone 'Asia/Seoul')::date),'claim_collection_warehouse_reply_required');
-- 창고가 이미 출고했다고 회신했으면 보관 확인이 아니다. 반품이 열려 있는 동안은 운송장 반입(발송 처리)도 막혀 있다.
select pg_temp.reply(array[pg_temp.wsr_id('shipment-15',2)],'already_shipped',clock_timestamp(),151);
select pg_temp.expect_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,%L,%L::date)',pg_temp.wsr_id('claim',15),pg_temp.wsr_id('shipment-15',2),
 'TEST 창고 보관 확인',(clock_timestamp() at time zone 'Asia/Seoul')::date),'claim_collection_warehouse_already_shipped');
select pg_temp.expect_error(format('select public.admin_import_shipment_tracking(%L,%L,%L)',pg_temp.wsr_id('shipment-15',2),'hanjin','4200000152'),'order cancellation in progress');
-- 반송 입고는 이미 출고 회신이 있는 발송 대기 배송 건에만 남긴다.
select pg_temp.expect_error(format('select pg_temp.reply(array[%L]::uuid[],%L,clock_timestamp(),152)',pg_temp.wsr_id('shipment-14',1),'returned'),'warehouse_stop_reply_returned_without_shipped');
-- 고객이 받은 상자를 돌려보내 창고에 다시 들어오면 '반송 입고'를 기록하고 회수를 확인한다. 그 회신은 이 클레임에 묶인다.
select pg_temp.reply(array[pg_temp.wsr_id('shipment-15',2)],'returned',clock_timestamp()+interval '1 minute',153) as returned_15 \gset
select public.admin_record_order_claim_origin_collection(pg_temp.wsr_id('claim',15),pg_temp.wsr_id('shipment-15',2),'TEST 고객 반송 상자 입고',
 (clock_timestamp() at time zone 'Asia/Seoul')::date) as collected_15;
reset role;
select 1/case when (select collected_at is not null from public.order_claim_collections where claim_id=pg_temp.wsr_id('claim',15) and shipment_id=pg_temp.wsr_id('shipment-15',2))
 and (select used_kind='claim_collection' and used_ref=pg_temp.wsr_id('claim',15) from private.warehouse_stop_replies where id=(:'returned_15'::jsonb->'replyIds'->>0)::uuid)
 and private.warehouse_stop_status(pg_temp.wsr_id('shipment-15',2))='used'
 then 1 else 0 end as assert_retention_check_requires_warehouse_reply;

-- (2) 주문 16: 출고 중단 회신을 남겼는데 창고 운송장이 반입돼 발송됐다 → 그 회신은 무효다. 배송 건이 발송 대기로 돌아와도(되돌리기 흉내) 취소 근거가 아니다.
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.reply(array[pg_temp.wsr_id('shipment-16',1)],'stopped',clock_timestamp(),161) as stopped_16 \gset
select public.admin_import_shipment_tracking(pg_temp.wsr_id('shipment-16',1)::text,'hanjin','4200000161');
reset role;
select 1/case when (select superseded_reason='dispatched' and superseded_at is not null and used_at is null
   from private.warehouse_stop_replies where id=(:'stopped_16'::jsonb->'replyIds'->>0)::uuid)
 then 1 else 0 end as assert_dispatch_supersedes_unused_reply;
set local session_replication_role = replica;
update public.order_shipments set status='ready', shipped_at=null, carrier=null, tracking_number=null where id=pg_temp.wsr_id('shipment-16',1);
update public.orders set status='confirmed', shipped_at=null where id=pg_temp.wsr_id('order',16);
set local session_replication_role = origin;
select 1/case when private.warehouse_stop_status(pg_temp.wsr_id('shipment-16',1))='required' then 1 else 0 end as assert_superseded_reply_is_not_current;
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_start_order_cancellation(%L,%L,null,true)',pg_temp.wsr_id('order',16),'customer_request'),'warehouse_stop_reply_required');
select public.admin_order_warehouse_stop_context(pg_temp.wsr_id('order',16)) as context_16 \gset
reset role;
select 1/case when :'context_16'::jsonb->'shipments'->0->'replies'->0->>'supersededReason'='dispatched'
 and not (:'context_16'::jsonb->'shipments'->0->'replies'->0->>'current')::boolean
 and :'context_16'::jsonb->'shipments'->0->>'stopStatus'='required'
 then 1 else 0 end as assert_context_marks_superseded_reply;

rollback;
