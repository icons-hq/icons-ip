\set ON_ERROR_STOP on
-- 상품 단위 예약 일정 일괄 변경·안내(QNA-040, 20261113004500).
-- 이 스모크가 DB 안에 고정하는 것:
--   · 권한: 미리보기·확정·결과·목록은 sales.manage 운영자만, SMS 작업은 service role만, 새 원장 표는 직접 읽기 불가
--   · 대상 = 상품(옵션 선택 판매는 고른 옵션)의 미출고 예약 배송 건. 출고지시·발송·취소·취소 처리 중·같은 날짜(마지막이 일괄 변경)·
--     다른 예약 상품 때문에 앞당겨야 하는 묶음 배송 건은 사유와 함께 제외, 개별 변경 건은 표시하고 포함(새 날짜와 같으면 '안내만'),
--     결제 대기도 포함
--   · 접수 중 예약 조건: 확정 때 교체(남은 물량·기간을 이어받은 새 버전) 또는 그대로 둔다는 확인이 필요, 접수 종료일보다 이른 날짜는 교체 불가
--   · 지연 탭 이력·읽기에 안내 종류와 일괄 변경 ID
--   · 이메일 발송 설정이 꺼져 있으면 일정도 바꾸지 않는다. 미리보기 지문이 달라지면 거절한다
--   · 확정은 배송 건 일정·변경 이력(일괄 변경 ID)·주문 감사·안내 대상(구매자·선물 받는 분)·앱 알림·이메일 대기를 한 번에 만들고,
--     같은 요청 UUID 재전송은 처음 결과를 돌려준다(이중 안내 없음). 다른 내용의 같은 UUID는 거절한다
--   · 일정 변경 안내의 대상 변경 판정(배송 건 출고·일정 재변경)과, 지연 탭 안내 결과가 일정 변경 안내를 세지 않음
--   · SMS: DB 설정이 꺼져 있으면 대기열을 만들지 않고, 켜져 있으면 대상마다 한 번, 보낼 때 대상 변경·수신 동의를 다시 본다
-- 실제 고객 자료·운영 설정은 바꾸지 않는다(트랜잭션 끝에서 되돌림).
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.ps_id(kind text,n integer) returns uuid language sql immutable as $$
 select md5('preorder-schedule-bulk:'||kind||':'||n)::uuid$$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if position(expected in sqlerrm)>0 or sqlstate=expected then return; end if; raise;
 end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;

-- ---------------------------------------------------------------------------
-- 봉인: 화면 RPC는 authenticated(운영자 능력은 함수 안에서), SMS 작업은 service role, 원장 표는 아무도 직접 못 읽는다.
-- ---------------------------------------------------------------------------
select 1/case when
  has_function_privilege('authenticated','public.admin_preview_goods_preorder_schedule_change(text,uuid,date)','execute')
  and not has_function_privilege('anon','public.admin_preview_goods_preorder_schedule_change(text,uuid,date)','execute')
  and not has_function_privilege('service_role','public.admin_preview_goods_preorder_schedule_change(text,uuid,date)','execute')
  and has_function_privilege('authenticated','public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean,text)','execute')
  and not has_function_privilege('anon','public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean,text)','execute')
  and not has_function_privilege('service_role','public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean,text)','execute')
  and has_function_privilege('authenticated','public.admin_read_goods_preorder_schedule_change(uuid)','execute')
  and not has_function_privilege('anon','public.admin_read_goods_preorder_schedule_change(uuid)','execute')
  and has_function_privilege('authenticated','public.admin_list_goods_preorder_schedule_changes(text)','execute')
  and not has_function_privilege('anon','public.admin_list_goods_preorder_schedule_changes(text)','execute')
  and has_function_privilege('service_role','public.claim_order_delay_sms_jobs(integer)','execute')
  and not has_function_privilege('authenticated','public.claim_order_delay_sms_jobs(integer)','execute')
  and not has_function_privilege('anon','public.claim_order_delay_sms_jobs(integer)','execute')
  and has_function_privilege('service_role','public.finish_order_delay_sms_job(uuid,uuid,text,text)','execute')
  and not has_function_privilege('authenticated','public.finish_order_delay_sms_job(uuid,uuid,text,text)','execute')
  and not has_table_privilege('authenticated','private.goods_preorder_schedule_changes','select')
  and not has_table_privilege('service_role','private.goods_preorder_schedule_changes','select')
  and not has_table_privilege('service_role','private.order_delay_notice_sms_jobs','select,update')
  and not has_table_privilege('authenticated','private.order_delay_notice_sms_jobs','select')
  and (select count(*) from private.operator_rpc_contracts where signature in (
    'public.admin_preview_goods_preorder_schedule_change(text,uuid,date)',
    'public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean,text)',
    'public.admin_read_goods_preorder_schedule_change(uuid)',
    'public.admin_list_goods_preorder_schedule_changes(text)') and capability='sales.manage')=4
  and (select sms_enabled=false from private.order_delay_notice_delivery_control where singleton)
then 1 else 0 end as assert_sealed_acl_contracts_and_sms_off;

-- ---------------------------------------------------------------------------
-- 합성 fixture
-- ---------------------------------------------------------------------------
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.ps_id('user',n),'authenticated','authenticated',case when n=7 then null else 'preorder-schedule-'||n||'@example.test' end,
  now(),'{}','{}',now(),now() from generate_series(1,7) n;
