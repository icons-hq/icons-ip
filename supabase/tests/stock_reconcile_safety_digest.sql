\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 재고 파일 대조와 안전재고 요약 메일 (1007-009·1007-011·QNA-014)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 대조 미리보기는 관리코드·ERP 코드·바코드·(옵션 하나인) 판매자상품코드로 옵션을 찾고,
--     못 찾은 행·같은 옵션 여러 행·키 충돌·다른 출고지·보관 상품을 반영하지 않고 사유로 남긴다
--   · 차이 = 파일 − (재고수량 + 출고 대기 + 회수 뒤 재고 미반영 + 기준 시각 뒤 출고 − 기준 시각 뒤 회수)
--     취소 주문·미배정 예약은 세지 않고, 그룹상품 교환 재출고는 출고로, 그룹상품 전환 뒤 주문은 승계 옵션으로 센다.
--     기준 시각 뒤 회수(클레임 회수·회수 기록 없는 복원)와 회수 뒤 복원 전 수량을 가른다. 기준 시각 뒤 수동 조정은 표시만 한다
--   · 확정은 잠금 뒤 다시 잰 '맞춘 뒤' 재고수량이 미리보기와 같을 때만 반영한다(QA1 S-T07-01). 미리보기 뒤 주문으로
--     맞춘 뒤 값이 바뀌거나 수동 조정이 끼면 아무것도 바꾸지 않고 바뀐 옵션(미리보기 값·지금 값·이유)을 돌려준다.
--     같으면 반영하고 결과·감사는 반영 시점 값(반영 전 재고수량·출고 대기 등)이다. 같은 옵션은 주문으로 함께 움직여도 막지 않는다
--   · 같은 확정의 재전송은 처음 결과, 다른 사유의 재확정은 거절. 옵션별·실행별 감사 기록. 상품 주소가 바뀌어도 기록이 따라간다
--   · 출고 전 경고: 최근 파일 기준 부족·차이와 대조 기록 없는 옵션(승계 옵션 기준)
--   · 요약 메일: 기본 꺼짐, 설정 시각 전에는 만들지 않고 날짜당 한 번, 운영자 전체·출고지 담당자 자기 출고지만,
--     같은 주소는 한 통(여러 출고지 담당자면 그 출고지들 전부), 전용 dispatcher gate·출처 짝·만료·재시도
-- 메일 실행 날짜는 2031년으로 고정해 실제 오늘 실행과 겹치지 않는다(오늘 실행은 빈 행으로 미리 막는다).
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_preview_stock_reconcile(uuid,timestamptz,text,jsonb)','execute')
  and not has_function_privilege('anon','public.admin_preview_stock_reconcile(uuid,timestamptz,text,jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_preview_stock_reconcile(uuid,timestamptz,text,jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_apply_stock_reconcile(uuid,integer,text)','execute')
  and not has_function_privilege('service_role','public.admin_apply_stock_reconcile(uuid,integer,text)','execute')
  and has_function_privilege('authenticated','public.admin_get_stock_reconcile(uuid)','execute')
  and has_function_privilege('authenticated','public.admin_list_stock_reconciles(integer)','execute')
  and has_function_privilege('authenticated','public.admin_stock_dispatch_warnings(uuid,integer)','execute')
  and not has_function_privilege('anon','public.admin_stock_dispatch_warnings(uuid,integer)','execute')
  and has_function_privilege('authenticated','public.admin_get_stock_safety_digest()','execute')
  and has_function_privilege('authenticated','public.admin_save_stock_safety_digest(boolean,text,text[],bigint,uuid)','execute')
  and has_function_privilege('authenticated','public.admin_save_stock_safety_digest_origin(uuid,text[],bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_save_stock_safety_digest(boolean,text,text[],bigint,uuid)','execute')
  and has_function_privilege('service_role','public.claim_stock_safety_digest_jobs(integer)','execute')
  and not has_function_privilege('authenticated','public.claim_stock_safety_digest_jobs(integer)','execute')
  and not has_function_privilege('anon','public.bind_stock_safety_digest_intent(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.finish_stock_safety_digest_job(uuid,uuid,text,text,boolean)','execute')
  and not has_function_privilege('service_role','private.stock_reconcile_flows(uuid[],timestamptz)','execute')
  and not has_function_privilege('authenticated','private.stock_reconcile_holders()','execute')
  and not has_function_privilege('service_role','private.stock_reconcile_adjustments(uuid[],timestamptz)','execute')
  and not has_function_privilege('authenticated','private.prepare_stock_safety_digest(timestamptz)','execute')
  and not has_function_privilege('service_role','private.prepare_stock_safety_digest(timestamptz)','execute')
  and not has_table_privilege('authenticated','private.stock_reconcile_snapshots','select,insert,update')
  and not has_table_privilege('service_role','private.stock_reconcile_snapshot_items','select,insert,update')
  and not has_table_privilege('authenticated','private.stock_safety_digest_settings','select,update')
  and not has_table_privilege('service_role','private.stock_safety_digest_deliveries','select,insert,update')
  and (select count(*)=5 from private.operator_rpc_contracts where signature in (
    'public.admin_preview_stock_reconcile(uuid,timestamp with time zone,text,jsonb)','public.admin_apply_stock_reconcile(uuid,integer,text)',
    'public.admin_get_stock_reconcile(uuid)','public.admin_list_stock_reconciles(integer)','public.admin_stock_dispatch_warnings(uuid,integer)'))
  and (select count(*)=3 from private.operator_rpc_contracts where capability='platform.manage' and signature like 'public.admin_%stock_safety_digest%')
) then 1 else 0 end as assert_sealed_acl_and_contracts;

-- 운영자가 아직 바꾸지 않은 DB는 꺼짐·09:00·수신 주소 없음이다.
select 1/case when (select revision>1 or (not enabled and send_time='09:00' and operator_recipients='{}' and enabled_at is null)
  from private.stock_safety_digest_settings where singleton) then 1 else 0 end as assert_digest_starts_disabled_0900;

-- ---------------------------------------------------------------------------
-- Fixtures (합성 값)
-- ---------------------------------------------------------------------------
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.expect_state(statement text,expected text) returns void language plpgsql as $$
declare code text;begin
 begin execute statement;exception when others then get stacked diagnostics code=returned_sqlstate;
  if code=expected then return;end if;raise;end;
 raise exception 'Expected SQLSTATE: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('5a0c0000-0000-4000-8000-000000000001','authenticated','authenticated','stock-rc-operator@example.test',now(),'{}','{}',now(),now()),
 ('5a0c0000-0000-4000-8000-000000000002','authenticated','authenticated','stock-rc-buyer@example.test',now(),'{}','{}',now(),now()),
 ('5a0c0000-0000-4000-8000-000000000003','authenticated','authenticated','stock-rc-deputy@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 재고대조 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id in('5a0c0000-0000-4000-8000-000000000001','5a0c0000-0000-4000-8000-000000000003') then 'staff'::public.user_role else 'user'::public.user_role end
 where id in('5a0c0000-0000-4000-8000-000000000001','5a0c0000-0000-4000-8000-000000000002','5a0c0000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values
 ('5a0c0000-0000-4000-8000-000000000001','primary'),('5a0c0000-0000-4000-8000-000000000003','deputy');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true);
end $$;

insert into public.ips(id,title,vertical_key) values('stock-rc-ip','TEST 재고대조 IP','character');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address) values
 ('5a0c0000-0000-4000-8000-0000000000a1','stock-rc-a','TEST 재고대조 창고A',0,'합성 반송 주소'),
 ('5a0c0000-0000-4000-8000-0000000000a2','stock-rc-b','TEST 재고대조 창고B',0,'합성 반송 주소');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('stock-rc-g1','stock-rc-ip','TEST 재고대조 굿즈1','문구',10000,'ok',10,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g2','stock-rc-ip','TEST 재고대조 굿즈2','문구',10000,'ok',5,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g3','stock-rc-ip','TEST 재고대조 굿즈3','문구',10000,'ok',7,'5a0c0000-0000-4000-8000-0000000000a2'),
 ('stock-rc-g4','stock-rc-ip','TEST 재고대조 굿즈4','문구',10000,'ok',4,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g5','stock-rc-ip','TEST 재고대조 굿즈5','문구',10000,'soldout',1,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g6','stock-rc-ip','TEST 재고대조 반품','문구',10000,'ok',10,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g7','stock-rc-ip','TEST 재고대조 그룹 교환 출고','문구',10000,'ok',10,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g8','stock-rc-ip','TEST 재고대조 그룹 교환 회수','문구',10000,'ok',10,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g9','stock-rc-ip','TEST 재고대조 승계','문구',10000,'ok',16,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-g10','stock-rc-ip','TEST 재고대조 전환 전','문구',10000,'ok',0,'5a0c0000-0000-4000-8000-0000000000a1');
