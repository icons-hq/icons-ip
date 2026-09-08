\set ON_ERROR_STOP on
begin;

select 1 / case when (select base_fee=3000 and free_threshold=50000 from private.get_goods_shipping_policy())
 then 1 else 0 end as assert_current_shipping_policy;
select 1 / case when private.goods_shipping_fee_for(0)=0
 and private.goods_shipping_fee_for(1)=3000
 and private.goods_shipping_fee_for(49999)=3000
 and private.goods_shipping_fee_for(50000)=0
 and private.goods_shipping_fee_for(50001)=0
 then 1 else 0 end as assert_shipping_boundaries;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000043801','authenticated','authenticated','shipping-policy-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='shipping_policy_buyer',birth_date='2000-01-01',
 consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='00000000-0000-4000-8000-000000043801';
insert into public.verticals(key,label,color) values ('shipping-policy','배송 정책','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('shipping-policy','배송 정책','shipping-policy',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,allow_bank_transfer)
 values ('shipping-policy','shipping-policy','배송 정책 상품','문구',49999,'ok',10,true);

do $$
declare payment_kind public.order_payment_method; goods_price integer; order_id uuid; expected_fee bigint;
begin
  foreach payment_kind in array array['card','bank_transfer']::public.order_payment_method[] loop
    foreach goods_price in array array[49999,50000,50001] loop
      update public.goods set price=goods_price where id='shipping-policy';
      insert into public.cart_items(user_id,good_id,qty)
        values ('00000000-0000-4000-8000-000000043801','shipping-policy',1);
      order_id := public.place_order('00000000-0000-4000-8000-000000043801',
        '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
        extensions.gen_random_uuid(),payment_kind);
      expected_fee := case when goods_price=49999 then 3000 else 0 end;
      if not exists(select 1 from public.orders where id=order_id
        and shipping_fee=expected_fee and total=goods_price+expected_fee and payment_method=payment_kind) then
        raise exception 'shipping snapshot changed for % subtotal %',payment_kind,goods_price;
      end if;
    end loop;
  end loop;
end $$;

select 1 / case when
 not has_function_privilege('anon','private.get_goods_shipping_policy()','execute')
 and not has_function_privilege('authenticated','private.get_goods_shipping_policy()','execute')
 and not has_function_privilege('service_role','private.get_goods_shipping_policy()','execute')
 and not has_function_privilege('anon','private.goods_shipping_fee_for(bigint)','execute')
 and not has_function_privilege('authenticated','private.goods_shipping_fee_for(bigint)','execute')
 and not has_function_privilege('service_role','private.goods_shipping_fee_for(bigint)','execute')
 then 1 else 0 end as assert_policy_helpers_are_sealed;
rollback;
