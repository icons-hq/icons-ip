\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. The caller selects the disposable DB.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000005091','authenticated','authenticated','coupon-expect-user@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='coupon-expect-user@example.test',nickname='coupon_expect_user',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now()
where id='00000000-0000-4000-8000-000000005091';
insert into public.ips(id,title,vertical_key,published_at) values('coupon-expect-ip','쿠폰 선택 합성 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
values('00000000-0000-4000-8000-000000005091','coupon-expect-origin','합성 출고지','hanjin',0,'합성 반품 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
values('coupon-expect-good','coupon-expect-ip','쿠폰 선택 합성 상품','문구',10000,'ok',20,'00000000-0000-4000-8000-000000005091');
select pg_temp.publish_goods_kc_fixture('coupon-expect-good');
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('EXPECT-A','선택 합성 A','fixed',1000,0,now()-interval '1 day','active'),
 ('EXPECT-B','선택 합성 B','fixed',2000,0,now()-interval '1 day','active');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000005091',true);
set local role authenticated;
select public.apply_cart_coupon_code('EXPECT-A');
select set_config('test.expected_coupon_a',(select user_coupon_id::text from public.cart_coupon_selections where user_id='00000000-0000-4000-8000-000000005091'),true);
insert into public.cart_items(user_id,good_id,variant_id,qty)
select '00000000-0000-4000-8000-000000005091','coupon-expect-good',id,1 from public.goods_variants where good_id='coupon-expect-good' and is_default;
-- Another tab changes the selected coupon after this checkout displayed A.
select public.apply_cart_coupon_code('EXPECT-B');
select set_config('test.expected_coupon_b',(select user_coupon_id::text from public.cart_coupon_selections where user_id='00000000-0000-4000-8000-000000005091'),true);
reset role;
set local role service_role;
do $$ begin
 begin
  perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
   '10000000-0000-4000-8000-000000005091','card',0,current_setting('test.expected_coupon_a')::uuid);
  raise exception 'Changed coupon was consumed without checkout agreement';
 exception when sqlstate 'PT409' then if sqlerrm<>'coupon_selection_changed' then raise; end if; end;
end $$;
reset role;
set local role authenticated;
select 1/case when not exists(select 1 from public.orders where user_id='00000000-0000-4000-8000-000000005091')
 and (select stock_qty from public.goods_variants where good_id='coupon-expect-good' and is_default)=20
 and (select qty from public.cart_items where user_id='00000000-0000-4000-8000-000000005091')=1
 then 1 else 0 end as changed_coupon_has_no_order_or_inventory_effect;
select public.clear_cart_coupon();
reset role;
set local role service_role;
do $$ begin
 begin
  perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
   '10000000-0000-4000-8000-000000005091','card',0,current_setting('test.expected_coupon_b')::uuid);
  raise exception 'Cleared coupon was silently ignored';
 exception when sqlstate 'PT409' then if sqlerrm<>'coupon_selection_changed' then raise; end if; end;
end $$;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
 '10000000-0000-4000-8000-000000005091','card',0,null) as no_coupon_order \gset
reset role;
set local role authenticated;
select public.apply_cart_coupon_code('EXPECT-A');
reset role;
set local role service_role;
select 1/case when public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
 '10000000-0000-4000-8000-000000005091','card',0,null)=:'no_coupon_order'::uuid then 1 else 0 end as no_coupon_retry_ignores_later_cart_selection;
do $$ begin
 begin
  perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
   '10000000-0000-4000-8000-000000005091','card',0,current_setting('test.expected_coupon_a')::uuid);
  raise exception 'Existing no-coupon order changed coupon intent';
 exception when sqlstate 'PT409' then if sqlerrm<>'coupon_selection_changed' then raise; end if; end;
end $$;
reset role;
set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty)
select '00000000-0000-4000-8000-000000005091','coupon-expect-good',id,1 from public.goods_variants where good_id='coupon-expect-good' and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
 '10000000-0000-4000-8000-000000005092','card',0,current_setting('test.expected_coupon_a')::uuid) as coupon_order \gset
reset role;
set local role authenticated;
select public.apply_cart_coupon_code('EXPECT-B');
reset role;
set local role service_role;
select 1/case when public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
 '10000000-0000-4000-8000-000000005092','card',0,current_setting('test.expected_coupon_a')::uuid)=:'coupon_order'::uuid then 1 else 0 end as retry_uses_the_order_coupon_snapshot;
do $$ begin
 begin
  perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"바뀐 주소"}',
   '10000000-0000-4000-8000-000000005092','card',0,current_setting('test.expected_coupon_a')::uuid);
  raise exception 'Retry address changed';
 exception when unique_violation then if sqlerrm<>'checkout key conflict' then raise; end if; end;
 begin
  perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
   '10000000-0000-4000-8000-000000005092','bank_transfer',0,current_setting('test.expected_coupon_a')::uuid);
  raise exception 'Retry payment method changed';
 exception when unique_violation then if sqlerrm<>'checkout key conflict' then raise; end if; end;
 begin
  perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000005091','{"recipientName":"선택 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}',
   '10000000-0000-4000-8000-000000005092','card',1,current_setting('test.expected_coupon_a')::uuid);
  raise exception 'Retry store-credit amount changed';
 exception when sqlstate 'PT409' then if sqlerrm<>'checkout key conflict' then raise; end if; end;
end $$;
reset role;
set local role authenticated;
select 1/case when (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000005091')=2
 and (select stock_qty from public.goods_variants where good_id='coupon-expect-good' and is_default)=18
 and (select total=10000 and discount_total=0 from public.orders where id=:'no_coupon_order')
 and (select total=9000 and discount_total=1000 from public.orders where id=:'coupon_order')
 then 1 else 0 end as idempotent_retries_preserve_price_and_inventory;
reset role;
select 1/case when has_function_privilege('service_role','public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and not has_function_privilege('authenticated','public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and not has_function_privilege('anon','public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid)','execute')
 and has_function_privilege('service_role','public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint)','execute')
 then 1 else 0 end as expected_coupon_is_server_only_and_legacy_remains_available;
rollback;