insert into public.goods_variants(good_id,name,price,stock_qty,code,sort_order)
 values('stock-rc-g2','TEST 둘째 옵션',10000,0,'STOCKRC-G2-EXTRA',1);
-- 그룹상품 전환 전 옵션(보관). 재고는 승계 옵션(굿즈9 기본 옵션)으로 옮겨 갔다.
insert into public.goods_variants(id,good_id,name,price,stock_qty,code,sort_order,archived_at)
 values('5a0c0000-0000-4000-8000-0000000000d1','stock-rc-g10','TEST 전환 전 옵션',10000,0,'STOCKRC-OLD-1',1,now());
select (select code from public.goods_variants where good_id='stock-rc-g1' and is_default) as v1_code,
 (select id from public.goods_variants where good_id='stock-rc-g1' and is_default) as v1,
 (select id from public.goods_variants where good_id='stock-rc-g2' and is_default) as v2,
 (select code from public.goods_variants where good_id='stock-rc-g2' and is_default) as v2_code,
 (select id from public.goods_variants where good_id='stock-rc-g2' and code='STOCKRC-G2-EXTRA') as v3,
 (select id from public.goods_variants where good_id='stock-rc-g3' and is_default) as v4,
 (select code from public.goods_variants where good_id='stock-rc-g4' and is_default) as v5_code,
 (select id from public.goods_variants where good_id='stock-rc-g5' and is_default) as v6,
 (select id from public.goods_variants where good_id='stock-rc-g6' and is_default) as v7,
 (select code from public.goods_variants where good_id='stock-rc-g6' and is_default) as v7_code,
 (select id from public.goods_variants where good_id='stock-rc-g7' and is_default) as v8,
 (select code from public.goods_variants where good_id='stock-rc-g7' and is_default) as v8_code,
 (select id from public.goods_variants where good_id='stock-rc-g8' and is_default) as v9,
 (select code from public.goods_variants where good_id='stock-rc-g8' and is_default) as v9_code,
 (select id from public.goods_variants where good_id='stock-rc-g9' and is_default) as v10,
 (select code from public.goods_variants where good_id='stock-rc-g9' and is_default) as v10_code,
 (select code from public.goods where id='stock-rc-g2') as g2_code,
 (select code from public.goods where id='stock-rc-g3') as g3_code \gset
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode) values
 (:'v1','STOCKRC-ERP-1','TEST ERP 품명1','8800000000011'),
 (:'v2','STOCKRC-ERP-2','TEST ERP 품명2',null),
 (:'v3',null,null,'8800000000033');
insert into private.goods_group_operations(operation_id,actor_id,session_id,command,request_hash)
 values('5a0c0000-0000-4000-8000-0000000000f1','5a0c0000-0000-4000-8000-000000000001','5a0c0000-0000-4000-8000-0000000000f2','convert',repeat('1',64));
insert into private.goods_stock_successors(source_variant_id,source_good_id,target_variant_id,target_good_id,operation_id,moved_qty,actor_id)
 values('5a0c0000-0000-4000-8000-0000000000d1','stock-rc-g10',:'v10','stock-rc-g9','5a0c0000-0000-4000-8000-0000000000f1',16,'5a0c0000-0000-4000-8000-000000000001');
set local session_replication_role=replica;
update public.goods set archived_at=now() where id='stock-rc-g4';
set local session_replication_role=origin;

-- n번 주문: 주문 상태·배송 건 상태·출고 시각을 고른다. 출고 시각이 있으면 배송중 배송 건이다.
create function pg_temp.order_with(n integer,variant uuid,good text,qty integer,status public.order_status,shipped timestamptz default null)
returns uuid language plpgsql as $$
declare oid uuid:=('5a0c0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=gen_random_uuid();
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,'5a0c0000-0000-4000-8000-000000000002',status,10000*qty,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',case when status not in('pending','paid') then now() end);
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,good,qty,10000,'TEST 재고대조','문구','stock-rc-ip',variant) returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
  values(sid,oid,(select origin_id from public.goods where id=good),'TEST 재고대조 창고',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,qty);
 if shipped is not null then
  set local session_replication_role=replica;
  update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='STOCKRC'||lpad(n::text,6,'0'),shipped_at=shipped where id=sid;
  set local session_replication_role=origin;
 end if;
 return oid;
end $$;
create function pg_temp.item_of(o uuid) returns uuid language sql stable as $$select id from public.order_items where order_id=o$$;
-- n번 클레임(주문 단위). 반품·교환의 회수·재출고 시각을 합성한다(상태 투영 계약은 지킨다).
create function pg_temp.claim_with(n integer,o uuid,kind text,stage text,collected timestamptz,reshipped timestamptz default null)
returns uuid language plpgsql as $$
declare cid uuid:=('5a0c0000-0000-4005-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 set local session_replication_role=replica;
 insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,status,collection_policy,collected_at,
  reshipped_at,reship_carrier,reship_tracking_number,completed_at)
 values(cid,o,'5a0c0000-0000-4000-8000-000000000002','TEST 재고대조 클레임',kind,stage,
  case stage when 'completed' then 'completed' else 'requested' end,'legacy',collected,
  reshipped,case when reshipped is not null then 'hanjin' end,case when reshipped is not null then 'STOCKRCX'||lpad(n::text,6,'0') end,
  case when stage='completed' then coalesce(reshipped,collected) end);
 set local session_replication_role=origin;
 return cid;
end $$;
-- 재고수량 V1=10. 출고 대기: 결제 주문 2 + 배정된 예약 6(미배정 예약 5는 제외). 기준 시각 뒤 출고 1, 앞 출고 3, 취소 4는 제외.
select pg_temp.order_with(1,:'v1','stock-rc-g1',2,'paid') as o_pending \gset
select pg_temp.order_with(2,:'v1','stock-rc-g1',1,'shipping',now()-interval '1 hour') as o_shipped_after \gset
select pg_temp.order_with(3,:'v1','stock-rc-g1',3,'delivered',now()-interval '3 hours') as o_shipped_before \gset
select pg_temp.order_with(4,:'v1','stock-rc-g1',4,'canceled') as o_canceled \gset
select pg_temp.order_with(5,:'v1','stock-rc-g1',5,'paid') as o_pre_reserved \gset
select pg_temp.order_with(6,:'v1','stock-rc-g1',6,'confirmed') as o_pre_allocated \gset
select pg_temp.order_with(7,:'v4','stock-rc-g3',1,'paid') as o_other_origin \gset
set local session_replication_role=replica;
insert into private.goods_preorder_policies(id,variant_id,state,created_by)
 values('5a0c0000-0000-4000-8000-0000000000e1',:'v1','draft','5a0c0000-0000-4000-8000-000000000001');
