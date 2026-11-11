\set ON_ERROR_STOP on
-- 10/14 회의 1014-116·117: 새 주문부터 주문번호·상품주문번호에 주문 시각(KST 시·분)을 넣는다(20자리).
-- 이미 발급한 16자리 번호와 배송건번호는 그대로이고, 검색·송장 회신·입금 확인·테스트 배송완료가 두 형식 모두 동작한다.
-- 합성 데이터만 쓰고 전부 롤백한다. 격리 DB 또는 CI에서만 실행한다.
begin;
create function pg_temp.ok(ok boolean,label text) returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'Order number time assertion: %',label;end if;
end $$;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
  begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
  raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.tid(kind integer,n integer) returns uuid language sql immutable as $$
  select ('d6110000-0000-'||lpad(kind::text,4,'0')||'-8000-'||lpad(n::text,12,'0'))::uuid;
$$;

-- 0) 새 함수와 전환 행은 서버 내부 전용이다.
select pg_temp.ok(not exists(
  select 1 from unnest(array['private.is_commerce_number(text,smallint)','private.next_commerce_sequence(date,smallint)',
    'private.next_timed_order_number(timestamptz)','private.next_product_order_number(text)','private.next_commerce_number(timestamptz,smallint)',
    'private.assign_commerce_number()','private.bank_transfer_deposit_code_for_number(text)']) fn, unnest(array['anon','authenticated','service_role']) r
  where has_function_privilege(r,fn,'execute'))
 and not has_table_privilege('authenticated','private.commerce_number_time_switch','select')
 and not has_table_privilege('service_role','private.commerce_number_time_switch','select,update')
 and (select count(*)=1 from private.commerce_number_time_switch),'number helpers and switch are sealed');

-- 1) 형식: 주문·상품주문은 옛 16자리와 새 20자리, 배송건은 16자리만 받는다. 시각 자리는 00:00~23:59다.
select pg_temp.ok(private.is_commerce_number('2026102110000001',1::smallint) and private.is_commerce_number('20261112143510000042',1::smallint)
 and private.is_commerce_number('2026102120000001',2::smallint) and private.is_commerce_number('20261112143520000042',2::smallint)
 and private.is_commerce_number('2026102130000001',3::smallint)
 and private.is_commerce_number('20261112000010000001',1::smallint) and private.is_commerce_number('20261112235910000001',1::smallint)
 and not private.is_commerce_number('20261112143530000001',3::smallint)
 and not private.is_commerce_number('20261112143520000042',1::smallint) and not private.is_commerce_number('20261112143510000042',2::smallint)
 and not private.is_commerce_number('20261112240010000001',1::smallint) and not private.is_commerce_number('20261112236010000001',1::smallint)
 and not private.is_commerce_number('2026111214351000004',1::smallint) and not private.is_commerce_number('202611121435100000042',1::smallint)
 and not private.is_commerce_number(' 20261112143510000042',1::smallint) and not private.is_commerce_number('20261112143510000042',4::smallint)
 and private.is_commerce_number(null,1::smallint) is null,'format helper accepts both order/item formats and keeps shipments at 16 digits');

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 (pg_temp.tid(0,1),'authenticated','authenticated','order-number-time-admin@example.test','{}','{}',now(),now()),
 (pg_temp.tid(0,2),'authenticated','authenticated','order-number-time-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='admin',nickname='합성 운영자' where id=pg_temp.tid(0,1);
update public.profiles set nickname='합성 구매자' where id=pg_temp.tid(0,2);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.tid(0,1),'primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(pg_temp.tid(0,3),pg_temp.tid(0,1),now(),now(),now()+interval '1 hour');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.tid(0,10),'order-number-time-origin','합성 출고지','hanjin',0,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key) values('order-number-time-ip','합성 번호 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('order-number-time-goods','order-number-time-ip','합성 번호 굿즈','문구',1000,'ok',1000,pg_temp.tid(0,10));
create function pg_temp.add_item(item uuid,purchase uuid) returns text language plpgsql as $$
declare number text;begin
  insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
    select item,purchase,good_id,id,1,1000,'합성 번호 굿즈','문구','order-number-time-ip'
    from public.goods_variants where good_id='order-number-time-goods' and is_default
    returning product_order_number into number;
  return number;
end $$;

-- 2) 전환 시각 전에 만든 주문은 종전 16자리, 그 뒤는 날짜·시각 20자리다. 같은 날 카운터를 이어 써 일련번호가 겹치지 않는다.
update private.commerce_number_time_switch set switched_at='2041-03-05T05:00:00Z' where singleton; -- KST 14:00
insert into public.orders(id,user_id,status,total,address,created_at) values
 (pg_temp.tid(1,1),pg_temp.tid(0,2),'pending',1000,'{}','2041-03-05T04:59:59Z'),
 (pg_temp.tid(1,2),pg_temp.tid(0,2),'pending',1000,'{}','2041-03-05T05:00:00Z'),
 (pg_temp.tid(1,3),pg_temp.tid(0,2),'pending',1000,'{}','2041-03-05T14:59:59Z'),
 (pg_temp.tid(1,4),pg_temp.tid(0,2),'pending',1000,'{}','2041-03-05T15:00:00Z');
