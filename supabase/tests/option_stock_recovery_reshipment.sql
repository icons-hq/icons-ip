\set ON_ERROR_STOP on
begin;
select 1 / case when not has_function_privilege('anon','public.admin_adjust_stock(uuid,text,uuid,integer,integer,text)','execute')
 and has_function_privilege('authenticated','public.admin_adjust_stock(uuid,text,uuid,integer,integer,text)','execute')
 and not has_function_privilege('service_role','public.admin_adjust_stock(uuid,text,uuid,integer,integer,text)','execute')
 and not has_function_privilege('anon','public.admin_record_order_claim_reshipment(uuid,text,text,jsonb)','execute')
 and not has_function_privilege('authenticated','private.change_goods_variant_stock(text,uuid,bigint)','execute')
 and not has_table_privilege('authenticated','public.order_claim_reshipment_items','insert')
 then 1 else 0 end as assert_option_writers_are_sealed;
insert into public.ips(id,title,vertical_key,published_at) values('option-stock-test','옵션 재고 테스트','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at) values
('option-stock-test','option-stock-test','옵션 재고 테스트','문구',10000,'ok',5,now()),
('option-stock-other','option-stock-test','다른 상품','문구',10000,'ok',1,now());
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order) values
('00000000-0000-4000-8000-000000044010','option-stock-test','파랑',10000,2,1),
('00000000-0000-4000-8000-000000044011','option-stock-test','빨강',11000,3,2);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000044001','authenticated','authenticated','option-stock-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000044002','authenticated','authenticated','option-stock-owner@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000044001';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044001',true);
select public.admin_adjust_stock('00000000-0000-4000-8000-000000044030','option-stock-test','00000000-0000-4000-8000-000000044010',2,2,'옵션 입고');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000044030','option-stock-test','00000000-0000-4000-8000-000000044010',2,2,'옵션 입고');
reset role;
select 1 / case when (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000044010')=4
 and (select stock_qty from public.goods_variants where good_id='option-stock-test' and is_default)=5
 and exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000044030'
   and diff->>'variantId'='00000000-0000-4000-8000-000000044010' and diff->>'delta'='2')
 then 1 else 0 end as assert_option_adjustment_and_idempotent_audit;

set local role authenticated;
do $$ begin
  perform public.admin_adjust_stock('00000000-0000-4000-8000-000000044031','option-stock-test','00000000-0000-4000-8000-000000044010',2,1,'오래된 수량');
  raise exception 'stale adjustment accepted';
exception when raise_exception then if sqlerrm<>'stock_changed' then raise; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044002',true);
do $$ begin
  perform public.admin_adjust_stock('00000000-0000-4000-8000-000000044032','option-stock-test','00000000-0000-4000-8000-000000044010',4,1,'권한 없는 조정');
  raise exception 'customer adjustment accepted';
exception when insufficient_privilege then null; end $$;
reset role;

