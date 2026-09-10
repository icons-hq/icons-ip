\set ON_ERROR_STOP on
begin;
select 1 / case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='cart_items' and column_name='variant_id') then 1 else 0 end as assert_variant_migration;
insert into public.verticals(key,label,color) values('cart-variant-test','옵션 테스트','#111111');
insert into public.ips(id,title,vertical_key,published_at) values('cart-variant-test','옵션 테스트','cart-variant-test',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at) values('cart-variant-test','cart-variant-test','옵션 굿즈','문구',10000,'ok',5,null);
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order) values
('00000000-0000-4000-8000-000000043910','cart-variant-test','파랑',12000,2,1),
('00000000-0000-4000-8000-000000043911','cart-variant-test','빨강',15000,3,2);
select pg_temp.publish_goods_kc_fixture('cart-variant-test');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000043901','authenticated','authenticated','cart-variants@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='옵션 구매자',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='00000000-0000-4000-8000-000000043901';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043901',true);
select public.set_cart_item_quantity('cart-variant-test',(select id from public.goods_variants where good_id='cart-variant-test' and is_default),1);
select 1 / case when exists(select 1 from public.cart_items c join public.goods_variants v on v.id=c.variant_id where c.good_id='cart-variant-test' and v.is_default) then 1 else 0 end as assert_explicit_default_option;
select public.set_cart_item_quantity('cart-variant-test',(select id from public.goods_variants where good_id='cart-variant-test' and is_default),0);
select public.set_cart_item_quantity('cart-variant-test','00000000-0000-4000-8000-000000043910',2);
select public.set_cart_item_quantity('cart-variant-test','00000000-0000-4000-8000-000000043911',1);
select 1 / case when (select count(*) from public.cart_items where good_id='cart-variant-test')=2 then 1 else 0 end as assert_separate_variants;
reset role;
select 1 / case when private.cart_subtotal('00000000-0000-4000-8000-000000043901')=39000 then 1 else 0 end as assert_coupon_uses_option_subtotal;
set local role authenticated;
do $$ begin
  perform public.set_cart_item_quantity('cart-variant-test','00000000-0000-4000-8000-000000043910',3);
  raise exception 'oversized option cart accepted';
exception when check_violation then null; end $$;
reset role;
select public.place_order('00000000-0000-4000-8000-000000043901','{"recipientName":"테스트","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}','00000000-0000-4000-8000-000000043920','card') as order_id \gset
select 1 / case when (select count(*) from public.order_items where order_id=:'order_id')=2
 and (select sum(qty*unit_price) from public.order_items where order_id=:'order_id')=39000
 and exists(select 1 from public.order_items where order_id=:'order_id' and variant_id='00000000-0000-4000-8000-000000043910' and variant_name_snapshot='파랑')
 and (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000043910')=0
 and (select stock_qty from public.goods_variants where id='00000000-0000-4000-8000-000000043911')=2
 and (select stock_qty from public.goods_variants where good_id='cart-variant-test' and is_default)=5
 then 1 else 0 end as assert_variant_price_snapshot_and_exact_stock;
select 1 / case when (select stock_qty from public.goods where id='cart-variant-test')=7 then 1 else 0 end as assert_derived_cache;
rollback;
