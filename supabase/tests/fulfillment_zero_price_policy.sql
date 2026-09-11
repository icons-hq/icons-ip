\set ON_ERROR_STOP on
begin;

-- Zero-priced goods are valid catalog entries. Policy membership, rather than
-- positive merchandise value, determines whether a parcel has a base fee.
update public.fulfillment_origins set base_fee=3000, free_threshold=50000, is_active=true
where code='gimpo';
insert into public.verticals(key,label,color) values ('shipping-zero-policy','0원 배송 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at)
values ('shipping-zero-policy','0원 배송 검증','shipping-zero-policy',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id,shipping_fee_type,individual_fee)
values
 ('shipping-zero-policy-good','shipping-zero-policy','0원 정책 상품','키링',0,'ok',10,null,'00000000-0000-4000-8000-000000042201','policy',0),
 ('shipping-zero-free-good','shipping-zero-policy','무료배송 상품','키링',10000,'ok',10,null,'00000000-0000-4000-8000-000000042201','free',0),
 ('shipping-zero-individual-good','shipping-zero-policy','개별배송 상품','키링',10000,'ok',10,null,'00000000-0000-4000-8000-000000042201','individual',2000),
 ('shipping-zero-paid-policy-good','shipping-zero-policy','유상 정책 상품','키링',25000,'ok',10,null,'00000000-0000-4000-8000-000000042201','policy',0);
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('shipping-zero-policy-good');
select pg_temp.publish_goods_kc_fixture('shipping-zero-free-good');
select pg_temp.publish_goods_kc_fixture('shipping-zero-individual-good');
select pg_temp.publish_goods_kc_fixture('shipping-zero-paid-policy-good');

create temp table zero_price_lines as
select good.id, jsonb_build_object('goodId',good.id,'variantId',variant.id,'qty',1) value
from public.goods good join public.goods_variants variant on variant.good_id=good.id and variant.is_default
where good.ip_id='shipping-zero-policy';

do $$
declare policy jsonb; free_line jsonb; individual jsonb; paid_policy jsonb; quote jsonb; quantity integer;
begin
 select value into policy from zero_price_lines where id='shipping-zero-policy-good';
 select value into free_line from zero_price_lines where id='shipping-zero-free-good';
 select value into individual from zero_price_lines where id='shipping-zero-individual-good';
 select value into paid_policy from zero_price_lines where id='shipping-zero-paid-policy-good';

 quote:=public.quote_goods_shipping(jsonb_build_array(policy));
 if (quote->>'totalFee')::bigint<>3000 or (quote#>>'{groups,0,policySubtotal}')::bigint<>0
   or (quote#>>'{groups,0,policyFee}')::bigint<>3000 then
   raise exception 'zero-priced policy item must pay base fee: %',quote;
 end if;
 if public.quote_goods_shipping(jsonb_build_array(policy,individual))->>'totalFee'<>'5000' then
   raise exception 'zero policy plus individual fee must total 5000';
 end if;
 if public.quote_goods_shipping(jsonb_build_array(policy,free_line))->>'totalFee'<>'3000'
   or public.quote_goods_shipping(jsonb_build_array(free_line,individual))->>'totalFee'<>'2000'
   or public.quote_goods_shipping(jsonb_build_array(free_line))->>'totalFee'<>'0'
   or public.quote_goods_shipping('[]')->>'totalFee'<>'0' then
   raise exception 'free or absent policy items changed parcel fee';
 end if;
 if public.quote_goods_shipping(jsonb_build_array(policy,paid_policy))->>'totalFee'<>'3000'
   or public.quote_goods_shipping(jsonb_build_array(policy,jsonb_set(paid_policy,'{qty}','2')))->>'totalFee'<>'0' then
   raise exception 'policy subtotal threshold must include only policy items';
 end if;
 foreach quantity in array array[1,2,99,2147483647] loop
   if public.quote_goods_shipping(jsonb_build_array(jsonb_set(policy,'{qty}',to_jsonb(quantity))))->>'totalFee'<>'3000' then
     raise exception 'zero policy quantity % must charge base fee once',quantity;
   end if;
 end loop;
 if public.quote_goods_shipping((select jsonb_agg(policy) from generate_series(1,1000)))->>'totalFee'<>'3000' then
   raise exception '1000 zero policy lines must charge base fee once';
 end if;
 foreach quantity in array array[0,-1] loop
   begin
     perform public.quote_goods_shipping(jsonb_build_array(jsonb_set(policy,'{qty}',to_jsonb(quantity))));
     raise exception 'nonpositive policy quantity accepted';
   exception when invalid_parameter_value then null; end;
 end loop;
 begin
   perform public.quote_goods_shipping(jsonb_build_array(jsonb_set(policy,'{qty}','2147483648')));
   raise exception 'out-of-range policy quantity accepted';
 exception when numeric_value_out_of_range then null; end;
 begin
   perform public.quote_goods_shipping((select jsonb_agg(policy) from generate_series(1,1001)));
   raise exception 'over 1000 policy lines accepted';
 exception when invalid_parameter_value then null; end;
end $$;

-- Both checkout paths persist the same quote into the order and its shipment.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000042281','authenticated','authenticated','zero-policy@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='0원 배송 검증',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now()
where id='00000000-0000-4000-8000-000000042281';
create temp table zero_price_orders(id uuid, expected_total bigint, expected_fee bigint);
do $$
declare method public.order_payment_method; placed uuid; mixed boolean;
begin
 foreach method in array array['card','bank_transfer']::public.order_payment_method[] loop
   foreach mixed in array array[false,true] loop
     insert into public.cart_items(user_id,good_id,variant_id,qty)
     select '00000000-0000-4000-8000-000000042281',variant.good_id,variant.id,1
     from public.goods_variants variant where variant.is_default
       and (variant.good_id='shipping-zero-policy-good' or (mixed and variant.good_id='shipping-zero-individual-good'));
     placed:=public.place_order('00000000-0000-4000-8000-000000042281',
       '{"recipientName":"배송 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}',gen_random_uuid(),method);
     insert into zero_price_orders values(placed,case when mixed then 15000 else 3000 end,case when mixed then 5000 else 3000 end);
   end loop;
 end loop;
end $$;
select 1 / case when count(*)=4 and bool_and(purchase.total=expected_total and purchase.shipping_fee=expected_fee)
 and bool_and((select count(*)=1 and sum(shipment.shipping_fee)=expected_fee from public.order_shipments shipment where shipment.order_id=purchase.id))
 then 1 else 0 end as assert_zero_price_order_and_shipment_quotes
from public.orders purchase join zero_price_orders expected on expected.id=purchase.id;

-- null disables the free threshold. Zero explicitly makes every policy parcel
-- free, including a 0-won policy item; individual fees remain independent.
update public.fulfillment_origins set free_threshold=null where code='gimpo';
select 1 / case when public.quote_goods_shipping(jsonb_build_array(value))->>'totalFee'='3000'
 then 1 else 0 end as assert_zero_policy_without_free_threshold
from zero_price_lines where id='shipping-zero-policy-good';
update public.fulfillment_origins set free_threshold=0 where code='gimpo';
select 1 / case when public.quote_goods_shipping(jsonb_build_array(value))->>'totalFee'='0'
 and public.quote_goods_shipping(jsonb_build_array(value,(select value from zero_price_lines where id='shipping-zero-individual-good')))->>'totalFee'='2000'
 then 1 else 0 end as assert_zero_threshold_waives_policy_fee_only
from zero_price_lines where id='shipping-zero-policy-good';
select 1 / case when bool_and(purchase.total=expected_total and purchase.shipping_fee=expected_fee
 and (purchase.shipping_fee_breakdown->0->>'policyFee')::bigint=3000)
 then 1 else 0 end as assert_policy_edit_preserves_existing_zero_price_order
from public.orders purchase join zero_price_orders expected on expected.id=purchase.id;

rollback;