insert into public.orders(id,user_id,status,total,address) values
('00000000-0000-4000-8000-000000044020','00000000-0000-4000-8000-000000044002','pending',20000,'{}');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values
('00000000-0000-4000-8000-000000044021','00000000-0000-4000-8000-000000044020','option-stock-test','00000000-0000-4000-8000-000000044010',2,10000,'옵션 재고 테스트','문구','option-stock-test');
select public.finalize_order_cancellation_with_provider_evidence('00000000-0000-4000-8000-000000044020','미입금 취소','{}');
select public.finalize_order_cancellation_with_provider_evidence('00000000-0000-4000-8000-000000044020','미입금 취소','{}');
select 1 / case when (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000044010')=6
 and (select stock_qty from public.goods_variants where good_id='option-stock-test' and is_default)=5
 and (select count(*) from public.audit_log where action='order.option_stock_restored' and target='order:00000000-0000-4000-8000-000000044020'
   and diff->>'variantId'='00000000-0000-4000-8000-000000044010')=1
 then 1 else 0 end as assert_cancel_restores_exact_option_once;

-- A whole-order exchange still ships every original item; its replacement option
-- may differ while the paid option/price snapshots remain unchanged.
insert into public.orders(id,user_id,status,total,address,shipped_at,delivered_at) values
('00000000-0000-4000-8000-000000044040','00000000-0000-4000-8000-000000044002','delivered',20000,'{}',now(),now());
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values
('00000000-0000-4000-8000-000000044041','00000000-0000-4000-8000-000000044040','option-stock-test','00000000-0000-4000-8000-000000044010',2,10000,'옵션 재고 테스트','문구','option-stock-test');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
values ('00000000-0000-4000-8000-000000044050','option-stock-return-test','옵션 검증 창고',0,'합성 옵션 반송 주소');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
values ('00000000-0000-4000-8000-000000044051','00000000-0000-4000-8000-000000044040','00000000-0000-4000-8000-000000044050','옵션 검증 창고',0,'{}','delivered','hanjin','SALE44000001',now(),now());
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
values ('00000000-0000-4000-8000-000000044040','00000000-0000-4000-8000-000000044051','00000000-0000-4000-8000-000000044041',2);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage) values
('00000000-0000-4000-8000-000000044042','00000000-0000-4000-8000-000000044040','00000000-0000-4000-8000-000000044002','색상 교환','exchange','requested');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044001',true);
select public.admin_decide_order_claim('00000000-0000-4000-8000-000000044042','approve',null);
-- 승인만으로는 재고를 이동할 수 없다. 실제 출고지의 2개 입고가 선행해야 한다.
do $$ begin
 perform public.admin_record_order_claim_reshipment('00000000-0000-4000-8000-000000044042','hanjin','EX44000001',
  '[{"orderItemId":"00000000-0000-4000-8000-000000044041","variantId":"00000000-0000-4000-8000-000000044011"}]');
 raise exception 'exchange before collection accepted';
exception when check_violation then if sqlerrm<>'claim_collections_incomplete' then raise; end if; end $$;
select public.admin_record_order_claim_origin_collection('00000000-0000-4000-8000-000000044042','00000000-0000-4000-8000-000000044051','파랑 옵션 2개 입고 확인');
-- An option from a different product cannot be shipped; no partial ledger or
-- stock change may survive the rejected transaction.
do $$ declare other_variant uuid; begin
 select id into other_variant from public.goods_variants where good_id='option-stock-other' and is_default;
 perform public.admin_record_order_claim_reshipment('00000000-0000-4000-8000-000000044042','hanjin','EX44000001',
  jsonb_build_array(jsonb_build_object('orderItemId','00000000-0000-4000-8000-000000044041','variantId',other_variant)));
 raise exception 'cross-product exchange accepted';
exception when check_violation then if sqlerrm<>'reshipment_variant_unavailable' then raise; end if; end $$;
select 1 / case when not exists(select 1 from public.order_claim_reshipment_items where claim_id='00000000-0000-4000-8000-000000044042') then 1 else 0 end as assert_rejected_exchange_has_no_ledger;
select public.admin_record_order_claim_reshipment('00000000-0000-4000-8000-000000044042','hanjin','EX44000001',
 '[{"orderItemId":"00000000-0000-4000-8000-000000044041","variantId":"00000000-0000-4000-8000-000000044011"}]');
do $$ begin
 perform public.admin_record_order_claim_reshipment('00000000-0000-4000-8000-000000044042','hanjin','EX44000001',
  '[{"orderItemId":"00000000-0000-4000-8000-000000044041","variantId":"00000000-0000-4000-8000-000000044010"}]');
 raise exception 'changed replay accepted';
exception when unique_violation then if sqlerrm<>'reshipment_conflict' then raise; end if; end $$;
select public.admin_record_order_claim_reshipment('00000000-0000-4000-8000-000000044042','hanjin','EX44000001',
 '[{"orderItemId":"00000000-0000-4000-8000-000000044041","variantId":"00000000-0000-4000-8000-000000044011"}]');