select pg_temp.ok((select array_agg(order_number order by id) from public.orders where id in(pg_temp.tid(1,1),pg_temp.tid(1,2),pg_temp.tid(1,3),pg_temp.tid(1,4)))
  =array['2041030510000001','20410305140010000002','20410305235910000003','20410306000010000001'],
 'before switch keeps 16 digits; after switch inserts KST HHMI; KST midnight resets the daily sequence');

-- 3) 상품주문번호는 주문번호와 짝이다(같은 날짜·시각 앞자리 + 2). 옛 주문의 상품주문번호는 옛 형식, 배송건번호는 16자리 그대로다.
select pg_temp.add_item(pg_temp.tid(3,1),pg_temp.tid(1,2)) as timed_item_one \gset
select pg_temp.add_item(pg_temp.tid(3,2),pg_temp.tid(1,2)) as timed_item_two \gset
select pg_temp.add_item(pg_temp.tid(3,3),pg_temp.tid(1,1)) as legacy_item \gset
select pg_temp.add_item(pg_temp.tid(3,4),pg_temp.tid(1,4)) as next_day_item \gset
select pg_temp.ok(array[:'timed_item_one',:'timed_item_two',:'legacy_item',:'next_day_item']
  =array['20410305140020000001','20410305140020000002','2041030520000003','20410306000020000001'],
 'item numbers follow the parent order prefix and share the daily item sequence');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
 (pg_temp.tid(4,1),pg_temp.tid(1,2),pg_temp.tid(0,10),'합성 출고지',0,'{}'),
 (pg_temp.tid(4,2),pg_temp.tid(1,1),pg_temp.tid(0,10),'합성 출고지',0,'{}');
select pg_temp.ok((select array_agg(shipment_number order by id) from public.order_shipments where id in(pg_temp.tid(4,1),pg_temp.tid(4,2)))
  =array['2041030530000001','2041030530000002'],'shipment numbers keep the 16-digit format for both order formats');

-- 4) 형식 제약도 옛 16자리와 새 20자리만 받는다(불변 트리거를 끈 직접 변경으로 확인). 배송건번호는 16자리만이다.
set local session_replication_role=replica;
select pg_temp.expect_error(format($q$update public.orders set order_number='20411231240010000001' where id=%L$q$,pg_temp.tid(1,2)),'orders_number_format');
select pg_temp.expect_error(format($q$update public.orders set order_number='20411231235920000001' where id=%L$q$,pg_temp.tid(1,2)),'orders_number_format');
select pg_temp.expect_error(format($q$update public.orders set order_number='204112312359100000001' where id=%L$q$,pg_temp.tid(1,2)),'orders_number_format');
select pg_temp.expect_error(format($q$update public.order_items set product_order_number='20411231235910000001' where id=%L$q$,pg_temp.tid(3,1)),'order_items_number_format');
select pg_temp.expect_error(format($q$update public.order_shipments set shipment_number='20411231235930000001' where id=%L$q$,pg_temp.tid(4,1)),'order_shipments_number_format');
set local session_replication_role=origin;