-- 1 운영자(primary), 2 다른 업무 운영자(deputy: sales.manage 없음), 3·4·5 구매자, 6 선물 받는 분, 7 이메일 없는 구매자
update public.profiles set role='staff',nickname='예약일정운영'||right(id::text,2) where id in (pg_temp.ps_id('user',1),pg_temp.ps_id('user',2));
update public.profiles set nickname='예약일정고객'||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in (pg_temp.ps_id('user',3),pg_temp.ps_id('user',4),pg_temp.ps_id('user',5),pg_temp.ps_id('user',6),pg_temp.ps_id('user',7));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ps_id('user',1),'primary'),(pg_temp.ps_id('user',2),'deputy');
insert into public.verticals(key,label,color) values('preorder-schedule-tests','예약 일정 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('preorder-schedule-tests','예약 일정 검증','preorder-schedule-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values(pg_temp.ps_id('origin',1),'preorder-schedule-origin','예약 일정 검증 출고지','hanjin',0,null,'합성 반송 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('ps-main','preorder-schedule-tests','예약 일정 메인','문구',10000,'ok',0),
 ('ps-other','preorder-schedule-tests','함께 묶는 다른 예약','문구',5000,'ok',0),
 ('ps-random','preorder-schedule-tests','랜덤 예약','문구',5000,'ok',0);
insert into public.goods_variants(good_id,name,code,price,attributes,sort_order)
 values('ps-main','늦은 옵션','PS-MAIN-B',10000,'{"구성":"늦은 옵션"}',1);
select id as main_a from public.goods_variants where good_id='ps-main' and is_default \gset
select id as main_b from public.goods_variants where good_id='ps-main' and not is_default \gset
select id as other_v from public.goods_variants where good_id='ps-other' and is_default \gset
select (now() at time zone 'Asia/Seoul')::date as d0 \gset
-- 옵션마다 활성 예약 조건(접수 중). 메인 A는 d0+10, 메인 B는 d0+20.
insert into private.goods_preorder_policies(id,variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
 values(pg_temp.ps_id('policy',1),:'main_a','active',100,now()-interval '1 day',now()+interval '3 days',:'d0'::date+10,'TEST-ONLY 승인',pg_temp.ps_id('user',1),pg_temp.ps_id('user',1),now()),
  (pg_temp.ps_id('policy',2),:'main_b','active',100,now()-interval '1 day',now()+interval '3 days',:'d0'::date+20,'TEST-ONLY 승인',pg_temp.ps_id('user',1),pg_temp.ps_id('user',1),now()),
  (pg_temp.ps_id('policy',3),:'other_v','active',100,now()-interval '1 day',now()+interval '3 days',:'d0'::date+30,'TEST-ONLY 승인',pg_temp.ps_id('user',1),pg_temp.ps_id('user',1),now());
update public.goods_variants set preorder_policy_id=pg_temp.ps_id('policy',1) where id=:'main_a';
update public.goods_variants set preorder_policy_id=pg_temp.ps_id('policy',2) where id=:'main_b';
update public.goods_variants set preorder_policy_id=pg_temp.ps_id('policy',3) where id=:'other_v';

-- n번 주문: 구매자·상태·결제수단과 배송 건 하나. 품목은 따로 더한다.
create function pg_temp.ps_order(n integer,buyer integer,status public.order_status,method public.order_payment_method default 'card') returns uuid
language plpgsql as $$
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at,payment_method) values(pg_temp.ps_id('order',n),pg_temp.ps_id('user',buyer),status,10000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',
  case when status in ('confirmed','shipping') then now()-interval '1 day' end,method);
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
  values(pg_temp.ps_id('shipment',n),pg_temp.ps_id('order',n),pg_temp.ps_id('origin',1),'예약 일정 검증 출고지',0,'{}');
 return pg_temp.ps_id('order',n);
end $$;
-- 예약 품목: 정책 원장 대신 품목 스냅샷을 합성한다(품목 동결 트리거 밖에서).
create function pg_temp.ps_item(n integer,item integer,good text,variant uuid,policy integer,ship date) returns void language plpgsql as $$
declare item_id uuid:=pg_temp.ps_id('item',n*10+item);
begin
 insert into public.order_items(id,order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(item_id,pg_temp.ps_id('order',n),good,1,10000,good,'문구','preorder-schedule-tests',variant);
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(pg_temp.ps_id('order',n),pg_temp.ps_id('shipment',n),item_id,1);
 set local session_replication_role=replica;
 update public.order_items set supply_source='preorder',preorder_policy_id=pg_temp.ps_id('policy',policy),preorder_expected_ship_date=ship,
  preorder_snapshot=jsonb_build_object('policyId',pg_temp.ps_id('policy',policy),'policyRevision',1,'startsAt','2026-01-01T00:00:00Z','endsAt','2026-01-02T00:00:00Z','expectedShipDate',ship::text)
  where id=item_id;
 set local session_replication_role=origin;
end $$;
create function pg_temp.ps_promise(n integer) returns void language plpgsql as $$begin
 update public.order_shipments s set original_expected_ship_date=(select max(i.preorder_expected_ship_date) from public.order_shipment_items l join public.order_items i on i.id=l.order_item_id where l.shipment_id=s.id),
  expected_ship_date=(select max(i.preorder_expected_ship_date) from public.order_shipment_items l join public.order_items i on i.id=l.order_item_id where l.shipment_id=s.id)
  where s.id=pg_temp.ps_id('shipment',n);
end $$;

-- 1 결제 완료 · 메인 A
select pg_temp.ps_order(1,3,'paid');
select pg_temp.ps_item(1,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(1);
-- 2 발주확인 · 메인 A · 운영자가 배송 건을 d0+12로 개별 변경
select pg_temp.ps_order(2,4,'confirmed');
select pg_temp.ps_item(2,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(2);
insert into private.order_shipment_promise_changes(shipment_id,from_date,to_date,reason,actor_id) values(pg_temp.ps_id('shipment',2),:'d0'::date+10,:'d0'::date+12,'TEST 개별 변경',pg_temp.ps_id('user',1));
update public.order_shipments set expected_ship_date=:'d0'::date+12 where id=pg_temp.ps_id('shipment',2);
-- 3 출고지시된 배송 건
select pg_temp.ps_order(3,3,'paid');
select pg_temp.ps_item(3,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(3);
set local session_replication_role=replica;
update public.order_shipments set exported_at=now(),exported_by=pg_temp.ps_id('user',1) where id=pg_temp.ps_id('shipment',3);
set local session_replication_role=origin;
-- 4 발송된 배송 건
select pg_temp.ps_order(4,3,'shipping');
select pg_temp.ps_item(4,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(4);
set local session_replication_role=replica;
update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='PSBULK0004',shipped_at=now() where id=pg_temp.ps_id('shipment',4);
set local session_replication_role=origin;
-- 5 취소 처리 중
select pg_temp.ps_order(5,4,'paid');
select pg_temp.ps_item(5,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(5);
insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values(pg_temp.ps_id('order',5),pg_temp.ps_id('user',4),'paid');
-- 6 취소된 주문
select pg_temp.ps_order(6,4,'paid');
select pg_temp.ps_item(6,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(6);
set local session_replication_role=replica;
update public.orders set status='canceled' where id=pg_temp.ps_id('order',6);
update public.order_shipments set status='canceled' where id=pg_temp.ps_id('shipment',6);
set local session_replication_role=origin;
-- 7 다른 예약 상품(d0+30)과 묶음 — 새 날짜 d0+15로는 바뀌지 않는다
select pg_temp.ps_order(7,5,'paid');
select pg_temp.ps_item(7,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_item(7,2,'ps-other',:'other_v',3,:'d0'::date+30); select pg_temp.ps_promise(7);
-- 8 다른 예약 상품(d0+12)과 묶음 — d0+15로 미룬다
select pg_temp.ps_order(8,5,'paid');
select pg_temp.ps_item(8,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_item(8,2,'ps-other',:'other_v',3,:'d0'::date+12); select pg_temp.ps_promise(8);
-- 9 무통장 입금 대기 · 메인 A
select pg_temp.ps_order(9,5,'pending','bank_transfer');
select pg_temp.ps_item(9,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(9);
-- 10 선물 주문(받는 분 6) · 메인 A
select pg_temp.ps_order(10,3,'paid');
select pg_temp.ps_item(10,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(10);
set local session_replication_role=replica;
insert into private.gift_intents(id,sender_id,recipient_id,state,message,sender_label,expires_at,order_id,ordered_source_revision,accepted_at)
 values(pg_temp.ps_id('gift',10),pg_temp.ps_id('user',3),pg_temp.ps_id('user',6),'ordered','','보낸 분',now()+interval '7 days',pg_temp.ps_id('order',10),'test',now());
set local session_replication_role=origin;
-- 11 메인 B(d0+20)
select pg_temp.ps_order(11,4,'paid');
select pg_temp.ps_item(11,1,'ps-main',:'main_b',2,:'d0'::date+20); select pg_temp.ps_promise(11);
-- 12 이메일 없는 구매자 · 메인 A
select pg_temp.ps_order(12,7,'paid');
select pg_temp.ps_item(12,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(12);
-- 14 메인 A · 운영자가 배송 건을 새 날짜(d0+15)로 이미 개별 변경 — 고객은 모른다(안내만 대상)
select pg_temp.ps_order(14,5,'paid');
select pg_temp.ps_item(14,1,'ps-main',:'main_a',1,:'d0'::date+10); select pg_temp.ps_promise(14);
insert into private.order_shipment_promise_changes(shipment_id,from_date,to_date,reason,actor_id) values(pg_temp.ps_id('shipment',14),:'d0'::date+10,:'d0'::date+15,'TEST 개별 변경',pg_temp.ps_id('user',1));
update public.order_shipments set expected_ship_date=:'d0'::date+15 where id=pg_temp.ps_id('shipment',14);
-- 다른 상품만 든 주문(대상 아님)
select pg_temp.ps_order(13,5,'paid');
select pg_temp.ps_item(13,1,'ps-other',:'other_v',3,:'d0'::date+30); select pg_temp.ps_promise(13);

create temp table ps_money as select id,total,status from public.orders where id in (select pg_temp.ps_id('order',n) from generate_series(1,14) n);
grant select on ps_money to authenticated;

-- ---------------------------------------------------------------------------
-- 권한: sales.manage가 없는 운영자·고객은 미리보기·확정을 못 한다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',2));
select pg_temp.expect_error(format('select public.admin_preview_goods_preorder_schedule_change(%L,null,%L)','ps-main',(:'d0'::date+15)::text),'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L)',
 pg_temp.ps_id('request',99),'ps-main',(:'d0'::date+15)::text,'사유','제목','본문',repeat('0',32)),'operator_capability_required');
select pg_temp.as_actor(pg_temp.ps_id('user',3));
select pg_temp.expect_error(format('select public.admin_preview_goods_preorder_schedule_change(%L,null,%L)','ps-main',(:'d0'::date+15)::text),'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_read_goods_preorder_schedule_change(%L)',pg_temp.ps_id('request',99)),'operator_capability_required');

-- ---------------------------------------------------------------------------
-- 미리보기: 대상·제외 사유·표시
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select pg_temp.expect_error(format('select public.admin_preview_goods_preorder_schedule_change(%L,null,%L)','ps-main',(:'d0'::date-1)::text),'invalid_preorder_schedule_change');
select pg_temp.expect_error(format('select public.admin_preview_goods_preorder_schedule_change(%L,null,%L)','ps-missing',(:'d0'::date+15)::text),'good_not_found');
select pg_temp.expect_error(format('select public.admin_preview_goods_preorder_schedule_change(%L,%L,%L)','ps-main',:'other_v',(:'d0'::date+15)::text),'goods_variant_not_found');
select public.admin_preview_goods_preorder_schedule_change('ps-main',null,:'d0'::date+15) as preview \gset
create temp table ps_preview_targets as select value from jsonb_array_elements(:'preview'::jsonb->'targets') value;
create temp table ps_preview_excluded as select value from jsonb_array_elements(:'preview'::jsonb->'excluded') value;
select 1/case when (:'preview'::jsonb->>'targetShipments')::int=8 and (:'preview'::jsonb->>'targetOrders')::int=8
 and (select array_agg((value->>'shipmentId')::uuid order by value->>'shipmentId') from ps_preview_targets)
  =(select array_agg(pg_temp.ps_id('shipment',n) order by pg_temp.ps_id('shipment',n)::text) from unnest(array[1,2,8,9,10,11,12,14]) n)
 and (select value->>'reason' from ps_preview_excluded where value->>'shipmentId'=pg_temp.ps_id('shipment',3)::text)='exported'
 and (select value->>'reason' from ps_preview_excluded where value->>'shipmentId'=pg_temp.ps_id('shipment',4)::text)='shipped'
 and (select value->>'reason' from ps_preview_excluded where value->>'shipmentId'=pg_temp.ps_id('shipment',5)::text)='cancellation_in_progress'
 and (select value->>'reason' from ps_preview_excluded where value->>'shipmentId'=pg_temp.ps_id('shipment',6)::text)='canceled'
 and (select value->>'reason' from ps_preview_excluded where value->>'shipmentId'=pg_temp.ps_id('shipment',7)::text)='unchanged'
 and not exists(select 1 from ps_preview_excluded where value->>'shipmentId'=pg_temp.ps_id('shipment',13)::text)
 and (:'preview'::jsonb->>'excludedTotal')::int=5
 and :'preview'::jsonb->'excludedCounts'=jsonb_build_object('exported',1,'shipped',1,'cancellation_in_progress',1,'canceled',1,'unchanged',1)
 then 1 else 0 end as assert_targets_and_exclusion_reasons;
select 1/case when (select (value->>'individuallyChanged')::boolean and value->>'currentDate'=(:'d0'::date+12)::text and value->>'newDate'=(:'d0'::date+15)::text
   from ps_preview_targets where value->>'shipmentId'=pg_temp.ps_id('shipment',2)::text)
 and (select (value->>'otherPreorder')::boolean and value->>'newDate'=(:'d0'::date+15)::text and value->>'currentDate'=(:'d0'::date+12)::text
   from ps_preview_targets where value->>'shipmentId'=pg_temp.ps_id('shipment',8)::text)
 and (select value->>'orderStatus'='pending' and value->>'paymentMethod'='bank_transfer' from ps_preview_targets where value->>'shipmentId'=pg_temp.ps_id('shipment',9)::text)
 and (select value->>'currentDate'=(:'d0'::date+20)::text and value->>'newDate'=(:'d0'::date+15)::text from ps_preview_targets where value->>'shipmentId'=pg_temp.ps_id('shipment',11)::text)
 and (select count(*) from ps_preview_targets where not (value->>'individuallyChanged')::boolean)=6
 and (select (value->>'noticeOnly')::boolean and (value->>'individuallyChanged')::boolean and value->>'currentDate'=value->>'newDate'
   and value->>'knownDate'=(:'d0'::date+10)::text from ps_preview_targets where value->>'shipmentId'=pg_temp.ps_id('shipment',14)::text)
 and (select count(*) from ps_preview_targets where (value->>'noticeOnly')::boolean)=1
 and :'preview' not like '%@example.test%' and :'preview' not like '%예약일정고객%'
 and (:'preview'::jsonb->>'emailEnabled')::boolean=false and (:'preview'::jsonb->>'smsEnabled')::boolean=false
 and (:'preview'::jsonb->>'randomSale')::boolean=false and :'preview'::jsonb->>'fingerprint' ~ '^[0-9a-f]{32}$'
 and jsonb_array_length(:'preview'::jsonb->'openPolicies')=2 and :'preview'::jsonb->>'policyBlockReason' is null
 and (:'preview'::jsonb->>'canReplacePolicies')::boolean and (:'preview'::jsonb->>'limit')::int=3000
 and (select bool_and((policy->>'remainingQty')::int=100) from jsonb_array_elements(:'preview'::jsonb->'openPolicies') policy)
 then 1 else 0 end as assert_flags_minimal_customer_data_and_open_policies;
-- 옵션 선택 판매는 옵션 하나로 좁힐 수 있다. 다른 옵션의 품목은 '다른 예약 상품'처럼 묶음 상한이 된다.
select public.admin_preview_goods_preorder_schedule_change('ps-main',:'main_b',:'d0'::date+25) as variant_preview \gset
select 1/case when (:'variant_preview'::jsonb->>'targetShipments')::int=1
 and :'variant_preview'::jsonb#>>'{targets,0,shipmentId}'=pg_temp.ps_id('shipment',11)::text
 and :'variant_preview'::jsonb->>'variantName'='늦은 옵션'
 and jsonb_array_length(:'variant_preview'::jsonb->'openPolicies')=1 then 1 else 0 end as assert_variant_scope;
-- 접수 종료일보다 이른 새 날짜로는 접수 중 조건을 교체할 수 없다(활성화 규칙). 확인하고 그대로 두는 것만 가능하다.
select public.admin_preview_goods_preorder_schedule_change('ps-main',null,:'d0'::date+1) as early_preview \gset
select 1/case when :'early_preview'::jsonb->>'policyBlockReason'='before_sale_end' then 1 else 0 end as assert_policy_block_before_sale_end;
-- 랜덤 판매 상품은 옵션 하나만 바꿀 수 없다.
reset role;
set local session_replication_role=replica;
update public.goods set option_sale_mode='random' where id='ps-random';
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select pg_temp.expect_error(format('select public.admin_preview_goods_preorder_schedule_change(%L,%L,%L)','ps-random',
 (select id from public.goods_variants where good_id='ps-random' and is_default),(:'d0'::date+15)::text),'preorder_schedule_random_whole_good');
select 1/case when (public.admin_preview_goods_preorder_schedule_change('ps-random',null,:'d0'::date+15)->>'randomSale')::boolean
 and (public.admin_preview_goods_preorder_schedule_change('ps-random',null,:'d0'::date+15)->>'targetShipments')::int=0
 then 1 else 0 end as assert_random_whole_good;

-- ---------------------------------------------------------------------------
-- 이메일 발송 설정이 꺼져 있으면 일정도 바꾸지 않는다.
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'TEST 공급 지연','예약 발송 일정 변경 안내','입고가 늦어져 발송 예정일을 바꿉니다.',
 :'preview'::jsonb->>'fingerprint'),'delay_notice_delivery_disabled');
reset role;
select 1/case when (select expected_ship_date from public.order_shipments where id=pg_temp.ps_id('shipment',1))=:'d0'::date+10
 and not exists(select 1 from private.goods_preorder_schedule_changes) then 1 else 0 end as assert_disabled_email_changes_nothing;
-- 합성 트랜잭션 안에서만 켠다.
update private.order_delay_notice_delivery_control set enabled=true where singleton;
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));

-- 잘못된 입력·지문은 거절한다.
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,' ','제목','본문',:'preview'::jsonb->>'fingerprint'),'invalid_preorder_schedule_change');
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'사유','제목',repeat('가',351),:'preview'::jsonb->>'fingerprint'),'invalid_preorder_schedule_change');
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'사유','제목','본문',md5('stale')),'preorder_schedule_stale');
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[])',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'사유','제목','본문',:'preview'::jsonb->>'fingerprint',
 array[pg_temp.ps_id('shipment',3)]::text),'invalid_preorder_schedule_change');