update public.order_items set supply_source='preorder',preorder_policy_id='5a0c0000-0000-4000-8000-0000000000e1',preorder_expected_ship_date='2031-04-01',
 preorder_snapshot='{"policyId":"5a0c0000-0000-4000-8000-0000000000e1","policyRevision":1,"startsAt":"2031-01-01T00:00:00Z","endsAt":"2031-02-01T00:00:00Z","expectedShipDate":"2031-04-01"}'
 where order_id in(:'o_pre_reserved',:'o_pre_allocated');
insert into private.goods_preorder_reservations(order_item_id,order_id,policy_id,qty,state,allocated_at,allocated_by,allocation_reference)
 select id,order_id,'5a0c0000-0000-4000-8000-0000000000e1',qty,
  case when order_id=:'o_pre_allocated' then 'allocated' else 'reserved' end,
  case when order_id=:'o_pre_allocated' then now() end,
  case when order_id=:'o_pre_allocated' then '5a0c0000-0000-4000-8000-000000000001'::uuid end,
  case when order_id=:'o_pre_allocated' then 'TEST 입고' end
 from public.order_items where order_id in(:'o_pre_reserved',:'o_pre_allocated');
set local session_replication_role=origin;

select 1/case when (select pending_qty=8 and shipped_since_qty=1 and returned_since_qty=0 and awaiting_return_qty=0
   from private.stock_reconcile_flows(array[:'v1'::uuid],now()-interval '2 hours'))
 and (select pending_qty=0 and shipped_since_qty=0 from private.stock_reconcile_flows(array[:'v2'::uuid],now()-interval '2 hours'))
 then 1 else 0 end as assert_outbound_counts_only_unshipped_stock_units;

-- ---------------------------------------------------------------------------
-- 실물 흐름: 반품 회수·복원, 그룹상품 교환 재출고, 그룹상품 전환 승계 (기준 시각 = 2시간 전)
-- ---------------------------------------------------------------------------
-- 반품(V7, 재고 10): r1은 기준 시각 전 출고 → 뒤에 회수·환불 복원, r2는 기준 시각 전 회수 → 아직 환불 전,
-- r3은 회수 클레임 없이 지금 복원(복원 시각을 회수로 본다).
select pg_temp.order_with(21,:'v7','stock-rc-g6',1,'delivered',now()-interval '3 hours') as o_return_after \gset
select pg_temp.order_with(22,:'v7','stock-rc-g6',2,'delivered',now()-interval '5 hours') as o_return_waiting \gset
select pg_temp.order_with(23,:'v7','stock-rc-g6',1,'delivered',now()-interval '3 hours') as o_restored_no_claim \gset
select pg_temp.claim_with(21,:'o_return_after','return','completed',now()-interval '1 hour') as c_return_after \gset
select pg_temp.claim_with(22,:'o_return_waiting','return','collected',now()-interval '4 hours') as c_return_waiting \gset
select private.restore_order_item_supply(pg_temp.item_of(:'o_return_after'),'TEST 반품 환불');
select private.restore_order_item_supply(pg_temp.item_of(:'o_restored_no_claim'),'TEST 회수 기록 없는 복원');
set local session_replication_role=replica;
update public.orders set status='canceled' where id in(:'o_return_after',:'o_restored_no_claim');
set local session_replication_role=origin;
-- 그룹상품 교환: 굿즈8(V9) 2개를 회수(90분 전)하고 굿즈7(V8) 2개를 재출고(1시간 전). 별도 배정 원장에만 남는다.
select pg_temp.order_with(24,:'v9','stock-rc-g8',2,'delivered',now()-interval '5 hours') as o_group_exchange \gset
select pg_temp.claim_with(24,:'o_group_exchange','exchange','completed',now()-interval '90 minutes',now()-interval '1 hour') as c_group_exchange \gset
set local session_replication_role=replica;
insert into private.group_claim_reshipment_receipts(claim_id,actor_id,carrier,tracking_number,selections)
 values(:'c_group_exchange','5a0c0000-0000-4000-8000-000000000001','hanjin','STOCKRCX000024','[]');
insert into private.group_claim_reshipment_allocations(claim_id,order_item_id,original_good_id,original_variant_id,source_good_id,source_variant_id,
 source_generation_kind,source_generation_id,returned_good_id,returned_variant_id,operation_path,target_good_id,target_variant_id,
 good_name_snapshot,variant_name_snapshot,variant_code_snapshot,qty)
 values(:'c_group_exchange',pg_temp.item_of(:'o_group_exchange'),'stock-rc-g8',:'v9','stock-rc-g8',:'v9','purchase',pg_temp.item_of(:'o_group_exchange'),
  'stock-rc-g8',:'v9','{}','stock-rc-g7',:'v8','TEST 그룹 교환 출고','기본 옵션',:'v8_code',2);
set local session_replication_role=origin;
select private.change_goods_variant_stock('stock-rc-g8',:'v9',2);
select private.change_goods_variant_stock('stock-rc-g7',:'v8',-2);
-- 그룹상품 전환 뒤 결제된 미출고 주문은 보관된 전환 전 옵션을 가리키지만 실물은 승계 옵션(V10, 재고 16)의 것이다.
select pg_temp.order_with(25,'5a0c0000-0000-4000-8000-0000000000d1','stock-rc-g10',3,'paid') as o_successor \gset

select 1/case when (select pending_qty=0 and shipped_since_qty=0 and returned_since_qty=2 and awaiting_return_qty=2
   from private.stock_reconcile_flows(array[:'v7'::uuid],now()-interval '2 hours'))
 and (select stock_qty from public.goods_variants where id=:'v7')=12
 and (select shipped_since_qty=2 and returned_since_qty=0 from private.stock_reconcile_flows(array[:'v8'::uuid],now()-interval '2 hours'))
 and (select shipped_since_qty=0 and returned_since_qty=2 and awaiting_return_qty=0 from private.stock_reconcile_flows(array[:'v9'::uuid],now()-interval '2 hours'))
 and (select pending_qty=3 from private.stock_reconcile_flows(array[:'v10'::uuid],now()-interval '2 hours'))
 and (select source_id='5a0c0000-0000-4000-8000-0000000000d1' and holder_id=:'v10'::uuid from private.stock_reconcile_holders()
   where source_id='5a0c0000-0000-4000-8000-0000000000d1')
 then 1 else 0 end as assert_returns_group_exchange_and_successor_flows;

-- 파일(기준 시각 창고 실물): V7 12(r1·r3은 고객에게, r2는 이미 회수), V8 10(재출고 전), V9 10(회수 전), V10 19(전환 주문 3개 미출고 포함).
-- 맞춘 뒤 재고수량은 지금 사이트 재고와 같아야 한다(V7 12, V8 8, V9 12, V10 16).
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select public.admin_preview_stock_reconcile('5a0c0000-0000-4000-8000-0000000000a1',now()-interval '2 hours','TEST 실물 흐름',jsonb_build_array(
 jsonb_build_object('row',2,'optionCode',:'v7_code','qty',12),
 jsonb_build_object('row',3,'optionCode',:'v8_code','qty',10),
 jsonb_build_object('row',4,'optionCode',:'v9_code','qty',10),
 jsonb_build_object('row',5,'optionCode',:'v10_code','qty',19))) as preview_flows \gset
