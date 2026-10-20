\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000064501','authenticated','authenticated','snapshot-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000064502','authenticated','authenticated','snapshot-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000064501';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000064501','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
update public.profiles set nickname='snapshot_buyer',email='snapshot-buyer@example.test',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='00000000-0000-4000-8000-000000064502';
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values('00000000-0000-4000-8000-000000064503','cart-snapshot','합성 카트 검수 출고지',0,'합성 반송지',true);
insert into public.ips(id,title,vertical_key,published_at) values('cart-snapshot','합성 카트 IP','character',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064501',true);
select public.admin_save_good('{"id":"cart-snapshot-1001","code":"CART-SNAP","ip_id":"cart-snapshot","name":"합성 1001문구 상품","type":"문구","price":1000,"origin_id":"00000000-0000-4000-8000-000000064503","variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"CART-SNAP-01","extraPrice":0,"stockQty":1200}],"custom_inputs":{"enabled":true,"fields":[{"id":"00000000-0000-4000-8000-000000064511","name":"각인 문구","active":true}]},"custom_inputs_expected_revision":0}');
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('cart-snapshot-1001'),24))::uuid,'authenticated','authenticated','transaction-kc-1001@example.test','{"testFixture":"goods-kc"}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('cart-snapshot-1001'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('cart-snapshot-1001');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064502',true);
do $$declare variant uuid;begin
 select id into variant from public.goods_variants where good_id='cart-snapshot-1001' and is_default;
 for n in 1..1001 loop
   perform public.set_cart_item_quantity_with_inputs('cart-snapshot-1001',variant,1,1,jsonb_build_object('00000000-0000-4000-8000-000000064511','합성 문구 '||n::text));
 end loop;
 perform set_config('test.cart_snapshot',(
   select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values))::text from public.cart_items
 ),true);
end$$;
select 1/case when (select count(*) from public.cart_items)=1001 then 1 else 0 end as assert_distinct_sku_inputs_can_cross_postgrest_row_limit;
reset role;
set local role service_role;
\timing on
select public.quote_cart_goods_transaction('00000000-0000-4000-8000-000000064502',current_setting('test.cart_snapshot')::jsonb,
 '{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}','{}',null,0) as quote \gset
select 1/case when :'quote'::jsonb->>'state'='quoted' and jsonb_array_length(:'quote'::jsonb#>'{display,lines}')=1001 then 1 else 0 end as assert_quote_1001_custom_input_lines;
select public.place_cart_goods_transaction('00000000-0000-4000-8000-000000064502',current_setting('test.cart_snapshot')::jsonb,
 '{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',(:'quote'::jsonb->>'quoteId')::uuid,
 '00000000-0000-4000-8000-000000064522','card') as order_id \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'order_id')=1001
 and (select count(*) from private.order_price_allocations where order_id=:'order_id')=1001
 and (select total=1001000 and calculation_version=2 from public.orders where id=:'order_id')
 and private.goods_order_snapshot_matches(:'order_id',1001000,0)
 and (select stock_qty=199 from public.goods_variants where good_id='cart-snapshot-1001')
 and not exists(select 1 from public.cart_items where user_id='00000000-0000-4000-8000-000000064502') then 1 else 0 end as assert_v2_1001_line_order_allocation_supply_snapshot;
select octet_length(calculation::text) as persisted_calculation_bytes,octet_length(selection::text) as persisted_selection_bytes
 from private.goods_transaction_quotes where id=(:'quote'::jsonb->>'quoteId')::uuid;
set local role service_role;
select public.cancel_order(:'order_id','합성 1001행 전체 취소');
reset role;
select 1/case when (select stock_qty=1200 from public.goods_variants where good_id='cart-snapshot-1001') then 1 else 0 end as assert_v2_1001_line_full_cancel;
-- The explicit serialized byte budget applies separately to input and the
-- larger immutable calculation. A long-input 1001-row cart may exceed it.
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status)
 values('TRANSACTIONLARGECART','TEST 계산크기 원자성','fixed',100,0,now()-interval '1 day','active');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064502',true);
do $$declare variant uuid;begin
 select id into variant from public.goods_variants where good_id='cart-snapshot-1001' and is_default;
 for n in 1..1001 loop
  perform public.set_cart_item_quantity_with_inputs('cart-snapshot-1001',variant,1,1,
   jsonb_build_object('00000000-0000-4000-8000-000000064511',repeat('한',96)||lpad(n::text,4,'0')));
 end loop;
 perform set_config('test.cart_large_snapshot',(select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values))::text from public.cart_items),true);
end $$;
select public.apply_cart_coupon_code('TRANSACTIONLARGECART');
reset role;
do $$declare selection jsonb;held uuid;before_quotes integer;begin
 select user_coupon_id into held from public.cart_coupon_selections where user_id='00000000-0000-4000-8000-000000064502';
 select count(*) into before_quotes from private.goods_transaction_quotes where actor_id='00000000-0000-4000-8000-000000064502';
 begin
  perform public.quote_cart_goods_transaction('00000000-0000-4000-8000-000000064502',current_setting('test.cart_large_snapshot')::jsonb,
   '{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}','{}',held,0);
  raise exception 'oversized calculation unexpectedly persisted';
 exception when program_limit_exceeded then if sqlerrm<>'transaction_quote_too_large' then raise;end if;end;
 if (select count(*) from private.goods_transaction_quotes where actor_id='00000000-0000-4000-8000-000000064502')<>before_quotes
  or (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000064502')<>1001
  or (select stock_qty from public.goods_variants where good_id='cart-snapshot-1001')<>1200
  or (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000064502')<>1
  or exists(select 1 from public.coupon_redemptions where user_coupon_id=held)
  or exists(select 1 from private.store_credit_allocations where user_id='00000000-0000-4000-8000-000000064502') then
  raise exception 'oversized calculation changed cart, supply, coupon, credits or orders';end if;
 -- Raw input guard is independent; the single huge value is rejected before
 -- any actor/catalog business mutation or quote write can commit.
 selection:=jsonb_build_array(jsonb_build_object('goodId','cart-snapshot-1001','variantId',(select id from public.goods_variants where good_id='cart-snapshot-1001'),
  'qty',1,'inputRevision',1,'inputValues',jsonb_build_object('00000000-0000-4000-8000-000000064511',repeat('x',2097152))));
 begin
  perform private.normalize_goods_transaction_selection(selection);raise exception 'oversized input unexpectedly accepted';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_transaction_selection' then raise;end if;end;
end $$;
select 'PASS selection/calculation byte budgets reject atomically' as byte_guard_result;
rollback;
