\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000064501','authenticated','authenticated','snapshot-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000064502','authenticated','authenticated','snapshot-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000064501';
update public.profiles set nickname='snapshot_buyer',email='snapshot-buyer@example.test',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='00000000-0000-4000-8000-000000064502';
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values('00000000-0000-4000-8000-000000064503','cart-snapshot','합성 카트 검수 출고지',0,'합성 반송지',true);
insert into public.ips(id,title,vertical_key,published_at) values('cart-snapshot','합성 카트 IP','character',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064501',true);
select public.admin_save_good('{"id":"cart-snapshot-1001","code":"CART-SNAP","ip_id":"cart-snapshot","name":"합성 1001문구 상품","type":"문구","price":1000,"origin_id":"00000000-0000-4000-8000-000000064503","variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"CART-SNAP-01","extraPrice":0,"stockQty":1200}],"custom_inputs":{"enabled":true,"fields":[{"id":"00000000-0000-4000-8000-000000064511","name":"각인 문구","active":true}]},"custom_inputs_expected_revision":0}');
reset role;
select set_config('request.jwt.claim.sub','',true);
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
do $$declare partial_cart jsonb;begin
 select jsonb_agg(value) into partial_cart from (select value from jsonb_array_elements(current_setting('test.cart_snapshot')::jsonb) limit 1000) first_page;
 begin
  perform public.place_order_with_cart_snapshot('00000000-0000-4000-8000-000000064502','{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}','00000000-0000-4000-8000-000000064521','card',0,null,partial_cart);
  raise exception 'partial 1000 rows ordered hidden 1001st row';
 exception when sqlstate 'PT409' then if sqlerrm<>'cart_snapshot_changed' then raise;end if;end;
end$$;
reset role;
select 1/case when not exists(select 1 from public.orders where user_id='00000000-0000-4000-8000-000000064502')
 and (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000064502')=1001
 and (select stock_qty from public.goods_variants where good_id='cart-snapshot-1001')=1200
 then 1 else 0 end as assert_partial_snapshot_creates_nothing_and_keeps_all_cart_stock;
set local role service_role;
select public.place_order_with_cart_snapshot('00000000-0000-4000-8000-000000064502','{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}','00000000-0000-4000-8000-000000064521','card',0,null,current_setting('test.cart_snapshot')::jsonb) as order_id \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'order_id')=1001
 and (select sum(qty) from public.order_items where order_id=:'order_id')=1001
 and (select total from public.orders where id=:'order_id')=1001000
 and (select stock_qty from public.goods_variants where good_id='cart-snapshot-1001')=199
 and not exists(select 1 from public.cart_items where user_id='00000000-0000-4000-8000-000000064502')
 then 1 else 0 end as assert_complete_1001_row_snapshot_orders_every_visible_line;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000064502',true);
select public.set_cart_item_quantity_with_inputs('cart-snapshot-1001',(select id from public.goods_variants where good_id='cart-snapshot-1001'),1,1,'{"00000000-0000-4000-8000-000000064511":"새 카트 문구"}');
reset role;
set local role service_role;
select 1/case when public.place_order_with_cart_snapshot('00000000-0000-4000-8000-000000064502','{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}','00000000-0000-4000-8000-000000064521','card',0,null,'{}')=:'order_id'::uuid
 then 1 else 0 end as assert_existing_checkout_replays_without_comparing_new_cart;
select public.cancel_order(:'order_id','합성 1001행 전체 취소');
reset role;
select 1/case when (select count(*) from public.cart_items where user_id='00000000-0000-4000-8000-000000064502')=1
 and (select stock_qty from public.goods_variants where good_id='cart-snapshot-1001')=1200
 and (select count(*) from public.order_items where order_id=:'order_id' and custom_inputs_snapshot is not null)=1001
 and not has_function_privilege('authenticated','public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb)','execute')
 then 1 else 0 end as assert_replay_keeps_new_cart_full_cancel_restores_stock_and_acl;
rollback;
