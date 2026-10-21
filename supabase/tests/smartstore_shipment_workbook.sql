\set ON_ERROR_STOP on
-- Synthetic records only. Run against an isolated database; all fixtures roll back.
begin;
create function pg_temp.ss_id(kind integer,n integer) returns uuid language sql immutable as $$
  select ('f20e0000-0000-'||lpad(kind::text,4,'0')||'-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.ss_assert(ok boolean,label text) returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'Smart Store workbook assertion: %',label;end if;
end $$;
create function pg_temp.ss_error(statement text,expected text) returns void language plpgsql as $$begin
  begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
  raise exception 'Expected error: %',expected;
end $$;
select pg_temp.ss_assert((select provolatile='v' from pg_proc
  where oid='public.admin_smartstore_shipment_export(uuid[])'::regprocedure),
  'export RPC permits the capability and shipment row locks in PostgREST');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (pg_temp.ss_id(4000,1),'authenticated','authenticated','smartstore-workbook-admin@example.test','{}','{}',now(),now()),
  (pg_temp.ss_id(4000,2),'authenticated','authenticated','smartstore-workbook-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='admin',nickname='합성 운영자' where id=pg_temp.ss_id(4000,1);
update public.profiles set nickname='합성 구매자' where id=pg_temp.ss_id(4000,2);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ss_id(4000,1),'primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
  values(pg_temp.ss_id(4006,1),pg_temp.ss_id(4000,1),now(),now(),now()+interval '1 hour');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
  values(pg_temp.ss_id(4000,10),'smartstore-workbook-origin','합성 출고지','hanjin',2000,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key) values('smartstore-workbook-ip','합성 엑셀 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
  ('smartstore-workbook-a','smartstore-workbook-ip','합성 상품 A','문구',1000,'ok',100,pg_temp.ss_id(4000,10)),
  ('smartstore-workbook-b','smartstore-workbook-ip','합성 상품 B','문구',500,'ok',100,pg_temp.ss_id(4000,10));
create function pg_temp.ss_order(n integer) returns void language plpgsql as $$begin
  insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at,confirmed_at)
    values(pg_temp.ss_id(4001,n),pg_temp.ss_id(4000,2),'confirmed',5000,2000,
      '{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"00123","address1":"합성 기본 주소","address2":"합성 상세 주소","deliveryNote":"합성 요청"}',
      '2026-10-18T03:00:00Z','2026-10-19T03:00:00Z');
  insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,regular_unit_price_snapshot,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
    select pg_temp.ss_id(4003,n*10+case when good_id='smartstore-workbook-a' then 1 else 2 end),pg_temp.ss_id(4001,n),good_id,id,2,price,
      case when good_id='smartstore-workbook-a' then 1500 else 700 end,
      case when good_id='smartstore-workbook-a' then '주문 당시 상품 A' else '주문 당시 상품 B' end,'문구','smartstore-workbook-ip'
    from public.goods_variants where good_id in('smartstore-workbook-a','smartstore-workbook-b') and is_default;
  insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
    values(pg_temp.ss_id(4004,n),pg_temp.ss_id(4000,2),'order',pg_temp.ss_id(4001,n),'toss',5000,'paid','smartstore-workbook-payment-'||n);
  insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,expected_ship_date)
    values(pg_temp.ss_id(4002,n),pg_temp.ss_id(4001,n),pg_temp.ss_id(4000,10),'합성 출고지',2000,'{}','2026-10-21');
  insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
    select order_id,pg_temp.ss_id(4002,n),id,qty from public.order_items where order_id=pg_temp.ss_id(4001,n);
end $$;
select pg_temp.ss_order(n) from generate_series(1,9)n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
  values(pg_temp.ss_id(4005,1),'toss',pg_temp.ss_id(4000,2),'order',pg_temp.ss_id(4001,1),5000,'approved',
    'smartstore-workbook-attempt-1','smartstore-workbook-provider-1','order',pg_temp.ss_id(4004,1),now()+interval '1 day');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at)
  values(pg_temp.ss_id(4005,1),'confirm','2026-10-18T03:05:00Z');

select pg_temp.ss_assert(not has_function_privilege('anon','public.admin_smartstore_shipment_export(uuid[])','execute')
  and not has_function_privilege('service_role','public.admin_smartstore_shipment_export(uuid[])','execute')
  and not has_function_privilege('anon','public.admin_import_item_tracking_batch(jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_import_item_tracking_batch(jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_import_item_tracking_batch(jsonb)','execute'),'new RPC grants sealed');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ss_id(4000,2)::text,true);
