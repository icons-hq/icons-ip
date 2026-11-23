\set ON_ERROR_STOP on
-- 교환 회수 불량 재고(원장 CLM-046, 관련 CLM-045·CAT-091). 한 트랜잭션 안에서 합성 주문을 만들고 끝에 되돌린다 — 결제사·택배사 호출 없음.
--  1. 하자·오배송 교환은 회수를 확인한 출고지의 재고 처리를 정하기 전에는 재출고하지 않는다(판매 재고 복원 없음).
--  2. 불량으로 고른 회수품은 재출고 때 판매 재고로 되돌리지 않고 같은 거래에서 불량 재고 원장(출처 교환)에 기록된다.
--     보낸 옵션의 재고는 그대로 줄어든다. '모두 정상 복원'도 결정이며 지금처럼 복원한다.
--  3. 원장 목록·옵션별 합계·재고 대조 흐름이 교환 불량을 읽는다(불량 회수분은 '돌아온 수량'이 아니다).
--  4. 단순 변심 교환은 결정 없이 지금처럼 복원한다. 사유 정정은 선택을 그대로 두고, 반품↔교환 전환은 선택과 결정을 지운다.
--  5. 회수 생략 출고지는 결정이 필요 없고 고를 수도 없다. 그룹상품 교환(배송 건 없는 옛 주문)도 같은 규칙이다.
--  6. 교환에서 불량으로 기록된 품목도 뒤의 반품에서 다시 고를 수 있다(기록은 이력이고 막지 않는다).
begin;
-- 합성 운송장번호를 쓴다. 택배사별 번호 형식(한진·우체국)은 tracking_number_integrity.sql이 보므로 이 트랜잭션에서만 끈다.
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.et_id(kind text,n integer) returns uuid language sql immutable as $$select md5('exchange-defective:'||kind||':'||n)::uuid$$;
create function pg_temp.et_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'exchange defective assertion: %',label;end if;end$$;
create function pg_temp.et_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected exchange defective rejection: %',expected;end$$;
create function pg_temp.et_plan(claim_n integer,shipment uuid,items uuid[]) returns text language sql volatile as $$
 select format('select public.admin_plan_claim_exchange_defective_stock(%L,%L,%L::uuid[])',pg_temp.et_id('claim',claim_n),shipment,items)$$;

-- 0. 쓰기 경로·도우미·결정 원장은 봉인돼 있다.
select pg_temp.et_assert(
 has_function_privilege('authenticated','public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[])','execute')
 and not has_function_privilege('anon','public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[])','execute')
 and not has_function_privilege('service_role','public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[])','execute')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('claim_exchange_stock_decision_json','record_claim_exchange_defective_stock')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and not has_table_privilege('authenticated','private.claim_exchange_stock_decisions','select')
 and not has_table_privilege('service_role','private.claim_exchange_stock_decisions','select')
 and (select relrowsecurity from pg_class where oid='private.claim_exchange_stock_decisions'::regclass)
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[])'
  and capability='sales.manage' and guard_kind='write'),
 'exchange defective writer, helpers and decisions are sealed');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.et_id('user',n),'authenticated','authenticated','exchange-defective-'||n||'@example.test',now(),'{}','{}' from generate_series(1,4)n;
update public.profiles set nickname='TEST 교환불량 '||right(id::text,6),
 role=case when id in(pg_temp.et_id('user',2),pg_temp.et_id('user',4)) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.et_id('user',n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.et_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.et_id('user',1),'primary');