-- 접수 중 조건이 있으면 교체·확인 중 하나를 골라야 하고, 접수 종료일보다 이른 날짜는 교체할 수 없다.
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[])',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'사유','제목','본문',:'preview'::jsonb->>'fingerprint','{}'),'preorder_schedule_policy_decision_required');
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[],false,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'사유','제목','본문',:'preview'::jsonb->>'fingerprint','{}','both'),'invalid_preorder_schedule_change');
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[],false,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+1)::text,'사유','제목','본문',:'early_preview'::jsonb->>'fingerprint','{}','replace'),'preorder_schedule_policy_not_replaceable');
reset role;
select 1/case when not exists(select 1 from private.goods_preorder_schedule_changes)
 and not exists(select 1 from private.order_delay_notices where kind='preorder_schedule')
 and (select count(*) from private.goods_preorder_policies where id in (pg_temp.ps_id('policy',1),pg_temp.ps_id('policy',2)) and state='active')=2
 then 1 else 0 end as assert_rejections_leave_no_ledger;
-- 레거시 직원(활성화 권한 없음)은 교체를 고를 수 없고 미리보기도 그렇게 알린다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(pg_temp.ps_id('user',8),'authenticated','authenticated','preorder-schedule-8@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id=pg_temp.ps_id('user',8);
insert into private.operator_legacy_cohort(profile_id,legacy_role) values(pg_temp.ps_id('user',8),'staff');
update private.operator_access_state set configured=false where id;
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',8));
select 1/case when not (public.admin_preview_goods_preorder_schedule_change('ps-main',null,:'d0'::date+15)->>'canReplacePolicies')::boolean
 then 1 else 0 end as assert_legacy_staff_cannot_replace_policies;
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[],false,%L)',
 pg_temp.ps_id('request',97),'ps-main',(:'d0'::date+15)::text,'사유','제목','본문',:'preview'::jsonb->>'fingerprint','{}','replace'),'preorder_admin_required');