-- 5) 같은 분에 만든 주문도 일련번호로 갈린다(시각은 정보용이다).
insert into public.orders(user_id,status,total,address,created_at)
select pg_temp.tid(0,2),'pending',1000,'{}','2041-03-05T06:30:00Z'::timestamptz from generate_series(1,50);
select pg_temp.ok((select count(*)=50 and count(distinct order_number)=50 and bool_and(order_number ~ '^2041030515301[0-9]{7}$')
   and min(right(order_number,7))='0000004' and max(right(order_number,7))='0000053'
  from public.orders where user_id=pg_temp.tid(0,2) and created_at='2041-03-05T06:30:00Z'),'same-minute orders stay unique by daily sequence');

-- 6) 불변·임의 번호 금지는 두 형식 모두 그대로다.
select pg_temp.expect_error(format($q$update public.orders set order_number='20410305140010000099' where id=%L$q$,pg_temp.tid(1,2)),'commerce_number_immutable');
select pg_temp.expect_error(format($q$update public.orders set order_number='2041030510000099' where id=%L$q$,pg_temp.tid(1,2)),'commerce_number_immutable');
select pg_temp.expect_error(format($q$insert into public.orders(user_id,status,total,address,created_at,order_number) values(%L,'pending',1000,'{}','2041-03-05T06:00:00Z','20410305150010000099')$q$,pg_temp.tid(0,2)),'commerce_number_is_generated');
select pg_temp.expect_error(format($q$update public.order_items set product_order_number='20410305140020000099' where id=%L$q$,pg_temp.tid(3,1)),'commerce_number_immutable');
update public.orders set created_at='2041-03-05T08:00:00Z' where id=pg_temp.tid(1,2);
select pg_temp.ok((select order_number='20410305140010000002' from public.orders where id=pg_temp.tid(1,2)),'changing created_at never re-issues the number');
update public.orders set created_at='2041-03-05T05:00:00Z' where id=pg_temp.tid(1,2);

-- 7) 하루 최대 건수(날짜·종류별 9,999,999)를 넘으면 잘린 번호를 만들지 않고 실패한다. 새 형식도 같다.
update private.commerce_number_counters set last_value=9999999 where business_date='2041-03-06' and kind in (1,2);
select pg_temp.expect_error(format($q$insert into public.orders(user_id,status,total,address,created_at) values(%L,'pending',1000,'{}','2041-03-05T15:30:00Z')$q$,pg_temp.tid(0,2)),
  'commerce_number_counters_last_value_check');
select pg_temp.expect_error(format('select pg_temp.add_item(%L,%L)',pg_temp.tid(3,90),pg_temp.tid(1,4)),'commerce_number_counters_last_value_check');
select pg_temp.expect_error($q$select private.next_product_order_number('20410305140030000001')$q$,'invalid_commerce_number_input');
select pg_temp.expect_error($q$select private.next_timed_order_number(null)$q$,'invalid_commerce_number_input');