reset role;
select 1 / case when (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000044010')=8
 and (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000044011')=1
 and exists(select 1 from public.order_items where id='00000000-0000-4000-8000-000000044041'
   and variant_id='00000000-0000-4000-8000-000000044010' and variant_name_snapshot='파랑' and unit_price=10000)
 and exists(select 1 from public.order_claim_reshipment_items where claim_id='00000000-0000-4000-8000-000000044042'
   and source_variant_id='00000000-0000-4000-8000-000000044010' and variant_id='00000000-0000-4000-8000-000000044011' and qty=2)
 and (select count(*) from public.audit_log where action='admin.order.claim_reshipped' and target='order:00000000-0000-4000-8000-000000044040'
   and diff->'items' @> '[{"variantId":"00000000-0000-4000-8000-000000044011"}]')=1
 then 1 else 0 end as assert_exchange_moves_options_once_and_freezes_sale_history;
set local role authenticated;
select 1 / case when public.admin_order_claim_detail('00000000-0000-4000-8000-000000044042')->'claim'->'reshippedItems'
 @> '[{"variantId":"00000000-0000-4000-8000-000000044011","variantName":"빨강","qty":2}]'
 and public.admin_order_claim_detail('00000000-0000-4000-8000-000000044042')->'order'->'items'
 @> '[{"variantId":"00000000-0000-4000-8000-000000044010","currentVariantId":"00000000-0000-4000-8000-000000044011"}]'
 then 1 else 0 end as assert_staff_detail_preserves_purchased_and_shipped_options;
-- The later return concerns the replacement units, so actual receipt of those
-- two red options must be confirmed before another claim can be approved.
select public.admin_record_order_claim_reshipment_delivery('00000000-0000-4000-8000-000000044042','빨강 교환품 2개 실제 배송완료 근거 대조');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044002',true);
select 1 / case when (select count(*) from public.order_claim_reshipment_items where claim_id='00000000-0000-4000-8000-000000044042')=1 then 1 else 0 end as assert_owner_reads_shipment;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044099',true);
select 1 / case when not exists(select 1 from public.order_claim_reshipment_items where claim_id='00000000-0000-4000-8000-000000044042') then 1 else 0 end as assert_other_customer_cannot_read_shipment;
reset role;
select set_config('request.jwt.claim.sub','',true);

-- A later verified full return restores the most recently shipped red option.
insert into public.payments(id,user_id,provider,payment_key,purpose,ref_id,amount,status,idempotency_key) values
('00000000-0000-4000-8000-000000044043','00000000-0000-4000-8000-000000044002','toss','option-exchange-paid','order','00000000-0000-4000-8000-000000044040',20000,'paid','00000000-0000-4000-8000-000000044044');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage) values
('00000000-0000-4000-8000-000000044046','00000000-0000-4000-8000-000000044040','00000000-0000-4000-8000-000000044002','교환 후 전액 반품','return','requested');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044001',true);
select public.admin_decide_order_claim('00000000-0000-4000-8000-000000044046','approve',null);
select public.admin_record_order_claim_origin_collection('00000000-0000-4000-8000-000000044046','00000000-0000-4000-8000-000000044051','마지막 재출고 빨강 옵션 2개 입고 확인');
select public.admin_record_order_claim_refund('00000000-0000-4000-8000-000000044046','pg_cancel','filed',null);
reset role;
select set_config('request.jwt.claim.sub','',true);
select public.finalize_order_cancellation_with_provider_evidence('00000000-0000-4000-8000-000000044040','교환 후 전액 반품','{option-exchange-paid}');
select 1 / case when (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000044010')=8
 and (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000044011')=3
 then 1 else 0 end as assert_return_after_exchange_restores_last_shipped_option;

do $$ begin
 update public.goods set stock_qty=999 where id='option-stock-test';
 raise exception 'direct cache write accepted';
exception when check_violation then if sqlerrm<>'goods_stock_cache_readonly' then raise; end if; end $$;
rollback;