reset role;
select 1/case when (select bool_and((i->>'difference')::integer=0 and (i->>'targetQty')::integer=(i->>'stockQty')::integer)
   from jsonb_array_elements(:'preview_flows'::jsonb->'items') i)
 and (:'preview_flows'::jsonb->>'changedCount')::integer=0
 and (select (i->>'returnedSinceQty')::integer=2 and (i->>'awaitingReturnQty')::integer=2 and (i->>'targetQty')::integer=12
   from jsonb_array_elements(:'preview_flows'::jsonb->'items') i where i->>'variantId'=:'v7')
 and (select (i->>'shippedSinceQty')::integer=2 and (i->>'targetQty')::integer=8 from jsonb_array_elements(:'preview_flows'::jsonb->'items') i where i->>'variantId'=:'v8')
 and (select (i->>'pendingQty')::integer=3 and (i->>'targetQty')::integer=16 from jsonb_array_elements(:'preview_flows'::jsonb->'items') i where i->>'variantId'=:'v10')
 then 1 else 0 end as assert_preview_matches_physical_flows;

-- ---------------------------------------------------------------------------
-- 미리보기: 매칭·사유
-- ---------------------------------------------------------------------------
-- 같은 파일을 뒤에서 다시 미리보기하므로 행을 변수로 둔다.
select jsonb_build_array(
  jsonb_build_object('row',2,'optionCode',lower(:'v1_code'),'qty',20),
  jsonb_build_object('row',3,'erpCode','stockrc-erp-2','barcode','9999999999999','qty',3),
  jsonb_build_object('row',4,'optionCode','STOCKRC-G2-EXTRA','qty',4),
  jsonb_build_object('row',5,'barcode','8800000000033','qty',4),
  jsonb_build_object('row',6,'goodsCode',:'g2_code','qty',1),
  jsonb_build_object('row',7,'goodsCode',:'g3_code','qty',7),
  jsonb_build_object('row',8,'optionCode','STOCKRC-NOPE','qty',1),
  jsonb_build_object('row',9,'optionCode',:'v1_code','goodsCode',:'g2_code','qty',1),
  jsonb_build_object('row',10,'optionCode',:'v5_code','qty',1),
  jsonb_build_object('row',11,'barcode','8800000000011','optionCode',:'v2_code','qty',1),
  jsonb_build_object('row',12,'optionCode','STOCKRC-OLD-1','qty',1)
 ) as rows_one \gset
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select public.admin_preview_stock_reconcile('5a0c0000-0000-4000-8000-0000000000a1',now()-interval '2 hours','TEST 서원 재고.xlsx',
 :'rows_one'::jsonb) as preview_one \gset
reset role;
select (:'preview_one'::jsonb)->>'id' as snap_one \gset
select 1/case when (:'preview_one'::jsonb->>'matchedCount')::integer=2 and (:'preview_one'::jsonb->>'issueCount')::integer=9
 and (:'preview_one'::jsonb->>'changedCount')::integer=2 and :'preview_one'::jsonb->>'originName'='TEST 재고대조 창고A'
 and (select jsonb_object_agg(i->>'row',i->>'reason') from jsonb_array_elements(:'preview_one'::jsonb->'issues') i)=jsonb_build_object(
  '4','duplicate','5','duplicate','6','option_required','7','other_origin','8','not_found','9','conflict','10','goods_archived','11','conflict',
  '12','option_stopped')
 then 1 else 0 end as assert_preview_matching_and_reasons;
select 1/case when (select i->>'matchKind'='option_code' and (i->>'fileQty')::integer=20 and (i->>'stockQty')::integer=10
   and (i->>'pendingQty')::integer=8 and (i->>'shippedSinceQty')::integer=1 and (i->>'difference')::integer=1 and (i->>'targetQty')::integer=11
  from jsonb_array_elements(:'preview_one'::jsonb->'items') i where i->>'variantId'=:'v1')
 and (select i->>'matchKind'='erp_code' and (i->>'difference')::integer=-2 and (i->>'targetQty')::integer=3
  from jsonb_array_elements(:'preview_one'::jsonb->'items') i where i->>'variantId'=:'v2')
 and (select stock_qty from public.goods_variants where id=:'v1')=10
 and exists(select 1 from public.audit_log where action='admin.stock_reconcile.previewed' and target='stock_reconcile:'||:'snap_one')
 then 1 else 0 end as assert_preview_formula_without_stock_change;

-- 잘못된 입력은 행 단위가 아니라 전체를 거절한다. 기준 시각은 7일 안만 받는다.
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now(),'x','[{"row":1,"optionCode":"A","qty":-1}]')$$,'invalid_stock_reconcile_rows');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now(),'x','[{"row":1,"qty":1}]')$$,'invalid_stock_reconcile_rows');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now(),'x','[{"row":1,"optionCode":"A","qty":1},{"row":1,"optionCode":"B","qty":1}]')$$,'invalid_stock_reconcile_rows');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now(),'x','[{"row":1,"optionCode":"A","qty":1,"note":"x"}]')$$,'invalid_stock_reconcile_rows');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now(),'x','["bad"]')$$,'invalid_stock_reconcile_rows');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now()+interval '1 day','x','[{"row":1,"optionCode":"A","qty":1}]')$$,'invalid_stock_reconcile_as_of');
select pg_temp.expect_error($$select public.admin_preview_stock_reconcile(null,now()-interval '8 days','x','[{"row":1,"optionCode":"A","qty":1}]')$$,'invalid_stock_reconcile_as_of');
-- 계정 부매니저는 재고를 다루지만 출고 화면 경고·요약 메일 설정은 볼 수 없다.
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000003');
select 1/case when (public.admin_get_stock_reconcile(:'snap_one')->>'id')=:'snap_one' then 1 else 0 end as assert_deputy_reads_reconcile;
select pg_temp.expect_state($$select public.admin_stock_dispatch_warnings(null,1)$$,'42501');
select pg_temp.expect_state($$select public.admin_get_stock_safety_digest()$$,'42501');
reset role;