-- 사용자 4: 반품·교환 처리 권한(sales.manage)이 없는 물류 담당.
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.et_id('user',4),'logistics');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('et-ip','TEST 교환 불량','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.et_id('origin',1),'et-gimpo','TEST 김포','hanjin',0,'TEST 김포 반송지',true),
 (pg_temp.et_id('origin',2),'et-namyangju','TEST 남양주','hanjin',0,'TEST 남양주 반송지',true);
insert into public.goods(id,ip_id,name,price,stock,stock_qty,origin_id)
 select 'et-good-'||n,'et-ip','TEST 교환불량 굿즈 '||n,1000,'ok',10,pg_temp.et_id('origin',case when n in(2,6) then 2 else 1 end) from generate_series(1,8)n;
insert into public.goods_variants(id,good_id,name,code,price,stock_qty,sort_order) values
 (pg_temp.et_id('variant',1),'et-good-1','TEST 파랑','ET-BLUE',1000,5,1),
 (pg_temp.et_id('variant',2),'et-good-2','TEST 빨강','ET-RED',1000,5,1),
 (pg_temp.et_id('variant',3),'et-good-3','TEST 노랑','ET-YELLOW',1000,5,1);
create function pg_temp.et_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;
create function pg_temp.et_stock(variant uuid) returns integer language sql stable as $$select stock_qty from public.goods_variants where id=variant$$;
-- 재고 대조 흐름: '돌아온 수량/돌아왔지만 재고 미반영/나간 수량'.
create function pg_temp.et_flow(variant uuid,as_of timestamptz) returns text language sql stable as $$
 select f.returned_since_qty||'/'||f.awaiting_return_qty||'/'||f.shipped_since_qty from private.stock_reconcile_flows(array[variant],as_of) f$$;
-- 굿즈 7·8은 그룹상품(같은 그룹의 회원 옵션)이라 교환이 그룹 배정 경로를 탄다.
insert into private.goods_groups(id,name,option_names,common_good_id,created_by,updated_by)
 values(pg_temp.et_id('group',1),'TEST 교환 그룹',array['색상'],'et-good-7',pg_temp.et_id('user',1),pg_temp.et_id('user',1));
insert into private.goods_group_members(group_id,good_id,variant_id,option_values,sort_order)
 select pg_temp.et_id('group',1),'et-good-'||n,pg_temp.et_default('et-good-'||n),array[n::text],n-7 from generate_series(7,8)n;

-- 주문 1: 김포(굿즈1 ×2)·남양주(굿즈2 ×1) 하자 교환 · 주문 2: 단순 변심 교환 · 주문 3: 전환 왕복 하자 교환 · 주문 4: 사유 정정(변심→하자)
-- 주문 5: 회수 생략 하자 교환 · 주문 6: 배송 건 없는 옛 주문의 그룹상품 하자 교환(레거시 회수). 배송 건 n은 품목 n 하나를 싣는다.
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method,shipped_at,delivered_at)
 select pg_temp.et_id('order',n),pg_temp.et_id('user',2),'delivered',5000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 교환로 1','address2','101호'),
  'card'::public.order_payment_method,now()-interval '3 days',now()-interval '2 days' from generate_series(1,6)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_ip_id_snapshot)
 select pg_temp.et_id('item',k.item),pg_temp.et_id('order',k.ord),'et-good-'||k.good,pg_temp.et_default('et-good-'||k.good),k.qty,1000,'TEST 교환불량 굿즈 '||k.good,'et-ip'
 from (values(1,1,1,2),(2,1,2,1),(3,2,3,1),(4,3,4,1),(5,4,5,1),(6,5,6,1),(7,6,7,2)) k(item,ord,good,qty);
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.et_id('shipment',k.item),pg_temp.et_id('order',k.ord),pg_temp.et_id('origin',k.origin),case k.origin when 1 then 'TEST 김포' else 'TEST 남양주' end,
  0,'{}','delivered','hanjin','ETSALE00000'||k.item,now()-interval '3 days',now()-interval '2 days'
 from (values(1,1,1),(2,1,2),(3,2,1),(4,3,1),(5,4,1),(6,5,2)) k(item,ord,origin);
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.et_id('order',k.ord),pg_temp.et_id('shipment',k.item),pg_temp.et_id('item',k.item),k.qty
 from (values(1,1,2),(2,1,1),(3,2,1),(4,3,1),(5,4,1),(6,5,1)) k(item,ord,qty);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values
 (pg_temp.et_id('claim',1),pg_temp.et_id('order',1),pg_temp.et_id('user',2),'TEST 김포·남양주 하자 교환','exchange','requested','defect'),
 (pg_temp.et_id('claim',2),pg_temp.et_id('order',2),pg_temp.et_id('user',2),'TEST 단순 변심 교환','exchange','requested','change_of_mind'),
 (pg_temp.et_id('claim',3),pg_temp.et_id('order',3),pg_temp.et_id('user',2),'TEST 전환 왕복 하자 교환','exchange','requested','defect'),
 (pg_temp.et_id('claim',4),pg_temp.et_id('order',4),pg_temp.et_id('user',2),'TEST 사유 정정 교환','exchange','requested','change_of_mind'),
 (pg_temp.et_id('claim',5),pg_temp.et_id('order',5),pg_temp.et_id('user',2),'TEST 회수 생략 하자 교환','exchange','requested','defect');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type,collection_policy,collected_at) values
 (pg_temp.et_id('claim',6),pg_temp.et_id('order',6),pg_temp.et_id('user',2),'TEST 그룹상품 하자 교환','exchange','collected','defect','legacy',now()-interval '1 hour');

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub',pg_temp.et_id('user',1)::text,true);
select public.admin_decide_order_claim(pg_temp.et_id('claim',n),'approve',null) from generate_series(1,5)n;
select clock_timestamp() as t0 \gset