select pg_temp.ss_error('select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,1)])','operator_capability_required');
select pg_temp.ss_error('select public.admin_import_item_tracking_batch(''[{}]'')','operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.ss_id(4000,1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ss_id(4000,1),'role','authenticated','session_id',pg_temp.ss_id(4006,1))::text,true);
select public.admin_get_order_delivery_snapshots(array[pg_temp.ss_id(4001,1)]) as legacy_delivery \gset
select public.admin_get_order_delivery_snapshots_numbered(array[pg_temp.ss_id(4001,1)]) as numbered_delivery \gset
select pg_temp.ss_assert(:'numbered_delivery'::jsonb#>>'{0,orderNumber}' ~ '^202610181[0-9]{7}$'
  and (:'numbered_delivery'::jsonb->0)-'orderNumber'=:'legacy_delivery'::jsonb->0
  and not (:'legacy_delivery'::jsonb->0 ? 'orderNumber'),'legacy strict delivery shape remains valid during DB-first rollout');
select public.admin_shipment_export(array[pg_temp.ss_id(4002,1)]) as base_export \gset
select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,1)]) as enriched_export \gset
select pg_temp.ss_assert(:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,orderNumber}' ~ '^202610181[0-9]{7}$'
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,productOrderNumber}' ~ '^202610182[0-9]{7}$'
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,shipmentNumber}' ~ '^202610183[0-9]{7}$','public references are numeric and retain the KST order date');
select public.admin_delivery_list_export_lines(array[pg_temp.ss_id(4002,1)]) as delivery_list \gset
select pg_temp.ss_assert(jsonb_array_length(:'delivery_list')=2
  and :'delivery_list'::jsonb#>>'{0,productOrderNumber}'=:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,productOrderNumber}'
  and :'delivery_list'::jsonb#>>'{0,orderNumber}'=:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,orderNumber}'
  and :'delivery_list'::jsonb#>>'{0,itemTotal}'='2000'
  and :'delivery_list'::jsonb#>>'{0,postalCode}'='00123','list export reads actual item allocations and public references');
select pg_temp.ss_assert((select count(*)=1 from public.admin_search_orders_console(p_query=>:'delivery_list'::jsonb#>>'{0,orderNumber}',p_field=>'order')),'order search accepts displayed order number');
select pg_temp.ss_assert(public.admin_search_order_items_console(p_query=>:'delivery_list'::jsonb#>>'{0,productOrderNumber}',p_field=>'item')->>'total'='1','item search accepts displayed product-order number');
select pg_temp.ss_assert(public.admin_search_shipments_notice_console('ready',p_query=>:'delivery_list'::jsonb#>>'{0,orderNumber}',p_field=>'order')->>'total'='1','dispatch search accepts displayed order number');
select pg_temp.ss_assert((select exported_at is null and status='ready' from public.order_shipments where id=pg_temp.ss_id(4002,1)),'list download does not dispatch or mark exported');
select pg_temp.ss_assert(not has_function_privilege('anon','public.admin_delivery_list_export_lines(uuid[])','execute')
  and not has_function_privilege('service_role','public.admin_delivery_list_export_lines(uuid[])','execute'),'list export permission sealed');
select pg_temp.ss_assert(((:'enriched_export'::jsonb#>'{shipments,0,lines,0}')-'smartstore')=(:'base_export'::jsonb#>'{shipments,0,lines,0}'),'existing line contract preserved');
select pg_temp.ss_assert(:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,itemId}'=pg_temp.ss_id(4003,11)::text
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,1,smartstore,itemId}'=pg_temp.ss_id(4003,12)::text,'actual item UUIDs match deterministic order');
select pg_temp.ss_assert(:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,buyerName}'='합성 구매자'
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,buyerPhone}'=''
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,address1}'='합성 기본 주소'
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,address2}'='합성 상세 주소','buyer and recipient evidence stay distinct');
select pg_temp.ss_assert((:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,paidAt}')::timestamptz='2026-10-18T03:05:00Z'
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,expectedShipDate}'='2026-10-21'
  and :'enriched_export'::jsonb#>'{shipments,0,lines,0,smartstore,shippedAt}'='null'::jsonb,'stored event times only');
select pg_temp.ss_assert(:'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,itemTotal}'='2000'
  and :'enriched_export'::jsonb#>>'{shipments,0,lines,0,smartstore,itemDiscount}'='1000'
  and :'enriched_export'::jsonb#>'{shipments,0,lines,0,smartstore,productPrice}'='null'::jsonb
  and :'enriched_export'::jsonb#>'{shipments,0,lines,0,smartstore,optionPrice}'='null'::jsonb,'legacy proven amount and unsupported split prices');
select pg_temp.ss_assert(public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,2)])#>'{shipments,0,lines,0,smartstore,paidAt}'='null'::jsonb,'no approval time fabricated from payment creation');

reset role;
-- A merge join would otherwise reorder the source reader's already sorted page.
set local enable_nestloop=off;
set local enable_hashjoin=off;
select pg_temp.ss_assert(
  (select array_agg(id order by ordinality) from public.admin_search_orders_console(p_query=>'f20e0000',p_field=>'order') with ordinality)
  = (select array_agg(id order by ordinality) from private.admin_search_orders_console_before_numbers(p_query=>'f20e0000',p_field=>'order') with ordinality),
  'numbered reader preserves the original page order under merge joins');
set local enable_nestloop=on;
set local enable_hashjoin=on;
update public.goods set price=99999,name='현재 카탈로그 변경' where id='smartstore-workbook-a';
update public.orders set calculation_version=2,volume_discount_total=200,discount_total=300,store_credit_total=500,total=4000,shipping_coupon_discount_total=100 where id=pg_temp.ss_id(4001,7);
update public.payments set amount=4000 where id=pg_temp.ss_id(4004,7);
insert into private.order_price_allocations(order_item_id,order_id,calculation_version,subtotal,volume_discount,net_subtotal,coupon_discount,store_credit_discount,paid_goods_total) values
  (pg_temp.ss_id(4003,71),pg_temp.ss_id(4001,7),2,2000,100,1900,200,300,1400),
  (pg_temp.ss_id(4003,72),pg_temp.ss_id(4001,7),2,1000,100,900,100,200,600);
insert into private.shipping_charge_components(order_id,shipment_id,good_id,origin_id,calculation_version,payment_mode,base_fee,regional_fee,total_fee,terms_snapshot,shipping_coupon_discount)
  values(pg_temp.ss_id(4001,7),pg_temp.ss_id(4002,7),'smartstore-workbook-a',pg_temp.ss_id(4000,10),2,'prepaid',1800,300,2000,'{}',100);
update public.orders set discount_total=500,total=4500 where id=pg_temp.ss_id(4001,8);
update public.payments set amount=4500 where id=pg_temp.ss_id(4004,8);
set local role authenticated;
select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,7)]) as allocated_export \gset
select pg_temp.ss_assert(:'allocated_export'::jsonb#>>'{shipments,0,lines,0,goodName}'='주문 당시 상품 A'
  and :'allocated_export'::jsonb#>>'{shipments,0,lines,0,smartstore,itemTotal}'='1400'
  and :'allocated_export'::jsonb#>>'{shipments,0,lines,0,smartstore,itemDiscount}'='1600'
  and :'allocated_export'::jsonb#>>'{shipments,0,lines,0,smartstore,sellerDiscount}'='1600'
  and :'allocated_export'::jsonb#>>'{shipments,0,lines,0,smartstore,regionalShippingFee}'='300'
  and :'allocated_export'::jsonb#>>'{shipments,0,lines,0,smartstore,shippingDiscount}'='100','immutable allocation and shipping components');
select pg_temp.ss_assert(public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,8)])#>'{shipments,0,lines,0,smartstore,itemTotal}'='null'::jsonb
  and public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,8)])#>'{shipments,0,lines,0,smartstore,itemDiscount}'='null'::jsonb,'unallocated legacy discounts remain unknown');