-- ---------------------------------------------------------------------------
-- 확정(QA1 S-T07-01): 미리보기 뒤 주문이 들어와 '맞춘 뒤' 재고수량이 달라지면(10 → 11로 본 V1이 지금은 9 → 10)
-- 반영 전체를 거절하고 바뀐 옵션을 미리보기 값·지금 값·이유와 함께 돌려준다. 차이는 그대로라 예전에는 알림 없이 반영됐다.
-- ---------------------------------------------------------------------------
select private.change_goods_variant_stock('stock-rc-g1',:'v1',-1);
select pg_temp.order_with(8,:'v1','stock-rc-g1',1,'paid') as o_after_preview \gset
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select pg_temp.expect_error(format('select public.admin_apply_stock_reconcile(%L,1,%L)',:'snap_one','TEST 대조'),'stock_reconcile_preview_mismatch');
select public.admin_apply_stock_reconcile(:'snap_one',2,'TEST 서원 재고 대조') as conflict_one \gset
reset role;
select 1/case when :'conflict_one'::jsonb->>'status'='conflict'
 and jsonb_array_length(:'conflict_one'::jsonb->'conflicts')=1
 and (select c->>'reason'='pending_changed' and (c->>'previewTargetQty')::integer=11 and (c->>'currentTargetQty')::integer=10
   and (c->>'previewStockQty')::integer=10 and (c->>'currentStockQty')::integer=9
   and (c->>'previewPendingQty')::integer=8 and (c->>'currentPendingQty')::integer=9
   and (c->>'previewDifference')::integer=1 and (c->>'currentDifference')::integer=1
  from jsonb_array_elements(:'conflict_one'::jsonb->'conflicts') c where c->>'variantId'=:'v1')
 and (select stock_qty from public.goods_variants where id=:'v1')=9
 and (select stock_qty from public.goods_variants where id=:'v2')=5
 and (select applied_at is null from private.stock_reconcile_snapshots where id=:'snap_one')
 and not exists(select 1 from private.stock_reconcile_snapshot_items where snapshot_id=:'snap_one'
   and (stock_before is not null or applied_delta is not null))
 and not exists(select 1 from public.audit_log where action in('admin.good.stock_reconciled','admin.stock_reconcile.applied')
   and (diff->>'snapshotId'=:'snap_one' or target='stock_reconcile:'||:'snap_one'))
 then 1 else 0 end as assert_apply_rejects_target_moved_after_preview;

-- 같은 파일로 다시 미리보기하면 지금 값(V1 9 → 10)이 보이고, 확인한 그 값으로 반영된다. 결과·감사는 반영 시점 값이다.
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select (public.admin_preview_stock_reconcile('5a0c0000-0000-4000-8000-0000000000a1',now()-interval '2 hours','TEST 서원 재고.xlsx',
 :'rows_one'::jsonb))->>'id' as snap_one_b \gset
select public.admin_apply_stock_reconcile(:'snap_one_b',2,'TEST 서원 재고 대조') as applied_one \gset
reset role;
select 1/case when :'applied_one'::jsonb->>'status'='applied' and (:'applied_one'::jsonb->>'replayed')::boolean=false
 and (select stock_qty from public.goods_variants where id=:'v1')=10
 and (select stock_qty from public.goods_variants where id=:'v2')=3
 and (select stock_qty from public.goods where id='stock-rc-g2')=3
 and (select applied_at is not null and apply_result->>'increased'='1' and apply_result->>'decreased'='1' and apply_result->>'totalDelta'='-1'
  from private.stock_reconcile_snapshots where id=:'snap_one_b')
 and (select stock_qty=9 and target_qty=10 and applied_delta=1 and stock_after=10 and stock_before=9 and applied_pending_qty=9
   and applied_shipped_since_qty=1 and applied_returned_since_qty=0 and applied_awaiting_return_qty=0
  from private.stock_reconcile_snapshot_items where snapshot_id=:'snap_one_b' and variant_id=:'v1')
 and (select (i->>'stockBefore')::integer=9 and (i->>'appliedPendingQty')::integer=9 and (i->>'stockAfter')::integer=10
  from jsonb_array_elements(:'applied_one'::jsonb->'snapshot'->'items') i where i->>'variantId'=:'v1')
 and (select count(*)=2 from public.audit_log where action='admin.good.stock_reconciled' and diff->>'snapshotId'=:'snap_one_b')
 and exists(select 1 from public.audit_log where action='admin.good.stock_reconciled' and diff->>'snapshotId'=:'snap_one_b'
  and diff->>'variantId'=:'v1' and (diff->>'from')::integer=9 and (diff->>'to')::integer=10 and (diff->>'pendingQty')::integer=9
  and (diff->>'previewStockQty')::integer=9 and (diff->>'previewPendingQty')::integer=9)
 and exists(select 1 from public.audit_log where action='admin.stock_reconcile.applied' and target='stock_reconcile:'||:'snap_one_b'
  and diff->>'reason'='TEST 서원 재고 대조')
 then 1 else 0 end as assert_reapply_after_new_preview;
-- 같은 확정의 재전송은 처음 결과, 다른 사유는 거절. 반영한 미리보기 전의 옛 미리보기는 재고가 바뀌어 거절된다(이중 반영 없음).
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select 1/case when (public.admin_apply_stock_reconcile(:'snap_one_b',2,'TEST 서원 재고 대조')->>'replayed')::boolean then 1 else 0 end as assert_apply_replay;
select pg_temp.expect_error(format('select public.admin_apply_stock_reconcile(%L,2,%L)',:'snap_one_b','다른 사유'),'stock_reconcile_already_applied');
select public.admin_apply_stock_reconcile(:'snap_one',2,'TEST 옛 미리보기') as stale_one \gset
reset role;
select 1/case when (select stock_qty from public.goods_variants where id=:'v1')=10
 and :'stale_one'::jsonb->>'status'='conflict'
 and (select c->>'reason'='pending_and_stock_changed' and (c->>'currentStockQty')::integer=10
  from jsonb_array_elements(:'stale_one'::jsonb->'conflicts') c where c->>'variantId'=:'v1')
 and (select c->>'reason'='stock_changed' and (c->>'previewStockQty')::integer=5 and (c->>'currentStockQty')::integer=3
   and (c->>'previewTargetQty')::integer=3 and (c->>'currentTargetQty')::integer=3
  from jsonb_array_elements(:'stale_one'::jsonb->'conflicts') c where c->>'variantId'=:'v2')
 then 1 else 0 end as assert_replay_no_second_change;

-- 수동 재고 조정이 끼면 아무것도 바꾸지 않고 달라진 옵션을 돌려준다. 기준 시각 뒤 조정은 다음 미리보기에 표시된다.
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select (public.admin_preview_stock_reconcile(null,now(),'TEST 두 번째',jsonb_build_array(
 jsonb_build_object('row',1,'optionCode',:'v2_code','qty',10),jsonb_build_object('row',2,'optionCode',:'v1_code','qty',30))))->>'id' as snap_two \gset
select public.admin_adjust_stock(gen_random_uuid(),'stock-rc-g2',:'v2',3,1,'TEST 입고');
select public.admin_apply_stock_reconcile(:'snap_two',2,'TEST 충돌') as conflict_two \gset
select public.admin_preview_stock_reconcile(null,now()-interval '1 minute','TEST 조정 표시',jsonb_build_array(
 jsonb_build_object('row',1,'optionCode',:'v2_code','qty',4))) as preview_adjusted \gset
reset role;
select 1/case when :'conflict_two'::jsonb->>'status'='conflict'
 and (select count(*)=1 from jsonb_array_elements(:'conflict_two'::jsonb->'conflicts') c where c->>'variantId'=:'v2' and c->>'reason'='stock_changed'
   and (c->>'previewStockQty')::integer=3 and (c->>'currentStockQty')::integer=4 and (c->>'previewTargetQty')=(c->>'currentTargetQty'))
 and jsonb_array_length(:'conflict_two'::jsonb->'conflicts')=1
 and (select stock_qty from public.goods_variants where id=:'v1')=10 and (select stock_qty from public.goods_variants where id=:'v2')=4
 and (select applied_at is null from private.stock_reconcile_snapshots where id=:'snap_two')
 -- 같은 트랜잭션이라 앞선 대조 반영(−2)도 기준 시각 뒤 변경으로 함께 잡힌다: 수동 조정 +1과 합쳐 2건·−1.
 and (select (i->>'adjustedSinceCount')::integer=2 and (i->>'adjustedSinceQty')::integer=-1
   from jsonb_array_elements(:'preview_adjusted'::jsonb->'items') i where i->>'variantId'=:'v2')
 then 1 else 0 end as assert_conflict_changes_nothing_and_adjustment_flagged;