-- 1. 회수 확인 전에는 고를 수 없고, 반품용 선택·권한 없는 담당자는 거절된다.
select pg_temp.et_error(pg_temp.et_plan(1,pg_temp.et_id('shipment',1),array[pg_temp.et_id('item',1)]),'exchange_defective_not_collected');
select pg_temp.et_error(format('select public.admin_plan_claim_defective_stock(%L,%L::uuid[])',pg_temp.et_id('claim',1),array[pg_temp.et_id('item',1)]),'defective_stock_return_only');
select set_config('request.jwt.claim.sub',pg_temp.et_id('user',4)::text,true);
select pg_temp.et_error(pg_temp.et_plan(1,pg_temp.et_id('shipment',1),'{}'),'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.et_id('user',1)::text,true);

-- 2. 김포 입고: 결정 전에는 회수분이 '돌아왔고 아직 재고 미반영'이다. 하자 교환은 결정 없이 재출고하지 않는다.
select public.admin_record_order_claim_origin_collection(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),'TEST 김포 입고 2개 확인');
select pg_temp.et_assert(pg_temp.et_flow(pg_temp.et_default('et-good-1'),:'t0') = '2/2/0','collected units count as returned before the decision');
select pg_temp.et_error(format('select private.record_order_claim_shipment_reshipment(%L,%L,''hanjin'',''ETGIMPO00001'',%L::jsonb)',pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.et_id('item',1),'variantId',pg_temp.et_id('variant',1)))),'exchange_stock_decision_required');
select pg_temp.et_assert(pg_temp.et_stock(pg_temp.et_default('et-good-1'))=10 and pg_temp.et_stock(pg_temp.et_id('variant',1))=5
 and not exists(select 1 from public.order_claim_reshipments where claim_id=pg_temp.et_id('claim',1)),'an undecided defect exchange moves no stock');
select pg_temp.et_assert((select (t#>>'{stockDecision,required}')::boolean and not(t#>>'{stockDecision,decided}')::boolean
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.et_id('claim',1))#>'{claim,reshipmentTargets}') t where t->>'shipmentId'=pg_temp.et_id('shipment',1)::text),
 'operator detail shows the pending decision');

-- 3. 선택 검증: 그 출고지 품목만, 회수 확인한 출고지만, 대상 배송 건만, null 원소 거절.
select pg_temp.et_error(pg_temp.et_plan(1,pg_temp.et_id('shipment',1),array[pg_temp.et_id('item',2)]),'defective_stock_item_not_in_order');
select pg_temp.et_error(pg_temp.et_plan(1,pg_temp.et_id('shipment',2),'{}'),'exchange_defective_not_collected');
select pg_temp.et_error(pg_temp.et_plan(1,pg_temp.et_id('shipment',3),'{}'),'reshipment_shipment_not_found');
select pg_temp.et_error(format('select public.admin_plan_claim_exchange_defective_stock(%L,%L,array[%L,null]::uuid[])',pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),pg_temp.et_id('item',1)),'22023');

-- 4. 불량 선택 → 모두 복원으로 바꿔도 결정은 남는다 → 다시 불량. 저장된 불량은 재고 대조에서 '돌아온 수량'이 아니다.
select pg_temp.et_assert(public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),array[pg_temp.et_id('item',1)])
  = jsonb_build_object('claimId',pg_temp.et_id('claim',1),'shipmentId',pg_temp.et_id('shipment',1),'planned',1,'decided',true),'defective choice saved');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),'{}'::uuid[])->>'planned' as restore_all \gset
