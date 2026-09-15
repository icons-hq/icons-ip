\set ON_ERROR_STOP on
begin;
insert into public.verticals(key,label,color) values ('ux-fee','배송 보존 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('ux-fee','배송 보존 검증','ux-fee',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,shipping_fee_type,individual_fee)
values ('ux-fee-good','ux-fee','배송 보존 합성 상품','키링',10000,'ok',10,'individual',3210);
select pg_temp.publish_goods_kc_fixture('ux-fee-good');
create temp table fee_line as select jsonb_build_array(jsonb_build_object('goodId',good_id,'variantId',id,'qty',1)) value
from public.goods_variants where good_id='ux-fee-good' and is_default;
select 1 / case when public.quote_goods_shipping(value)->>'totalFee'='3210' then 1 else 0 end as assert_individual_fee_applies from fee_line;

update public.goods set shipping_fee_type='policy' where id='ux-fee-good';
select 1 / case when individual_fee=3210 then 1 else 0 end as assert_policy_preserves_editor_fee from public.goods where id='ux-fee-good';
select 1 / case when (public.quote_goods_shipping(value)->>'totalFee')::bigint=(select base_fee from public.fulfillment_origins where code='gimpo') then 1 else 0 end as assert_policy_ignores_dormant_fee from fee_line;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000052401','authenticated','authenticated','ux-fee-snapshot@example.test',now(),'{}','{}',now(),now());
insert into public.orders(id,user_id,status,total,shipping_fee,address,expires_at)
values ('00000000-0000-4000-8000-000000052402','00000000-0000-4000-8000-000000052401','pending',10000,0,
'{"recipientName":"합성 검증","phone":"01000000000","postalCode":"00000","address1":"실제 발송 금지"}',now()+interval '1 hour');
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select '00000000-0000-4000-8000-000000052402',g.id,1,g.price,g.name,g.type,g.ip_id,v.id
from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='ux-fee-good';
select 1 / case when individual_fee_snapshot=0 and shipping_fee_type_snapshot='policy' then 1 else 0 end as assert_order_snapshot_remains_effective_only
from public.order_items where order_id='00000000-0000-4000-8000-000000052402';

update public.goods set shipping_fee_type='free' where id='ux-fee-good';
select 1 / case when individual_fee=3210 then 1 else 0 end as assert_free_preserves_editor_fee from public.goods where id='ux-fee-good';
select 1 / case when public.quote_goods_shipping(value)->>'totalFee'='0' then 1 else 0 end as assert_free_ignores_dormant_fee from fee_line;
update public.goods set shipping_fee_type='individual' where id='ux-fee-good';
select 1 / case when public.quote_goods_shipping(value)->>'totalFee'='3210' then 1 else 0 end as assert_reenabled_fee_is_restored from fee_line;
select 1 / case when individual_fee_snapshot=0 and shipping_fee_type_snapshot='policy' then 1 else 0 end as assert_existing_snapshot_unchanged
from public.order_items where order_id='00000000-0000-4000-8000-000000052402';
select 1 / case when not has_function_privilege('authenticated','private.guard_good_fulfillment()','execute')
and not has_function_privilege('anon','private.snapshot_order_item_fulfillment()','execute') then 1 else 0 end as assert_trigger_helpers_remain_sealed;
rollback;