-- 초안 상품의 주소(id)가 바뀌어도 대조 기록이 옵션을 따라간다.
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('stock-rc-slug-old','stock-rc-ip','TEST 재고대조 주소 변경','문구',10000,'ok',3,'5a0c0000-0000-4000-8000-0000000000a1');
select code as v11_code,id as v11 from public.goods_variants where good_id='stock-rc-slug-old' and is_default \gset
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select (public.admin_preview_stock_reconcile(null,now(),'TEST 주소 변경',jsonb_build_array(jsonb_build_object('row',1,'optionCode',:'v11_code','qty',8))))->>'id' as snap_slug \gset
reset role;
update public.goods set id='stock-rc-slug-new' where id='stock-rc-slug-old';
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select (public.admin_apply_stock_reconcile(:'snap_slug',1,'TEST 주소 변경 반영'))->>'status' as slug_applied \gset
reset role;
select 1/case when :'slug_applied'='applied'
 and (select good_id='stock-rc-slug-new' from private.stock_reconcile_snapshot_items where snapshot_id=:'snap_slug')
 and jsonb_array_length(private.stock_reconcile_document(:'snap_slug')->'items')=1
 and private.stock_reconcile_document(:'snap_slug')->'items'->0->>'goodId'='stock-rc-slug-new'
 and (select stock_qty from public.goods_variants where id=:'v11')=8
 then 1 else 0 end as assert_snapshot_follows_goods_id_change;

-- ---------------------------------------------------------------------------
-- 출고 전 경고: 최근 파일 기준 부족·대조 기록 없음(그룹상품 전환 뒤에는 승계 옵션 기준)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select public.admin_preview_stock_reconcile('5a0c0000-0000-4000-8000-0000000000a1',now(),'TEST 세 번째',jsonb_build_array(
 jsonb_build_object('row',1,'optionCode',:'v1_code','qty',5))) as preview_three \gset
select public.admin_stock_dispatch_warnings('5a0c0000-0000-4000-8000-0000000000a1',1) as warnings_a \gset
select public.admin_stock_dispatch_warnings(null,1) as warnings_all \gset
reset role;
-- V1: 출고 대기 9(2+6+1) > 파일 5 → 부족 4. 전환 전 옵션 주문은 승계 옵션 V10으로 묶이고 최근 파일(19)과 맞아 경고가 없다.
-- 창고B 주문(V4)은 대조 기록이 없다.
select 1/case when (select w->>'kind'='shortage' and (w->>'shortageQty')::integer=4 and (w->>'pendingQty')::integer=9
   and (w->>'expectedQty')::integer=5 from jsonb_array_elements(:'warnings_a'::jsonb->'warnings') w where w->>'variantId'=:'v1')
 and (:'warnings_a'::jsonb->>'batchVariantCount')::integer=2
 and not exists(select 1 from jsonb_array_elements(:'warnings_a'::jsonb->'warnings') w
   where w->>'variantId' in(:'v10','5a0c0000-0000-4000-8000-0000000000d1'))
 and (:'warnings_a'::jsonb->>'unreconciledCount')::integer=0
 and (:'warnings_all'::jsonb->>'unreconciledCount')::integer=1
 and (select count(*)=1 from jsonb_array_elements(:'warnings_all'::jsonb->'unreconciled') u where u->>'variantId'=:'v4')
 then 1 else 0 end as assert_dispatch_shortage_and_unreconciled;

-- ---------------------------------------------------------------------------
-- 맞춘 뒤 값이 그대로면 반영한다(QA1 S-T07-01): 미리보기 뒤 출고만 끼거나(출고 대기 → 기준 시각 뒤 출고),
-- 같은 옵션에 주문이 들어와 재고수량과 맞춘 뒤 값이 함께 움직인 경우. 결과·옵션별 감사는 반영 시점 값이다.
-- 출고 전 경고 시험 뒤에 둔다(이 주문들이 창고A 출고 대기 옵션 수를 바꾸지 않게).
-- ---------------------------------------------------------------------------
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('stock-rc-moment','stock-rc-ip','TEST 재고대조 반영 시점','문구',10000,'ok',5,'5a0c0000-0000-4000-8000-0000000000a1'),
 ('stock-rc-same','stock-rc-ip','TEST 재고대조 같은 옵션','문구',10000,'ok',4,'5a0c0000-0000-4000-8000-0000000000a1');
select (select id from public.goods_variants where good_id='stock-rc-moment' and is_default) as v_moment,
 (select code from public.goods_variants where good_id='stock-rc-moment' and is_default) as v_moment_code,
 (select id from public.goods_variants where good_id='stock-rc-same' and is_default) as v_same,
 (select code from public.goods_variants where good_id='stock-rc-same' and is_default) as v_same_code \gset
-- 반영 시점 옵션: 발주확인 주문 2개(재고수량은 주문 때 뺐다) → 재고 3·출고 대기 2. 파일 9 → 맞춘 뒤 7(3 → 7).
select private.change_goods_variant_stock('stock-rc-moment',:'v_moment',-2);
select pg_temp.order_with(31,:'v_moment','stock-rc-moment',2,'confirmed') as o_moment \gset
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select public.admin_preview_stock_reconcile(null,now()-interval '1 hour','TEST 반영 시점',jsonb_build_array(
 jsonb_build_object('row',1,'optionCode',:'v_moment_code','qty',9),jsonb_build_object('row',2,'optionCode',:'v_same_code','qty',4))) as preview_moment \gset
reset role;
select (:'preview_moment'::jsonb)->>'id' as snap_moment \gset
-- 미리보기 뒤: 반영 시점 옵션의 주문이 출고되고(출고 대기 2 → 기준 시각 뒤 출고 2), 같은 옵션에 결제 주문 1개가 들어온다(재고 4 → 3, 맞춘 뒤 4 → 3).
set local session_replication_role=replica;
update public.order_shipments set status='shipping',carrier='hanjin',tracking_number='STOCKRC000031',shipped_at=now() where order_id=:'o_moment';
update public.orders set status='shipping',shipped_at=now() where id=:'o_moment';
set local session_replication_role=origin;
select private.change_goods_variant_stock('stock-rc-same',:'v_same',-1);
select pg_temp.order_with(32,:'v_same','stock-rc-same',1,'paid') as o_same \gset
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select public.admin_apply_stock_reconcile(:'snap_moment',1,'TEST 반영 시점 값') as applied_moment \gset
reset role;
select 1/case when (:'preview_moment'::jsonb->>'changedCount')::integer=1
 and (select (i->>'stockQty')::integer=3 and (i->>'pendingQty')::integer=2 and (i->>'targetQty')::integer=7
  from jsonb_array_elements(:'preview_moment'::jsonb->'items') i where i->>'variantId'=:'v_moment')
 and :'applied_moment'::jsonb->>'status'='applied'
 and (select stock_qty from public.goods_variants where id=:'v_moment')=7
 and (select stock_qty from public.goods_variants where id=:'v_same')=3
 and (select stock_qty=3 and pending_qty=2 and shipped_since_qty=0 and stock_before=3 and applied_pending_qty=0 and applied_shipped_since_qty=2
   and applied_delta=4 and stock_after=7
  from private.stock_reconcile_snapshot_items where snapshot_id=:'snap_moment' and variant_id=:'v_moment')
 and (select stock_qty=4 and pending_qty=0 and stock_before=3 and applied_pending_qty=1 and applied_delta is null and stock_after is null
  from private.stock_reconcile_snapshot_items where snapshot_id=:'snap_moment' and variant_id=:'v_same')
 and (select (i->>'stockBefore')::integer=3 and (i->>'appliedPendingQty')::integer=0 and (i->>'appliedShippedSinceQty')::integer=2
   and (i->>'stockAfter')::integer=7
  from jsonb_array_elements(:'applied_moment'::jsonb->'snapshot'->'items') i where i->>'variantId'=:'v_moment')
 and (select (i->>'stockBefore')::integer=3 and (i->>'appliedPendingQty')::integer=1 and i->'stockAfter'='null'::jsonb
  from jsonb_array_elements(:'applied_moment'::jsonb->'snapshot'->'items') i where i->>'variantId'=:'v_same')
 and (select count(*)=1 from public.audit_log where action='admin.good.stock_reconciled' and diff->>'snapshotId'=:'snap_moment')
 and exists(select 1 from public.audit_log where action='admin.good.stock_reconciled' and diff->>'snapshotId'=:'snap_moment'
  and diff->>'variantId'=:'v_moment' and (diff->>'from')::integer=3 and (diff->>'to')::integer=7 and (diff->>'delta')::integer=4
  and (diff->>'pendingQty')::integer=0 and (diff->>'shippedSinceQty')::integer=2
  and (diff->>'previewStockQty')::integer=3 and (diff->>'previewPendingQty')::integer=2)
 then 1 else 0 end as assert_apply_records_values_at_apply_time;