select pg_temp.et_assert(:'restore_all'='0' and not exists(select 1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',1))
 and exists(select 1 from private.claim_exchange_stock_decisions where claim_id=pg_temp.et_id('claim',1) and shipment_id=pg_temp.et_id('shipment',1)),
 'restore-all is a decision too');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),array[pg_temp.et_id('item',1)])->>'planned' as defective_again \gset
select pg_temp.et_assert(:'defective_again'='1'
 and (select state='planned' and source='exchange' and qty=2 and shipment_id=pg_temp.et_id('shipment',1) and planned_by=pg_temp.et_id('user',1)
  from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',1))
 and (select count(*)=3 from public.audit_log where action='admin.order.claim_defective_stock_planned' and diff->>'claimId'=pg_temp.et_id('claim',1)::text and diff->>'claimType'='exchange')
 and (select (t#>>'{stockDecision,decided}')::boolean and t#>'{stockDecision,defectiveOrderItemIds}'=jsonb_build_array(pg_temp.et_id('item',1))
   and t#>'{stockDecision,recordedOrderItemIds}'='[]'::jsonb
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.et_id('claim',1))#>'{claim,reshipmentTargets}') t where t->>'shipmentId'=pg_temp.et_id('shipment',1)::text)
 and (select not(t#>>'{stockDecision,decided}')::boolean
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.et_id('claim',1))#>'{claim,reshipmentTargets}') t where t->>'shipmentId'=pg_temp.et_id('shipment',2)::text)
 and pg_temp.et_flow(pg_temp.et_default('et-good-1'),:'t0') = '0/0/0',
 'saved defective units are out of the returned flow and visible per origin');

-- 5. 김포 재출고(파랑으로 교환): 불량 2개는 판매 재고로 돌아오지 않고, 파랑 2개는 그대로 빠진다. 같은 거래에서 원장에 기록된다.
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',1),'hanjin','ETGIMPO00001',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.et_id('item',1),'variantId',pg_temp.et_id('variant',1)))) as first_reship \gset
select pg_temp.et_assert(:'first_reship'='reshipped'
 and pg_temp.et_stock(pg_temp.et_default('et-good-1'))=10 and pg_temp.et_stock(pg_temp.et_id('variant',1))=3
 and (select d.state='recorded' and d.source='exchange' and d.qty=2 and d.good_id='et-good-1' and d.variant_id=pg_temp.et_default('et-good-1')
   and d.variant_code is not null and d.recorded_by=pg_temp.et_id('user',1) and d.shipment_id=pg_temp.et_id('shipment',1) and d.reshipment_id=r.id
  from private.claim_defective_stock d join public.order_claim_reshipments r on r.claim_id=d.claim_id and r.shipment_id=pg_temp.et_id('shipment',1)
  where d.claim_id=pg_temp.et_id('claim',1))
 and (select (diff->>'qty')::integer=2 and diff->>'claimType'='exchange' and (diff->>'physicalStockDelta')::integer=0
  from public.audit_log where action='order.claim_defective_stock_recorded' and diff->>'orderItemId'=pg_temp.et_id('item',1)::text)
 and (select diff->'defectiveOrderItemIds'=jsonb_build_array(pg_temp.et_id('item',1)) from public.audit_log
  where action='admin.order.claim_reshipped' and diff->>'shipmentId'=pg_temp.et_id('shipment',1)::text),
 'defective units stay out of sellable stock and are recorded with the reshipment');
select pg_temp.et_error(pg_temp.et_plan(1,pg_temp.et_id('shipment',1),'{}'),'defective_stock_claim_closed');
select pg_temp.et_error(format('update private.claim_defective_stock set qty=1 where claim_id=%L',pg_temp.et_id('claim',1)),'defective_stock_ledger_immutable');
select pg_temp.et_assert((select t#>'{stockDecision,recordedOrderItemIds}'=jsonb_build_array(pg_temp.et_id('item',1))
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.et_id('claim',1))#>'{claim,reshipmentTargets}') t where t->>'shipmentId'=pg_temp.et_id('shipment',1)::text),
 'operator detail shows the recorded defective units');

-- 6. 원장 목록·옵션별 합계·재고 대조가 교환 불량을 읽는다. 교환은 '기록 필요'로 남지 않는다.
select pg_temp.et_assert(
 (select (v->>'qty')::integer=2 from jsonb_array_elements(public.admin_list_defective_stock(500)->'variants') v where v->>'variantId'=pg_temp.et_default('et-good-1')::text)
 and (select e->>'claimType'='exchange' and e->>'claimId'=pg_temp.et_id('claim',1)::text
  from jsonb_array_elements(public.admin_list_defective_stock(500)->'entries') e where e->>'orderItemId'=pg_temp.et_id('item',1)::text)
 and not exists(select 1 from jsonb_array_elements(public.admin_list_defective_stock(500)->'pending') p where p->>'claimId'=pg_temp.et_id('claim',1)::text)
 and public.admin_defective_stock_by_variant(array[pg_temp.et_default('et-good-1')])=jsonb_build_array(jsonb_build_object('variantId',pg_temp.et_default('et-good-1'),'qty',2))
 and pg_temp.et_flow(pg_temp.et_default('et-good-1'),:'t0') = '0/0/0'
 and pg_temp.et_flow(pg_temp.et_id('variant',1),:'t0')='0/0/2',
 'ledger list, per-variant total and reconcile flows read the exchange defective');

-- 7. 남양주: 회수 확인 → '모두 정상 복원' 결정 → 재출고(빨강). 회수품 +1·빨강 −1, 두 곳 모두 재출고돼 종결.
select public.admin_record_order_claim_origin_collection(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',2),'TEST 남양주 입고 1개 확인');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',2),'{}'::uuid[])->>'planned' as namyangju_planned \gset
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',1),pg_temp.et_id('shipment',2),'hanjin','ETNAMYANG002',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.et_id('item',2),'variantId',pg_temp.et_id('variant',2)))) as second_reship \gset
select pg_temp.et_assert(:'namyangju_planned'='0' and :'second_reship'='completed'
 and pg_temp.et_stock(pg_temp.et_default('et-good-2'))=11 and pg_temp.et_stock(pg_temp.et_id('variant',2))=4
 and (select count(*)=1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',1))
 and (select diff->'defectiveOrderItemIds'='[]'::jsonb from public.audit_log where action='admin.order.claim_reshipped' and diff->>'shipmentId'=pg_temp.et_id('shipment',2)::text)
 and pg_temp.et_flow(pg_temp.et_default('et-good-2'),:'t0') = '1/0/0',
 'a restore-all decision restores the collected item as before');

-- 8. 단순 변심 교환은 결정 없이 지금처럼 회수품을 복원한다.
select public.admin_record_order_claim_origin_collection(pg_temp.et_id('claim',2),pg_temp.et_id('shipment',3),'TEST 단순 변심 입고');
select pg_temp.et_assert((select (t#>>'{stockDecision,required}')::boolean=false
  from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.et_id('claim',2))#>'{claim,reshipmentTargets}') t),'change-of-mind exchange needs no decision');
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',2),pg_temp.et_id('shipment',3),'hanjin','ETCHANGE0003',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.et_id('item',3),'variantId',pg_temp.et_id('variant',3)))) as change_reship \gset
select pg_temp.et_assert(:'change_reship'='completed' and pg_temp.et_stock(pg_temp.et_default('et-good-3'))=11 and pg_temp.et_stock(pg_temp.et_id('variant',3))=4
 and not exists(select 1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',2)),'change-of-mind exchange restores without a decision');

-- 9. 반품↔교환 전환: 교환 선택·결정이 지워지고, 반품 선택(반품용 경로)도 다시 교환이 되면 지워진다. 다시 교환이 되면 결정부터 다시 한다.
select public.admin_record_order_claim_origin_collection(pg_temp.et_id('claim',3),pg_temp.et_id('shipment',4),'TEST 전환 입고');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',3),pg_temp.et_id('shipment',4),array[pg_temp.et_id('item',4)])->>'planned' as conv_planned \gset
select public.admin_convert_order_claim_type(pg_temp.et_id('claim',3),pg_temp.et_id('conv-op',1),c.claim_revision,'return','TEST 고객 요청으로 반품 전환',true,null) is not null as to_return
 from public.order_cancellation_requests c where c.id=pg_temp.et_id('claim',3) \gset
select pg_temp.et_assert(:'conv_planned'='1' and :'to_return'::boolean
 and not exists(select 1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',3))
 and not exists(select 1 from private.claim_exchange_stock_decisions where claim_id=pg_temp.et_id('claim',3))
 and (select (diff->>'defectivePlanCleared')::integer=1 and (diff->>'stockDecisionCleared')::integer=1 from public.audit_log where id=pg_temp.et_id('conv-op',1)),
 'conversion to a return clears the exchange choice and the origin decision');
select pg_temp.et_error(pg_temp.et_plan(3,pg_temp.et_id('shipment',4),'{}'),'defective_stock_exchange_only');
select public.admin_plan_claim_defective_stock(pg_temp.et_id('claim',3),array[pg_temp.et_id('item',4)])->>'planned' as return_planned \gset
select public.admin_convert_order_claim_type(pg_temp.et_id('claim',3),pg_temp.et_id('conv-op',2),c.claim_revision,'exchange','TEST 다시 교환으로 전환',true,null) is not null as back_to_exchange
 from public.order_cancellation_requests c where c.id=pg_temp.et_id('claim',3) \gset
select pg_temp.et_assert(:'return_planned'='1' and :'back_to_exchange'::boolean
 and not exists(select 1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',3))
 and (select (diff->>'defectivePlanCleared')::integer=1 and (diff->>'stockDecisionCleared')::integer=0 from public.audit_log where id=pg_temp.et_id('conv-op',2)),
 'converting back to an exchange clears the return choice');
select pg_temp.et_error(format('select private.record_order_claim_shipment_reshipment(%L,%L,''hanjin'',''ETCONVERT004'',''[]''::jsonb)',pg_temp.et_id('claim',3),pg_temp.et_id('shipment',4)),
 'exchange_stock_decision_required');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',3),pg_temp.et_id('shipment',4),array[pg_temp.et_id('item',4)])->>'planned' as conv_replanned \gset
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',3),pg_temp.et_id('shipment',4),'hanjin','ETCONVERT004','[]'::jsonb) as conv_reship \gset
select pg_temp.et_assert(:'conv_replanned'='1' and :'conv_reship'='completed' and pg_temp.et_stock(pg_temp.et_default('et-good-4'))=9
 and (select state='recorded' and qty=1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',3)),
 'the round-tripped exchange reships after a fresh decision; the defective unit is not restored');

-- 10. 교환에서 불량으로 기록된 품목도 뒤의 반품에서 다시 고를 수 있다(교환품 배송완료 뒤 새 반품).
select public.admin_record_order_claim_shipment_reshipment_delivery(pg_temp.et_id('claim',3),pg_temp.et_id('shipment',4),'TEST 교환품 수령 확인') as conv_delivered \gset
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type,collection_policy,collected_at) values
 (pg_temp.et_id('claim',7),pg_temp.et_id('order',3),pg_temp.et_id('user',2),'TEST 교환품 반품','return','collected','defect','legacy',now());
-- 한 문장의 하위 조회는 그 문장 시작 시점을 보므로, 쓰기 호출과 확인을 나눈다.
select public.admin_plan_claim_defective_stock(pg_temp.et_id('claim',7),array[pg_temp.et_id('item',4)])->>'planned' as later_return_planned \gset
select pg_temp.et_assert(:'conv_delivered'='delivered' and :'later_return_planned'='1'
 and (select count(*)=2 and count(*) filter(where state='recorded' and source='exchange')=1 and count(*) filter(where state='planned' and source='return')=1
  from private.claim_defective_stock where order_item_id=pg_temp.et_id('item',4)),
 'a recorded exchange defective does not block a later return choice for the same item');

-- 11. 사유 정정(변심→하자)은 선택·결정을 그대로 둔다(검수 결과). 정정 뒤 재출고는 그 선택대로 불량을 기록한다.
select public.admin_record_order_claim_origin_collection(pg_temp.et_id('claim',4),pg_temp.et_id('shipment',5),'TEST 사유 정정 입고');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',4),pg_temp.et_id('shipment',5),array[pg_temp.et_id('item',5)])->>'planned' as optional_planned \gset
select public.admin_change_order_claim_reason(pg_temp.et_id('claim',4),pg_temp.et_id('reason-op',1),c.claim_revision,pg_temp.et_id('user',1),'defect',
 'TEST 검수로 인쇄 불량 확인','TEST 고객과 하자 정정 합의',true,true) is not null as reason_changed
 from public.order_cancellation_requests c where c.id=pg_temp.et_id('claim',4) \gset
select pg_temp.et_assert(:'optional_planned'='1' and :'reason_changed'::boolean
 and (select reason_type='defect' from public.order_cancellation_requests where id=pg_temp.et_id('claim',4))
 and exists(select 1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',4) and state='planned')
 and exists(select 1 from private.claim_exchange_stock_decisions where claim_id=pg_temp.et_id('claim',4)),'reason correction keeps the inspected choice');
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',4),pg_temp.et_id('shipment',5),'hanjin','ETREASON0005','[]'::jsonb) as reason_reship \gset
select pg_temp.et_assert(:'reason_reship'='completed' and pg_temp.et_stock(pg_temp.et_default('et-good-5'))=9
 and (select state='recorded' from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',4)),'the kept choice is recorded at reshipment');

-- 12. 회수 생략 출고지: 회수품이 없어 결정이 필요 없고 고를 수도 없다. 회수품은 복원하지 않는다.
insert into storage.objects(bucket_id,name,metadata) values
 ('claim-evidence-private',pg_temp.et_id('claim',5)||'/'||pg_temp.et_id('file',1)||'.jpg',jsonb_build_object('mimetype','image/jpeg','size',2048));
select public.admin_register_claim_evidence_file(pg_temp.et_id('claim',5),pg_temp.et_id('file',1),'image/jpeg',2048,repeat('e',64))->>'id' as evidence_one \gset
select public.admin_waive_order_claim_collection(pg_temp.et_id('claim',5),pg_temp.et_id('shipment',6),
 jsonb_build_object('reason','TEST 박스 파손 사진으로 회수 생략','evidenceFileIds',jsonb_build_array(pg_temp.et_id('file',1))))->>'claimId' as waived_claim \gset
select pg_temp.et_error(pg_temp.et_plan(5,pg_temp.et_id('shipment',6),'{}'),'exchange_defective_collection_waived');
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',5),pg_temp.et_id('shipment',6),'hanjin','ETWAIVED0006','[]'::jsonb) as waived_reship \gset
select pg_temp.et_assert(:'evidence_one'=pg_temp.et_id('file',1)::text and :'waived_claim'=pg_temp.et_id('claim',5)::text and :'waived_reship'='completed'
 and pg_temp.et_stock(pg_temp.et_default('et-good-6'))=9
 and not exists(select 1 from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',5))
 and not exists(select 1 from private.claim_exchange_stock_decisions where claim_id=pg_temp.et_id('claim',5)),
 'a waived origin needs no stock decision and restores nothing');

-- 13. 그룹상품 교환(배송 건 없는 옛 주문, 대상은 주문 전체): 결정 없이는 막히고, 불량은 실물 세대 복원 기록도 회수품 복원도 없다.
select pg_temp.et_error(format('select private.record_order_claim_shipment_reshipment(%L,null,''hanjin'',''ETGROUP00007'',%L::jsonb)',pg_temp.et_id('claim',6),
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.et_id('item',7),'variantId',pg_temp.et_default('et-good-8')))),'exchange_stock_decision_required');
select public.admin_plan_claim_exchange_defective_stock(pg_temp.et_id('claim',6),null,array[pg_temp.et_id('item',7)])->>'planned' as group_planned \gset
select private.record_order_claim_shipment_reshipment(pg_temp.et_id('claim',6),null,'hanjin','ETGROUP00007',
 jsonb_build_array(jsonb_build_object('orderItemId',pg_temp.et_id('item',7),'variantId',pg_temp.et_default('et-good-8')))) as group_reship \gset
select pg_temp.et_assert(:'group_planned'='1' and :'group_reship'='completed'
 and pg_temp.et_stock(pg_temp.et_default('et-good-7'))=10 and pg_temp.et_stock(pg_temp.et_default('et-good-8'))=8
 and not exists(select 1 from private.group_stock_restorations where order_item_id=pg_temp.et_id('item',7))
 and exists(select 1 from private.group_claim_reshipment_allocations where claim_id=pg_temp.et_id('claim',6) and target_good_id='et-good-8' and qty=2)
 and (select state='recorded' and qty=2 and good_id='et-good-7' and variant_id=pg_temp.et_default('et-good-7') and shipment_id is null and reshipment_id is not null
  from private.claim_defective_stock where claim_id=pg_temp.et_id('claim',6))
 and exists(select 1 from private.claim_exchange_stock_decisions where claim_id=pg_temp.et_id('claim',6) and shipment_id is null),
 'a grouped exchange records the defective returned option without a physical restoration');

rollback;