-- 8) 무통장 입금코드: 새 형식도 앞 8자리 날짜의 10일 주기 자리 + 끝 5자리(일련번호)다.
--    TS bankTransferDepositCode와 같은 벡터다(lib/payments/bank-transfer.test.ts).
select pg_temp.ok(array[
  private.bank_transfer_deposit_code_for_number('20261027091510000001'),private.bank_transfer_deposit_code_for_number('20261028235910123456'),
  private.bank_transfer_deposit_code_for_number('20261031000010000001'),private.bank_transfer_deposit_code_for_number('20261101120010000001'),
  private.bank_transfer_deposit_code_for_number('20000101235910099999'),private.bank_transfer_deposit_code_for_number('2026102710000001')]
  =array['600001','723456','000001','100001','099999','600001']
 and private.bank_transfer_deposit_code_for_number('20261027091520000001') is null
 and private.bank_transfer_deposit_code_for_number('20261027246010000001') is null,'deposit code vectors match TS for both formats');
-- 전환하는 날 옛 번호(일련 1)와 새 번호(일련 2)의 코드는 겹치지 않는다.
select pg_temp.ok(private.bank_transfer_deposit_code(pg_temp.tid(1,1))=private.bank_transfer_deposit_code_for_number('2041030510000001')
 and private.bank_transfer_deposit_code(pg_temp.tid(1,2))=private.bank_transfer_deposit_code_for_number('20410305140010000002')
 and right(private.bank_transfer_deposit_code(pg_temp.tid(1,1)),5)='00001' and right(private.bank_transfer_deposit_code(pg_temp.tid(1,2)),5)='00002',
 'switch-day legacy and timed orders get distinct issued codes');

-- 9) 검색·송장 회신·입금 확인·테스트 배송완료는 옛 16자리와 새 20자리 모두 동작한다.
--    n=11~16: 발주확인된 택배 주문(옛: 홀수, 새: 짝수). n=17·18: 입금 대기 무통장 주문(옛·새).
create function pg_temp.confirmed_order(n integer,created timestamptz) returns void language plpgsql as $$begin
  insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at,confirmed_at)
    values(pg_temp.tid(1,n),pg_temp.tid(0,2),'confirmed',1000,0,
      '{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"00123","address1":"합성 주소"}',created,created+interval '1 hour');
  perform pg_temp.add_item(pg_temp.tid(3,n),pg_temp.tid(1,n));
  insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
    values(pg_temp.tid(5,n),pg_temp.tid(0,2),'order',pg_temp.tid(1,n),'toss',1000,'paid','order-number-time-payment-'||n);
  insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
    values(pg_temp.tid(4,n),pg_temp.tid(1,n),pg_temp.tid(0,10),'합성 출고지',0,'{}');
  insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(pg_temp.tid(1,n),pg_temp.tid(4,n),pg_temp.tid(3,n),1);
end $$;
select pg_temp.confirmed_order(n,case when n%2=1 then '2041-03-05T03:00:00Z'::timestamptz else '2041-03-05T06:00:00Z'::timestamptz end+make_interval(mins=>n))
from generate_series(11,16) n;
insert into public.orders(id,user_id,status,total,address,payment_method,created_at,expires_at) values
 (pg_temp.tid(1,17),pg_temp.tid(0,2),'pending',17000,'{"recipientName":"옛번호"}','bank_transfer','2041-03-05T04:00:00Z',now()+interval '1 day'),
 (pg_temp.tid(1,18),pg_temp.tid(0,2),'pending',18000,'{"recipientName":"새번호"}','bank_transfer','2041-03-05T07:00:00Z',now()+interval '1 day');
select order_number as legacy_order from public.orders where id=pg_temp.tid(1,11) \gset
select order_number as timed_order from public.orders where id=pg_temp.tid(1,12) \gset
select product_order_number as legacy_item_number from public.order_items where id=pg_temp.tid(3,11) \gset
select product_order_number as timed_item_number from public.order_items where id=pg_temp.tid(3,12) \gset
select order_number as legacy_unpaid from public.orders where id=pg_temp.tid(1,17) \gset
select order_number as timed_unpaid from public.orders where id=pg_temp.tid(1,18) \gset
select private.bank_transfer_deposit_code(pg_temp.tid(1,17)) as legacy_code \gset
select private.bank_transfer_deposit_code(pg_temp.tid(1,18)) as timed_code \gset
select pg_temp.ok(length(:'legacy_order')=16 and length(:'timed_order')=20 and length(:'legacy_item_number')=16 and length(:'timed_item_number')=20
 and length(:'legacy_unpaid')=16 and length(:'timed_unpaid')=20 and left(:'timed_item_number',12)=left(:'timed_order',12),'reader fixtures cover both formats');