reset role;
update public.orders set calculation_version=2 where id=pg_temp.ss_id(4001,9);
set local role authenticated;
select pg_temp.ss_error('select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,9)])','shipment_price_allocation_missing');
reset role;
savepoint incomplete_quantity;
update public.order_shipment_items set qty=1 where order_item_id=pg_temp.ss_id(4003,11);
set local role authenticated;
select pg_temp.ss_error('select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,1)])','shipment_item_export_mismatch');
reset role;rollback to incomplete_quantity;

set local role authenticated;
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',2,'reference',:'delivery_list'::jsonb#>>'{0,productOrderNumber}','carrier','hanjin','trackingNumber','0012-3456 7890'),
  jsonb_build_object('line',3,'reference',:'delivery_list'::jsonb#>>'{1,productOrderNumber}','carrier','hanjin','trackingNumber','001234567890')
)) as imported \gset
select pg_temp.ss_assert(jsonb_array_length(:'imported')=2 and :'imported'::jsonb#>>'{0,ok}'='true'
  and :'imported'::jsonb#>>'{1,ok}'='true' and :'imported'::jsonb#>>'{0,duplicate}'='false'
  and :'imported'::jsonb#>>'{1,duplicate}'='true' and :'imported'::jsonb#>>'{1,dispatched}'='false'
  and :'imported'::jsonb#>>'{0,reference}'=:'delivery_list'::jsonb#>>'{0,productOrderNumber}' and :'imported'::jsonb#>>'{1,line}'='3','two numeric item rows create one shipment mutation and preserve original row identity');
select pg_temp.ss_assert((select status='shipping' and tracking_number='001234567890' from public.order_shipments where id=pg_temp.ss_id(4002,1)),'normalized leading-zero tracking is persisted');
select pg_temp.ss_assert(public.admin_delivery_list_export_lines(array[pg_temp.ss_id(4002,1)])#>>'{0,trackingNumber}'='001234567890','shipped rows remain readable by the list export');
select pg_temp.ss_error('select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,1)])','shipment_not_ready');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',4,'reference',pg_temp.ss_id(4003,21),'carrier','hanjin','trackingNumber','001234567890'),
  jsonb_build_object('line',5,'reference',pg_temp.ss_id(4003,22),'carrier','hanjin','trackingNumber','009999999999'),
  jsonb_build_object('line',6,'reference',pg_temp.ss_id(4003,31),'carrier','hanjin','trackingNumber','001234567890'),
  jsonb_build_object('line',7,'reference',pg_temp.ss_id(4003,32),'carrier','','trackingNumber',''),
  jsonb_build_object('line',8,'reference',pg_temp.ss_id(4003,41),'carrier','hanjin','trackingNumber','004444444444')
)) as mixed \gset
select pg_temp.ss_assert((select count(*)=4 from jsonb_array_elements(:'mixed') where value->>'ok'='false')
  and :'mixed'::jsonb#>>'{0,error}'='conflicting_shipment_tracking'
  and :'mixed'::jsonb#>>'{1,error}'='conflicting_shipment_tracking'
  and :'mixed'::jsonb#>>'{2,error}'='invalid_tracking_input'
  and :'mixed'::jsonb#>>'{3,error}'='invalid_tracking_input'
  and :'mixed'::jsonb#>>'{4,ok}'='true','conflict and invalid siblings fail closed while unrelated shipment succeeds');
select pg_temp.ss_assert((select bool_and(status='ready') from public.order_shipments where id in(pg_temp.ss_id(4002,2),pg_temp.ss_id(4002,3))),'no partial shipment on invalid sibling');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',9,'reference',pg_temp.ss_id(4003,21),'carrier','hanjin','trackingNumber','001234567890'),
  jsonb_build_object('line',10,'reference',pg_temp.ss_id(4003,999),'carrier','hanjin','trackingNumber','001234567890')
)) as unresolved \gset
select pg_temp.ss_assert(:'unresolved'::jsonb#>>'{0,error}'='item_tracking_identity_unresolved'
  and :'unresolved'::jsonb#>>'{1,error}'='shipment_item_not_found'
  and (select status='ready' from public.order_shipments where id=pg_temp.ss_id(4002,2)),'unresolvable identity blocks the file before an unknown sibling can be dispatched');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',9,'reference',pg_temp.ss_id(4001,2),'carrier','hanjin','trackingNumber','001234567890'),
  jsonb_build_object('line',10,'reference',right(pg_temp.ss_id(4003,21)::text,8),'carrier','hanjin','trackingNumber','001234567890')
)) as invalid_identity \gset
select pg_temp.ss_assert(:'invalid_identity'::jsonb#>>'{0,error}'='shipment_item_not_found'
  and :'invalid_identity'::jsonb#>>'{1,error}'='invalid_item_order_reference','no order or suffix identity fallback');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',11,'reference',pg_temp.ss_id(4003,21),'carrier','hanjin','trackingNumber','001234567890','unknown',true),
  jsonb_build_object('line',12,'reference',pg_temp.ss_id(4003,22),'carrier','hanjin','trackingNumber','001234567890')
)) as invalid_row \gset
select pg_temp.ss_assert(:'invalid_row'::jsonb#>>'{0,error}'='invalid_tracking_row'
  and :'invalid_row'::jsonb#>>'{1,error}'='invalid_tracking_row','malformed row blocks valid sibling');

reset role;
select count(*) as audit_before from public.audit_log where target='order:'||pg_temp.ss_id(4001,1)::text \gset
set local role authenticated;
select public.admin_import_item_tracking_batch((select jsonb_agg(jsonb_build_object('line',n,'reference',pg_temp.ss_id(4003,11),'carrier','hanjin','trackingNumber','001234567890')) from generate_series(1,1000)n)) as repeated \gset
select pg_temp.ss_assert(jsonb_array_length(:'repeated')=1000
  and (select count(*)=999 from jsonb_array_elements(:'repeated') where value->>'duplicate'='true')
  and not exists(select 1 from jsonb_array_elements(:'repeated') where value->>'ok'<>'true'),'1000 repeated item rows map to a single idempotent shipment');
reset role;
select pg_temp.ss_assert((select count(*) from public.audit_log where target='order:'||pg_temp.ss_id(4001,1)::text)=:'audit_before'::integer,'identical retry creates no extra dispatch audit');
set local role authenticated;
select pg_temp.ss_error('select public.admin_import_item_tracking_batch(''[]'')','invalid_tracking_batch');
select pg_temp.ss_error('select public.admin_import_item_tracking_batch(''{}'')','invalid_tracking_batch');
select pg_temp.ss_error('select public.admin_import_item_tracking_batch((select jsonb_agg(''{}''::jsonb) from generate_series(1,1001)))','invalid_tracking_batch');

-- A malformed or conflicting member must not let a valid member dispatch a pack.
select public.admin_get_shipment_packs(array[pg_temp.ss_id(4002,5),pg_temp.ss_id(4002,6)]) as legacy_pack_preview \gset
select public.admin_get_shipment_packs_numbered(array[pg_temp.ss_id(4002,5),pg_temp.ss_id(4002,6)]) as pack_preview \gset
select pg_temp.ss_assert(:'pack_preview'::jsonb->>'version'=:'legacy_pack_preview'::jsonb->>'version'
  and :'pack_preview'::jsonb#>>'{rows,0,orderNumber}' ~ '^202610181[0-9]{7}$'
  and :'pack_preview'::jsonb#>>'{rows,0,shipmentNumber}' ~ '^202610183[0-9]{7}$'
  and (:'pack_preview'::jsonb#>'{rows,0}')-'orderNumber'-'shipmentNumber'=:'legacy_pack_preview'::jsonb#>'{rows,0}',
  'numbered packing read preserves the exact legacy mutation version and row contract');
select public.admin_change_shipment_pack(array[pg_temp.ss_id(4002,5),pg_temp.ss_id(4002,6)],'create',:'pack_preview'::jsonb->>'version',
  '합성 합포장 검증',pg_temp.ss_id(4007,1),pg_temp.ss_id(4000,1),pg_temp.ss_id(4006,1));
select pg_temp.ss_error('select public.admin_smartstore_shipment_export(array[pg_temp.ss_id(4002,5)])','shipment_pack_selection_required');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',13,'reference',pg_temp.ss_id(4003,51),'carrier','hanjin','trackingNumber','005555555555'),
  jsonb_build_object('line',14,'reference',pg_temp.ss_id(4003,61),'carrier','','trackingNumber','')
)) as pack_invalid \gset
select pg_temp.ss_assert(not exists(select 1 from jsonb_array_elements(:'pack_invalid') where value->>'ok'='true')
  and (select bool_and(status='ready') from public.order_shipments where id in(pg_temp.ss_id(4002,5),pg_temp.ss_id(4002,6))),'invalid packed member blocks all packed dispatch');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',15,'reference',pg_temp.ss_id(4003,51),'carrier','hanjin','trackingNumber','005555555555'),
  jsonb_build_object('line',16,'reference',pg_temp.ss_id(4003,61),'carrier','hanjin','trackingNumber','006666666666')
)) as pack_conflict \gset
select pg_temp.ss_assert((select bool_and(value->>'error'='shipment_pack_tracking_conflict') from jsonb_array_elements(:'pack_conflict'))
  and (select bool_and(status='ready') from public.order_shipments where id in(pg_temp.ss_id(4002,5),pg_temp.ss_id(4002,6))),'conflicting packed assignments fail before writes');
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',17,'reference',pg_temp.ss_id(4003,51),'carrier','hanjin','trackingNumber','005555555555'),
  jsonb_build_object('line',18,'reference',pg_temp.ss_id(4003,61),'carrier','hanjin','trackingNumber','005555555555')
)) as pack_import \gset
select pg_temp.ss_assert((select bool_and(value->>'ok'='true') from jsonb_array_elements(:'pack_import'))
  and (select bool_and(status='shipping' and tracking_number='005555555555') from public.order_shipments where id in(pg_temp.ss_id(4002,5),pg_temp.ss_id(4002,6))),'matching item assignments reuse whole-pack atomic transition');
reset role;
rollback;