reset role;

-- ---------------------------------------------------------------------------
-- 확정: 개별 변경 건(2)은 운영자가 뺀다. SMS 요청이 있어도 DB 설정이 꺼져 있으면 대기열이 없다.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select public.admin_apply_goods_preorder_schedule_change(pg_temp.ps_id('request',1),'ps-main',null,:'d0'::date+15,' TEST 공급 지연 ',
 '예약 발송 일정 변경 안내',' 입고가 늦어져 발송 예정일을 바꿉니다. ',:'preview'::jsonb->>'fingerprint',array[pg_temp.ps_id('shipment',2)],true,'replace') as applied \gset
select public.admin_apply_goods_preorder_schedule_change(pg_temp.ps_id('request',1),'ps-main',null,:'d0'::date+15,'TEST 공급 지연',
 '예약 발송 일정 변경 안내','입고가 늦어져 발송 예정일을 바꿉니다.',:'preview'::jsonb->>'fingerprint',array[pg_temp.ps_id('shipment',2),pg_temp.ps_id('shipment',2)],true,'replace') as replayed \gset
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[],true,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'TEST 공급 지연','예약 발송 일정 변경 안내','다른 본문',:'preview'::jsonb->>'fingerprint',
 array[pg_temp.ps_id('shipment',2)]::text,'replace'),'preorder_schedule_idempotency_conflict');