-- 입금 제안은 두 형식의 코드 모두 그 주문 하나로 제안한다.
select pg_temp.ok((select order_id=pg_temp.tid(1,17) and confidence='code_amount' from private.suggest_bank_deposit_order('옛번호'||:'legacy_code',17000))
 and (select order_id=pg_temp.tid(1,18) and confidence='code_amount' from private.suggest_bank_deposit_order('새번호'||:'timed_code',18000)),
 'deposit suggestion matches issued codes of both formats');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.tid(0,1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.tid(0,1),'role','authenticated','session_id',pg_temp.tid(0,3),
  'iss','http://127.0.0.1:54321/auth/v1')::text,true);
select pg_temp.ok((select array_agg(id) from public.admin_search_orders_console(p_query=>:'legacy_order',p_field=>'order'))=array[pg_temp.tid(1,11)]
 and (select array_agg(id) from public.admin_search_orders_console(p_query=>:'timed_order',p_field=>'order'))=array[pg_temp.tid(1,12)]
 and (select bool_or(id=pg_temp.tid(1,12)) and bool_and(order_number like left(:'timed_order',12)||'%')
   from public.admin_search_orders_console(p_query=>left(:'timed_order',12),p_field=>'order')),'order search: full 16/20 digits and the date-time prefix');
select pg_temp.ok(public.admin_search_order_items_console(p_query=>:'legacy_item_number',p_field=>'item')->>'total'='1'
 and public.admin_search_order_items_console(p_query=>:'timed_item_number',p_field=>'item')->>'total'='1'
 and public.admin_search_order_items_console(p_query=>:'timed_item_number',p_field=>'item')#>>'{rows,0,orderNumber}'=:'timed_order',
 'item search by product-order number of both formats');
select pg_temp.ok(public.admin_search_shipments_notice_console('ready',p_query=>:'legacy_order',p_field=>'order')->>'total'='1'
 and public.admin_search_shipments_notice_console('ready',p_query=>:'timed_order',p_field=>'order')->>'total'='1','dispatch search by order number of both formats');
select pg_temp.ok((select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'legacy_unpaid'))=array[pg_temp.tid(1,17)]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'timed_unpaid'))=array[pg_temp.tid(1,18)]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'timed_code'))=array[pg_temp.tid(1,18)]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(:'legacy_code'))=array[pg_temp.tid(1,17)]
 and (select array_agg(order_id) from public.admin_unpaid_bank_transfer_orders_console(left(:'timed_unpaid',12)))=array[pg_temp.tid(1,18)]
 and (select deposit_code from public.admin_unpaid_bank_transfer_orders_console(:'timed_unpaid'))=:'timed_code',
 'unpaid search by full number (16/20), issued code and date-time prefix');

-- ICONS 표준 양식 회신: 상품주문번호 전체(16·20자리)로 품목을 찾고, 원래 번호를 결과에 돌려준다.
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',2,'reference',:'timed_item_number','carrier','hanjin','trackingNumber','001234567890'),
  jsonb_build_object('line',3,'reference',:'legacy_item_number','carrier','hanjin','trackingNumber','009876543210')
)) as item_import \gset
select pg_temp.ok(jsonb_array_length(:'item_import')=2 and :'item_import'::jsonb#>>'{0,ok}'='true' and :'item_import'::jsonb#>>'{1,ok}'='true'
 and :'item_import'::jsonb#>>'{0,reference}'=:'timed_item_number' and :'item_import'::jsonb#>>'{1,reference}'=:'legacy_item_number',
 'item tracking reply resolves product-order numbers of both formats');