-- 같은 옵션도 미리보기 뒤 재고수량을 직접 바꿔 반영할 것이 생기면 거절한다(대조 기록만 남기기 포함).
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select (public.admin_preview_stock_reconcile(null,now(),'TEST 같은 옵션 조정',jsonb_build_array(
 jsonb_build_object('row',1,'optionCode',:'v_same_code','qty',4))))->>'id' as snap_same \gset
select public.admin_adjust_stock(gen_random_uuid(),'stock-rc-same',:'v_same',3,2,'TEST 입고');
select public.admin_apply_stock_reconcile(:'snap_same',0,'TEST 같은 옵션 조정') as conflict_same \gset
reset role;
select 1/case when :'conflict_same'::jsonb->>'status'='conflict'
 and (select c->>'reason'='stock_changed' and (c->>'previewStockQty')::integer=3 and (c->>'currentStockQty')::integer=5
   and (c->>'previewTargetQty')::integer=3 and (c->>'currentTargetQty')::integer=3
  from jsonb_array_elements(:'conflict_same'::jsonb->'conflicts') c where c->>'variantId'=:'v_same')
 and (select stock_qty from public.goods_variants where id=:'v_same')=5
 and (select applied_at is null from private.stock_reconcile_snapshots where id=:'snap_same')
 then 1 else 0 end as assert_same_option_direct_change_rejected;

-- ---------------------------------------------------------------------------
-- 안전재고 요약 메일 설정
-- ---------------------------------------------------------------------------
update public.goods_variants set low_stock_threshold=case id when :'v2'::uuid then 4 when :'v4'::uuid then 10 when :'v1'::uuid then 0 when :'v6'::uuid then 5 end
 where id in(:'v1',:'v2',:'v4',:'v6');
set local role authenticated;
select pg_temp.as_actor('5a0c0000-0000-4000-8000-000000000001');
select (public.admin_get_stock_safety_digest()->>'revision')::bigint as digest_revision \gset
select pg_temp.expect_error(format('select public.admin_save_stock_safety_digest(true,%L,%L::text[],%s,gen_random_uuid())','08:30','{not-an-email}',:'digest_revision'),'invalid_stock_digest_recipient');
select pg_temp.expect_error(format('select public.admin_save_stock_safety_digest(true,%L,%L::text[],%s,gen_random_uuid())','24:00','{}',:'digest_revision'),'invalid_stock_safety_digest');
select public.admin_save_stock_safety_digest(true,'08:30',array[' Ops@Example.test ','ops@example.test','md@example.test'],:'digest_revision',
 '5a0c0000-0000-4000-8000-0000000000c1') as digest_saved \gset
select 1/case when (public.admin_save_stock_safety_digest(true,'08:30',array[' Ops@Example.test ','ops@example.test','md@example.test'],:'digest_revision',
  '5a0c0000-0000-4000-8000-0000000000c1')->>'revision')=(:'digest_saved'::jsonb->>'revision') then 1 else 0 end as assert_settings_replay;
select pg_temp.expect_state(format('select public.admin_save_stock_safety_digest(false,%L,%L::text[],%s,gen_random_uuid())','08:30','{}',:'digest_revision'),'PT409');
select public.admin_save_stock_safety_digest_origin('5a0c0000-0000-4000-8000-0000000000a1',array['seowon@example.test','OPS@example.test'],0,
 '5a0c0000-0000-4000-8000-0000000000c2') as origin_saved \gset
select pg_temp.expect_state($$select public.admin_save_stock_safety_digest_origin('5a0c0000-0000-4000-8000-0000000000a1','{}',0,gen_random_uuid())$$,'PT409');
-- 같은 서원 담당자가 창고B도 맡는다. 창고B에는 김포 담당자도 있다.
select public.admin_save_stock_safety_digest_origin('5a0c0000-0000-4000-8000-0000000000a2',array['seowon@example.test','gimpo@example.test'],0,
 '5a0c0000-0000-4000-8000-0000000000c3') is not null as origin_b_saved \gset
reset role;
select 1/case when :'digest_saved'::jsonb->>'enabled'='true' and :'digest_saved'::jsonb->>'sendTime'='08:30'
 and :'digest_saved'::jsonb->'operatorRecipients'='["ops@example.test","md@example.test"]'::jsonb
 and (:'origin_saved'::jsonb->>'revision')::integer=1 and :'origin_saved'::jsonb->'recipients'='["seowon@example.test","ops@example.test"]'::jsonb
 and (select enabled_at is not null from private.stock_safety_digest_settings where singleton)
 and exists(select 1 from public.audit_log where id='5a0c0000-0000-4000-8000-0000000000c1' and action='admin.stock_safety_digest.settings')
 then 1 else 0 end as assert_settings_saved_normalized_and_audited;

-- ---------------------------------------------------------------------------
-- 실행 만들기: 설정 시각 전에는 없고, 날짜당 한 번, 운영자는 전체·출고지 담당자는 자기 출고지(들)만
-- ---------------------------------------------------------------------------
-- 오늘 실제 틱이 만들 실행은 빈 행으로 미리 막는다.
insert into private.stock_safety_digest_runs(digest_date,settings_revision,send_time,item_count,items)
 values((clock_timestamp() at time zone 'Asia/Seoul')::date,1,'08:30',0,'[]') on conflict do nothing;
select 1/case when private.prepare_stock_safety_digest('2031-05-01 08:29:59+09')->>'status'='before_time'
 and not exists(select 1 from private.stock_safety_digest_runs where digest_date='2031-05-01') then 1 else 0 end as assert_waits_for_send_time;