select 1/case when :'applied'::jsonb=:'replayed'::jsonb
 and (:'applied'::jsonb->>'shipmentCount')::int=7 and (:'applied'::jsonb->>'orderCount')::int=7 and (:'applied'::jsonb->>'excludedCount')::int=1
 and :'applied'::jsonb->>'policyAction'='replaced' and jsonb_array_length(:'applied'::jsonb->'policies')=2
 and (:'applied'::jsonb->>'smsQueued')::boolean=false and :'applied'::jsonb->>'requestedAt' is not null
 and jsonb_array_length(:'applied'::jsonb->'targets')=8
 and (select count(*) from jsonb_array_elements(:'applied'::jsonb->'targets') t where t->>'audience'='recipient')=1
 and (select bool_and(t->>'inAppStatus'='sent') from jsonb_array_elements(:'applied'::jsonb->'targets') t)
 and (select t->>'emailStatus'='suppressed' and not (t->>'hasEmail')::boolean and t->>'errorCode'='recipient_missing'
   from jsonb_array_elements(:'applied'::jsonb->'targets') t where t->>'orderId'=pg_temp.ps_id('order',12)::text)
 and (select count(*) from jsonb_array_elements(:'applied'::jsonb->'targets') t where t->>'emailStatus'='queued')=7
 and (select (t#>>'{shipments,0,noticeOnly}')::boolean and t#>>'{shipments,0,fromDate}'=t#>>'{shipments,0,toDate}'
   from jsonb_array_elements(:'applied'::jsonb->'targets') t where t->>'orderId'=pg_temp.ps_id('order',14)::text)
 and (select t#>>'{shipments,0,fromDate}'=(:'d0'::date+12)::text and t#>>'{shipments,0,toDate}'=(:'d0'::date+15)::text
   from jsonb_array_elements(:'applied'::jsonb->'targets') t where t->>'orderId'=pg_temp.ps_id('order',8)::text)
 and :'applied' not like '%@example.test%' and :'applied'::jsonb->>'reason'='TEST 공급 지연'
 then 1 else 0 end as assert_apply_document_and_replay;
-- 다른 운영자의 같은 요청 UUID도 거절한다.
reset role;
update public.profiles set role='staff' where id=pg_temp.ps_id('user',2);
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.ps_id('user',2);
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',2));
select pg_temp.expect_error(format('select public.admin_apply_goods_preorder_schedule_change(%L,%L,null,%L,%L,%L,%L,%L,%L::uuid[],true,%L)',
 pg_temp.ps_id('request',1),'ps-main',(:'d0'::date+15)::text,'TEST 공급 지연','예약 발송 일정 변경 안내','입고가 늦어져 발송 예정일을 바꿉니다.',
 :'preview'::jsonb->>'fingerprint',array[pg_temp.ps_id('shipment',2)]::text,'replace'),'preorder_schedule_idempotency_conflict');
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.ps_id('user',2);

-- 배송 건 일정 변경 이력 읽기: 일괄 변경 ID와 '안내만' 여부(일정 그대로 안내한 행만 true)
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select 1/case when true
 and (select (c->>'noticeOnly')::boolean and c->>'bulkChangeId'=pg_temp.ps_id('request',1)::text and c->>'fromDate'=c->>'toDate'
   from jsonb_array_elements(public.admin_list_shipment_promise_changes(pg_temp.ps_id('shipment',14))) c where c->>'bulkChangeId' is not null)
 and (select not (c->>'noticeOnly')::boolean and c->>'bulkChangeId'=pg_temp.ps_id('request',1)::text
   from jsonb_array_elements(public.admin_list_shipment_promise_changes(pg_temp.ps_id('shipment',11))) c where c->>'bulkChangeId' is not null)
 and (select not (c->>'noticeOnly')::boolean and c->>'bulkChangeId' is null
   from jsonb_array_elements(public.admin_list_shipment_promise_changes(pg_temp.ps_id('shipment',14))) c where c->>'bulkChangeId' is null)
 then 1 else 0 end as assert_promise_changes_expose_bulk_and_notice_only;
reset role;
-- 원장: 배송 건 일정·이력·감사·안내 대상·앱 알림
select (:'applied'::jsonb->>'noticeId')::uuid as notice_id \gset
select 1/case when (select array_agg(id order by id) from public.order_shipments where expected_ship_date=:'d0'::date+15
   and id in (select pg_temp.ps_id('shipment',n) from generate_series(1,14) n))
  =(select array_agg(pg_temp.ps_id('shipment',n) order by pg_temp.ps_id('shipment',n)) from unnest(array[1,8,9,10,11,12,14]) n)
 and (select expected_ship_date from public.order_shipments where id=pg_temp.ps_id('shipment',2))=:'d0'::date+12
 and (select expected_ship_date from public.order_shipments where id=pg_temp.ps_id('shipment',7))=:'d0'::date+30
 and (select original_expected_ship_date from public.order_shipments where id=pg_temp.ps_id('shipment',1))=:'d0'::date+10
 and (select count(*) from private.order_shipment_promise_changes where bulk_change_id=pg_temp.ps_id('request',1) and reason='TEST 공급 지연'
   and actor_id=pg_temp.ps_id('user',1))=7
 and (select from_date=:'d0'::date+15 and to_date=:'d0'::date+15 from private.order_shipment_promise_changes
   where bulk_change_id=pg_temp.ps_id('request',1) and shipment_id=pg_temp.ps_id('shipment',14))
 and (select from_date=:'d0'::date+20 and to_date=:'d0'::date+15 from private.order_shipment_promise_changes
   where bulk_change_id=pg_temp.ps_id('request',1) and shipment_id=pg_temp.ps_id('shipment',11))
 and (select count(*) from public.audit_log where action='admin.shipment.preorder_promise_changed' and diff->>'trigger'='goods_preorder_bulk'
   and diff->>'bulkChangeId'=pg_temp.ps_id('request',1)::text and diff->>'noticeId'=:'notice_id' and actor_id=pg_temp.ps_id('user',1))=7
 and exists(select 1 from public.audit_log where action='admin.good.preorder_schedule_changed' and target='goods:ps-main'
   and diff->>'changeId'=pg_temp.ps_id('request',1)::text and (diff->>'shipments')::int=7 and (diff->>'noticeOnly')::int=1 and (diff->>'excluded')::int=1
   and diff->>'policyAction'='replaced')
 and (select kind='preorder_schedule' and expected_ship_date=:'d0'::date+15 and requested_at is not null and cardinality(shipment_ids)=7
   from private.order_delay_notices where id=:'notice_id')
 and (select count(*) from public.notifications where source_type='order_delay_notice' and type='announcement'
   and source_id in (select id::text from private.order_delay_notice_targets where notice_id=:'notice_id'))=8
 and (select n.body from public.notifications n join private.order_delay_notice_targets t on t.id::text=n.source_id
   where t.notice_id=:'notice_id' and t.order_id=pg_temp.ps_id('order',14)) like '%발송 예정일: '||(:'d0'::date+10)::text||' → '||(:'d0'::date+15)::text||'%'
 and exists(select 1 from public.notifications n join private.order_delay_notice_targets t on t.id::text=n.source_id
   where t.notice_id=:'notice_id' and t.audience='recipient' and n.user_id=pg_temp.ps_id('user',6) and n.link_path='/gifts')
 and (select n.body from public.notifications n join private.order_delay_notice_targets t on t.id::text=n.source_id
   where t.notice_id=:'notice_id' and t.order_id=pg_temp.ps_id('order',1) and t.audience='payer')
   like '입고가 늦어져 발송 예정일을 바꿉니다.'||E'\n\n'||'발송 예정일: '||(:'d0'::date+10)::text||' → '||(:'d0'::date+15)::text||E'\n'||'안내 대상 배송 건: %'
 and (select array_agg(id order by id) from ps_money)=(select array_agg(o.id order by o.id) from public.orders o join ps_money m on m.id=o.id and m.total=o.total and m.status=o.status)
 then 1 else 0 end as assert_ledger_history_audit_and_inbox;
-- 접수 중 조건은 남은 물량·접수 기간을 이어받은 새 날짜 버전으로 바뀌고 옛 버전은 중지된다.
select 1/case when (select count(*) from private.goods_preorder_policies where id in (pg_temp.ps_id('policy',1),pg_temp.ps_id('policy',2)) and state='stopped')=2
 and (select bool_and(policy.state='active' and policy.expected_ship_date=:'d0'::date+15 and policy.capacity_qty=100
    and policy.starts_at=old.starts_at and policy.ends_at=old.ends_at and policy.approval_reference like 'TEST-ONLY 승인%발송 예정일 변경%TEST 공급 지연')
   from public.goods_variants v join private.goods_preorder_policies policy on policy.id=v.preorder_policy_id
   join private.goods_preorder_policies old on old.variant_id=v.id and old.id in (pg_temp.ps_id('policy',1),pg_temp.ps_id('policy',2))
   where v.good_id='ps-main')
 and (select count(*) from public.audit_log where action='admin.good.preorder_saved' and target='goods:ps-main')=4
 then 1 else 0 end as assert_open_policies_replaced_with_new_date;
-- 지연 탭 이력·읽기에 안내 종류와 일괄 변경 ID가 실린다(지연 탭은 일정 변경 안내를 이메일 없는 일괄 결과로 연다).
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select 1/case when (select row->>'kind'='preorder_schedule' and row->>'scheduleChangeId'=pg_temp.ps_id('request',1)::text
   from jsonb_array_elements(public.admin_list_order_delay_notices(null)) row where row->>'id'=:'notice_id')
 and public.admin_get_order_delay_notice(:'notice_id')->>'kind'='preorder_schedule'
 then 1 else 0 end as assert_delay_history_carries_kind;
reset role;

-- 같은 날짜로 다시 미리보면 이미 바꾼 건은 '같은 날짜', 개별 변경 건(2)은 여전히 대상이다. 재확정이 이중 안내를 만들지 않는다.
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select public.admin_preview_goods_preorder_schedule_change('ps-main',null,:'d0'::date+15) as again \gset
select 1/case when (:'again'::jsonb->>'targetShipments')::int=1 and :'again'::jsonb#>>'{targets,0,shipmentId}'=pg_temp.ps_id('shipment',2)::text
 and (:'again'::jsonb#>>'{targets,0,individuallyChanged}')::boolean and (:'again'::jsonb#>>'{excludedCounts,unchanged}')::int=8
 and jsonb_array_length(:'again'::jsonb->'openPolicies')=0
 and jsonb_array_length(public.admin_list_goods_preorder_schedule_changes('ps-main'))=1
 and public.admin_list_goods_preorder_schedule_changes('ps-main')#>>'{0,id}'=pg_temp.ps_id('request',1)::text
 and public.admin_read_goods_preorder_schedule_change(pg_temp.ps_id('request',1))=:'applied'::jsonb
 then 1 else 0 end as assert_rerun_only_remaining_and_history;
select pg_temp.expect_error(format('select public.admin_read_goods_preorder_schedule_change(%L)',pg_temp.ps_id('request',98)),'preorder_schedule_change_not_found');
reset role;

-- 일정 변경 안내의 대상 변경 판정: 일정이 그대로면 유효, 출고되거나 일정이 다시 바뀌면 낡은 안내다.
select t.id as payer_target from private.order_delay_notice_targets t where t.notice_id=:'notice_id' and t.order_id=pg_temp.ps_id('order',1) \gset
select t.id as pending_target from private.order_delay_notice_targets t where t.notice_id=:'notice_id' and t.order_id=pg_temp.ps_id('order',9) \gset
update public.orders set status='paid' where id=pg_temp.ps_id('order',9);
select 1/case when private.order_delay_notice_target_current(:'payer_target') and private.order_delay_notice_target_current(:'pending_target')
 then 1 else 0 end as assert_payment_does_not_stale_schedule_notice;
set local session_replication_role=replica;
update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='PSBULK0001',shipped_at=now() where id=pg_temp.ps_id('shipment',1);
set local session_replication_role=origin;
update public.order_shipments set expected_ship_date=:'d0'::date+16 where id=pg_temp.ps_id('shipment',9);
select 1/case when not private.order_delay_notice_target_current(:'payer_target') and not private.order_delay_notice_target_current(:'pending_target')
 then 1 else 0 end as assert_shipped_or_rescheduled_target_is_stale;
-- 지연 탭의 안내 결과는 발송 지연 안내만 센다.
select 1/case when private.shipment_delay_notice_summary(pg_temp.ps_id('shipment',8))->>'status'='not_sent' then 1 else 0 end as assert_delay_summary_ignores_schedule_notice;

-- ---------------------------------------------------------------------------
-- SMS: 설정을 켠 뒤 확정하면 대상마다 대기열 한 줄. 보낼 때 수신 동의·대상 변경을 다시 본다.
-- ---------------------------------------------------------------------------
update private.order_delay_notice_delivery_control set sms_enabled=true where singleton;
insert into private.customer_marketing_consents(user_id,channel,agreed,notice_version,source,agreed_at,revision)
 values(pg_temp.ps_id('user',4),'sms',true,'marketing-channels-v2','settings',now(),1);
set local role authenticated;
select pg_temp.as_actor(pg_temp.ps_id('user',1));
select public.admin_preview_goods_preorder_schedule_change('ps-main',null,:'d0'::date+18) as sms_preview \gset
select public.admin_apply_goods_preorder_schedule_change(pg_temp.ps_id('request',2),'ps-main',null,:'d0'::date+18,'TEST 추가 지연',
 '예약 발송 일정 변경 안내','다시 한 번 일정이 바뀌었습니다.',:'sms_preview'::jsonb->>'fingerprint','{}'::uuid[],true,'acknowledge') as sms_applied \gset
reset role;
select (:'sms_applied'::jsonb->>'noticeId')::uuid as sms_notice \gset
select 1/case when (:'sms_applied'::jsonb->>'smsQueued')::boolean
 and :'sms_applied'::jsonb->>'policyAction'='acknowledged'
 and (select count(*) from public.goods_variants v join private.goods_preorder_policies policy on policy.id=v.preorder_policy_id
   where v.good_id='ps-main' and policy.state='active' and policy.expected_ship_date=:'d0'::date+15)=2
 and (select count(*) from private.order_delay_notice_sms_jobs j join private.order_delay_notice_targets t on t.id=j.target_id
   where t.notice_id=:'sms_notice' and j.status='queued')=(select count(*) from private.order_delay_notice_targets where notice_id=:'sms_notice')
 and (select bool_and(t->>'smsStatus'='queued') from jsonb_array_elements(:'sms_applied'::jsonb->'targets') t)
 then 1 else 0 end as assert_sms_queued_per_target;
select t.id as sms_consent_target from private.order_delay_notice_targets t where t.notice_id=:'sms_notice' and t.buyer_id=pg_temp.ps_id('user',4) and t.order_id=pg_temp.ps_id('order',2) \gset
set local role service_role;
select public.claim_order_delay_sms_jobs(50) as sms_claim \gset
select 1/case when jsonb_array_length(:'sms_claim'::jsonb)>=1
 and (select bool_and(value->>'userId'=pg_temp.ps_id('user',4)::text) from jsonb_array_elements(:'sms_claim'::jsonb) value)
 and exists(select 1 from jsonb_array_elements(:'sms_claim'::jsonb) value where value->>'id'=:'sms_consent_target' and value->>'body' like '다시 한 번 일정이 바뀌었습니다.%')
 and :'sms_claim' not like '%example.test%'
 and (select bool_and((select array_agg(key order by key) from jsonb_object_keys(value) key)=array['audience','body','claimToken','id','orderId','orderNumber','title','userId'])
   from jsonb_array_elements(:'sms_claim'::jsonb) value)
 and jsonb_array_length(public.claim_order_delay_sms_jobs(50))=0
 then 1 else 0 end as assert_sms_claims_only_consented_once;
select value->>'claimToken' as sms_claim_token from jsonb_array_elements(:'sms_claim'::jsonb) value where value->>'id'=:'sms_consent_target' \gset
select 1/case when public.finish_order_delay_sms_job(:'sms_consent_target',pg_temp.ps_id('wrong',1),'sent',null)=false
 and public.finish_order_delay_sms_job(:'sms_consent_target',:'sms_claim_token','sent',null)
 and public.finish_order_delay_sms_job(:'sms_consent_target',:'sms_claim_token','sent',null)=false
 then 1 else 0 end as assert_sms_finish_fenced;
select pg_temp.expect_error(format('select public.finish_order_delay_sms_job(%L,%L,%L,null)',:'sms_consent_target',:'sms_claim_token','failed'),'invalid_delay_sms_result');
reset role;
select 1/case when (select status='sent' and sent_at is not null and attempts=1 from private.order_delay_notice_sms_jobs where target_id=:'sms_consent_target')
 and (select count(*) from private.order_delay_notice_sms_jobs j join private.order_delay_notice_targets t on t.id=j.target_id
   where t.notice_id=:'sms_notice' and j.status='skipped' and j.reason='consent_required')
  =(select count(*) from private.order_delay_notice_targets t where t.notice_id=:'sms_notice' and t.buyer_id<>pg_temp.ps_id('user',4))
 and exists(select 1 from public.audit_log where action='system.order.delay_notice_sms_result' and target='delay_notice_target:'||:'sms_consent_target' and diff->>'status'='sent')
 and (select public.admin_read_goods_preorder_schedule_change(pg_temp.ps_id('request',2))->'targets' @> jsonb_build_array(jsonb_build_object('id',:'sms_consent_target','smsStatus','sent')))
 then 1 else 0 end as assert_sms_results_recorded;
-- 처리 중 잠금이 끝난 작업은 다시 보내지 않고 결과 불명, 설정을 끄면 남은 대기 작업은 보내지 않는다.
update private.order_delay_notice_sms_jobs set status='processing',claim_token=pg_temp.ps_id('lease',1),lease_until=now()-interval '1 minute',attempts=1,sent_at=null,reason=null
 where target_id=:'sms_consent_target';
insert into private.order_delay_notice_sms_jobs(target_id) select t.id from private.order_delay_notice_targets t
 where t.notice_id=:'notice_id' and t.order_id=pg_temp.ps_id('order',8);
update private.order_delay_notice_delivery_control set sms_enabled=false where singleton;
set local role service_role;
select 1/case when jsonb_array_length(public.claim_order_delay_sms_jobs(25))=0 then 1 else 0 end as assert_disabled_sms_claims_nothing;
reset role;
select 1/case when (select status='unknown' and reason='lease_expired' and claim_token is null from private.order_delay_notice_sms_jobs where target_id=:'sms_consent_target')
 and (select status='skipped' and reason='sms_disabled' from private.order_delay_notice_sms_jobs j join private.order_delay_notice_targets t on t.id=j.target_id
   where t.notice_id=:'notice_id' and t.order_id=pg_temp.ps_id('order',8))
 then 1 else 0 end as assert_lease_expiry_unknown_and_disabled_skip;
rollback;