-- 주문번호를 상품주문번호 칸에 넣으면 찾지 않는다(종류 자리 구분).
select public.admin_import_item_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',2,'reference',:'timed_order','carrier','hanjin','trackingNumber','001234567890'))) as wrong_kind \gset
select pg_temp.ok(:'wrong_kind'::jsonb#>>'{0,ok}'='false','an order number is not accepted as a product-order number');

-- 일반 운송장 입력: 배송 건이 하나인 주문은 주문번호(16·20자리)로 찾는다.
select order_number as legacy_dispatch from public.orders where id=pg_temp.tid(1,13) \gset
select order_number as timed_dispatch from public.orders where id=pg_temp.tid(1,14) \gset
select public.admin_import_shipment_tracking_batch(jsonb_build_array(
  jsonb_build_object('line',1,'reference',:'timed_dispatch','carrier','hanjin','trackingNumber','111122223333'),
  jsonb_build_object('line',2,'reference',:'legacy_dispatch','carrier','hanjin','trackingNumber','444455556666'))) as shipment_import \gset
select pg_temp.ok(:'shipment_import'::jsonb#>>'{0,ok}'='true' and :'shipment_import'::jsonb#>>'{1,ok}'='true',
 'general tracking import resolves single-shipment orders by both number formats');
reset role;
select pg_temp.ok((select array_agg(status order by id)=array['shipping','shipping','shipping','shipping']
  from public.order_shipments where id in(pg_temp.tid(4,11),pg_temp.tid(4,12),pg_temp.tid(4,13),pg_temp.tid(4,14))),'tracking imports dispatched the four shipments');

-- 테스트 배송완료(스테이징 허용 행이 있을 때)는 두 형식의 주문번호를 모두 받는다.
insert into private.staging_test_tools(singleton,marker) values(true,'admin-ops-v1') on conflict (singleton) do update set marker=excluded.marker;
select order_number as legacy_staging from public.orders where id=pg_temp.tid(1,15) \gset
select order_number as timed_staging from public.orders where id=pg_temp.tid(1,16) \gset
set local role authenticated;
select public.admin_mark_staging_test_delivered(:'timed_staging',gen_random_uuid()) as timed_delivered \gset
select public.admin_mark_staging_test_delivered(:'legacy_staging',gen_random_uuid()) as legacy_delivered \gset
select pg_temp.ok(:'timed_delivered'::jsonb->>'orderNumber'=:'timed_staging' and :'legacy_delivered'::jsonb->>'orderNumber'=:'legacy_staging'
 and :'timed_delivered'::jsonb->>'deliveredShipments'='1',
 'staging test delivery accepts order numbers of both formats');
select pg_temp.expect_error($q$select public.admin_mark_staging_test_delivered('20410305246010000001',gen_random_uuid())$q$,'invalid_staging_test_delivery');
reset role;

-- 10) 운영자 계약 지문은 고친 함수 본문과 맞다.
select pg_temp.ok(not exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature in('public.admin_import_item_tracking_batch(jsonb)','public.admin_mark_staging_test_delivered(text,uuid)') and md5(p.prosrc)<>c.body_md5)
 and (select count(*)=4 from private.operator_internal_contracts where signature in('private.resolve_shipment_reference(text)',
  'public.admin_import_item_tracking_batch(jsonb)','public.admin_mark_staging_test_delivered(text,uuid)',
  'private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)')),'patched readers keep registered contracts');
-- 주문번호·상품주문번호를 16자리 정규식으로 따로 보는 함수가 없다. 형식 판정은 private.is_commerce_number가 한다.
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','private') and p.prosrc ~ '\{8\}([12]|\[12\]|\[123\])\[0-9\]\{7\}'),'no reader hard-codes the 16-digit order or item format');
rollback;