select private.prepare_stock_safety_digest('2031-05-01 08:30:00+09') as prepared \gset
-- 대상: V2(창고A, 재고 4 ≤ 기준 4)·V4(창고B, 7 ≤ 10). V1(10>0)·판매 중지 V6·보관 상품은 제외.
-- 운영자 2명(전체 2개), 서원(창고A·B 담당 → 두 출고지 2개를 한 통), 김포(창고B 1개). ops는 운영자 목록 한 통뿐이다.
select 1/case when :'prepared'::jsonb->>'status'='prepared' and (:'prepared'::jsonb->>'items')::integer=2
 and (:'prepared'::jsonb->>'deliveries')::integer=4
 and (select jsonb_agg(i->>'variantId' order by i->>'variantId')=(select jsonb_agg(x order by x) from jsonb_array_elements_text(jsonb_build_array(:'v2',:'v4')) x)
  from private.stock_safety_digest_runs r,jsonb_array_elements(r.items) i where r.digest_date='2031-05-01')
 and (select jsonb_object_agg(recipient,audience||':'||item_count) from private.stock_safety_digest_deliveries where digest_date='2031-05-01')
  =jsonb_build_object('ops@example.test','operator:2','md@example.test','operator:2','seowon@example.test','origin:2','gimpo@example.test','origin:1')
 and (select origin_names=array['TEST 재고대조 창고A','TEST 재고대조 창고B'] from private.stock_safety_digest_deliveries
   where digest_date='2031-05-01' and recipient='seowon@example.test')
 and private.prepare_stock_safety_digest('2031-05-01 23:00:00+09')->>'status'='already_prepared'
 then 1 else 0 end as assert_run_once_with_audiences;

-- 선점: 2031-05-01 발송 4건(출고지 담당자는 자기 출고지 옵션만, 여러 출고지면 그 출고지들 전부)
set local role service_role;
select public.claim_stock_safety_digest_jobs(25) as jobs \gset
reset role;
select 1/case when jsonb_array_length(:'jobs'::jsonb)=4
 and (select jsonb_array_length(j->'items')=2 and j->'originNames'='["TEST 재고대조 창고A","TEST 재고대조 창고B"]'::jsonb
  and (select jsonb_agg(x->>'variantId' order by x->>'variantId') from jsonb_array_elements(j->'items') x)
   =(select jsonb_agg(y order by y) from jsonb_array_elements_text(jsonb_build_array(:'v2',:'v4')) y)
  from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='seowon@example.test')
 and (select jsonb_array_length(j->'items')=1 and j->'items'->0->>'variantId'=:'v4' and j->'originNames'='["TEST 재고대조 창고B"]'::jsonb
  from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='gimpo@example.test')
 and (select j->'items'->0->>'erpCode'='STOCKRC-ERP-2' from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='ops@example.test')
 and (select bool_and(jsonb_array_length(j->'items')=2 and j->'originNames'='[]'::jsonb) from jsonb_array_elements(:'jobs'::jsonb) j where j->>'audience'='operator')
 and (select count(*)=4 from private.stock_safety_digest_deliveries where digest_date='2031-05-01' and email_status='processing' and attempts=1)
 then 1 else 0 end as assert_claim_contents;
select (select j->>'id' from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='ops@example.test') as job_ops,
 (select j->>'claimToken' from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='ops@example.test') as claim_ops,
 (select j->>'id' from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='md@example.test') as job_md,
 (select j->>'claimToken' from jsonb_array_elements(:'jobs'::jsonb) j where j->>'recipient'='md@example.test') as claim_md \gset

-- dispatcher: 출처 짝·전용 gate. 다른 출처의 #191 gate는 그대로(꺼짐)다.
set local role service_role;
select pg_temp.expect_error(format('select public.enqueue_email_intent(%L,%L,%L,%L,%L)','stock_safety_digest',repeat('a',64),repeat('b',64),'order_delay_notice','stock_safety_digest_v1'),'invalid_email_message_kind');
select public.enqueue_email_intent('stock_safety_digest',repeat('c',64),repeat('d',64),'stock_safety_digest','stock_safety_digest_v1')->>'intentId' as intent_ops \gset
select public.enqueue_email_intent('stock_safety_digest',repeat('e',64),repeat('f',64),'stock_safety_digest','stock_safety_digest_v1')->>'intentId' as intent_md \gset
select public.enqueue_email_intent('auth_hook',repeat('1',64),repeat('2',64),'auth_signup','auth_signup_v1')->>'intentId' as intent_auth \gset
select 1/case when public.bind_stock_safety_digest_intent(:'job_ops',:'claim_ops',:'intent_ops')
 and not public.bind_stock_safety_digest_intent(:'job_ops',gen_random_uuid(),:'intent_ops')
 and public.bind_stock_safety_digest_intent(:'job_md',:'claim_md',:'intent_md')
 and public.claim_email_intent_dispatch(:'intent_ops',repeat('d',64))->>'kind'='claimed'
 and public.claim_email_intent_dispatch(:'intent_auth',repeat('2',64))->>'kind'='disabled'
 then 1 else 0 end as assert_bind_and_dedicated_gate;
select pg_temp.expect_error(format('select public.bind_stock_safety_digest_intent(%L,%L,%L)',:'job_ops',:'claim_ops',:'intent_auth'),'stock_digest_intent_mismatch');
reset role;
-- 공급사 수락 → 발송 완료. 재시도 가능한 실패 → 10분 뒤 다시 대기.
update private.email_intents set state='accepted',accepted_at=now() where id=:'intent_ops';
set local role service_role;
select 1/case when public.finish_stock_safety_digest_job(:'job_ops',:'claim_ops','sent',null,false)
 and public.finish_stock_safety_digest_job(:'job_md',:'claim_md','failed','provider_retryable',true)
 and not public.finish_stock_safety_digest_job(:'job_md',:'claim_md','failed','provider_retryable',true)
 then 1 else 0 end as assert_finish_results;
reset role;
select 1/case when (select email_status='sent' and error_code is null and email_intent_id=:'intent_ops'::uuid from private.stock_safety_digest_deliveries where id=:'job_ops')
 and (select email_status='queued' and retryable and error_code='provider_retryable' and available_at>clock_timestamp()+interval '9 minutes'
  from private.stock_safety_digest_deliveries where id=:'job_md')
 then 1 else 0 end as assert_sent_and_requeued;

-- 하루가 지난 요약은 보내지 않는다. 꺼지면 선점하지 않는다.
update private.stock_safety_digest_runs set created_at=clock_timestamp()-interval '21 hours' where digest_date='2031-05-01';
update private.stock_safety_digest_deliveries set available_at=clock_timestamp()-interval '1 minute' where id=:'job_md';
set local role service_role;
select public.claim_stock_safety_digest_jobs(25) as jobs_after_expiry \gset
reset role;
select 1/case when (select email_status='failed' and error_code='digest_expired' from private.stock_safety_digest_deliveries where id=:'job_md')
 and not exists(select 1 from jsonb_array_elements(:'jobs_after_expiry'::jsonb) j where j->>'id'=:'job_md')
 then 1 else 0 end as assert_stale_digest_expires;
update private.stock_safety_digest_settings set enabled=false,enabled_at=null where singleton;
update private.stock_safety_digest_deliveries set email_status='queued',error_code=null,available_at=clock_timestamp()-interval '1 minute' where id=:'job_md';
update private.stock_safety_digest_runs set created_at=clock_timestamp() where digest_date='2031-05-01';
set local role service_role;
select 1/case when public.claim_stock_safety_digest_jobs(25)='[]'::jsonb
 and public.claim_email_intent_dispatch(:'intent_md',repeat('f',64))->>'kind'='disabled'
 then 1 else 0 end as assert_disabled_digest_claims_nothing;
reset role;
select 1/case when private.prepare_stock_safety_digest('2031-05-02 09:00:00+09')->>'status'='disabled' then 1 else 0 end as assert_disabled_prepares_nothing;

rollback;
