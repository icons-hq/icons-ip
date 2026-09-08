\set ON_ERROR_STOP on
begin;
select 1 / case when (select attnotnull from pg_attribute where attrelid='public.order_items'::regclass and attname='variant_id')
 and (select attnotnull from pg_attribute where attrelid='public.cart_items'::regclass and attname='variant_id')
 then 1 else 0 end as assert_cart_and_order_option_required;
select 1 / case when to_regprocedure('public.admin_adjust_stock(uuid,text,integer,integer,text)') is null
 and to_regprocedure('private.change_default_goods_variant_stock(text,bigint)') is null
 and to_regprocedure('public.place_order(jsonb)') is null
 then 1 else 0 end as assert_good_level_stock_writers_removed;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000044301','authenticated','authenticated','option-contract@example.test',now(),'{}','{}',now(),now());
insert into public.ips(id,title,vertical_key,published_at) values('option-contract-test','옵션 필수','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at) values('option-contract-test','option-contract-test','옵션 필수','문구',10000,'ok',4,now());
do $$ begin
 perform public.quote_goods_shipping('[{"goodId":"option-contract-test","qty":1}]');
 raise exception 'quote silently selected default option';
exception when invalid_parameter_value then null; end $$;
insert into public.orders(id,user_id,status,total,address) values('00000000-0000-4000-8000-000000044320','00000000-0000-4000-8000-000000044301','pending',10000,'{}');
do $$ begin
 insert into public.cart_items(user_id,good_id,qty) values('00000000-0000-4000-8000-000000044301','option-contract-test',1);
 raise exception 'cart silently selected default option';
exception when not_null_violation then null; end $$;
do $$ begin
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 values('00000000-0000-4000-8000-000000044320','option-contract-test',1,10000,'옵션 필수','문구','option-contract-test');
 raise exception 'order silently selected default option';
exception when not_null_violation then null; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044301',true);
do $$ begin
 perform public.set_cart_item_quantity('option-contract-test',null,1);
 raise exception 'mutation silently selected default option';
exception when invalid_parameter_value then null; end $$;
do $$ begin
 perform public.merge_cart_items('[{"good_id":"option-contract-test","qty":1}]');
 raise exception 'merge silently selected default option';
exception when check_violation then null; end $$;
select public.set_cart_item_quantity('option-contract-test',(select id from public.goods_variants where good_id='option-contract-test' and is_default),2);
select 1 / case when (select count(*) from public.cart_items where good_id='option-contract-test' and variant_id is not null)=1 then 1 else 0 end as assert_explicit_option_mutation_remains_available;
rollback;
