\set ON_ERROR_STOP on
begin;
-- 10/14 회의 A5: 품목별 배분 계산에 필요한 주문 당시 기록만 돌려준다. 전부 합성 롤백 데이터다.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000271601','authenticated','authenticated','allocation-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000271602','authenticated','authenticated','allocation-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000271601';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000271601','primary');
insert into public.verticals(key,label,color) values('allocation-input','배분 입력','#000000');
insert into public.ips(id,title,vertical_key) values('allocation-input','배분 입력','allocation-input');
insert into public.goods(id,ip_id,name,type,price) values('allocation-input','allocation-input','배분 키링','문구',6000);
insert into public.orders(id,user_id,status,total,shipping_fee,discount_total,store_credit_total,address) values
 ('54000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000271602','paid',11500,3000,1000,500,'{}');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,regular_unit_price_snapshot,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('74000000-0000-4000-8000-00000000000'||n)::uuid,'54000000-0000-4000-8000-000000000001',good_id,id,n,case n when 1 then 6000 else 2000 end,
 case n when 1 then 7000 end,'배분 키링','문구','allocation-input'
from public.goods_variants cross join generate_series(1,2) n where good_id='allocation-input' and is_default;
insert into public.coupons(code,name,discount_type,discount_value,starts_at) values('ALLOC-QA','배분 쿠폰','fixed',1000,'2026-01-01');
insert into public.user_coupons(id,coupon_code,user_id,issued_source,issued_at) values
 ('00000000-0000-4000-8000-000000271611','ALLOC-QA','00000000-0000-4000-8000-000000271602','admin_grant',now());
insert into public.coupon_redemptions(user_coupon_id,coupon_code,user_id,order_id,discount_amount,eligible_subtotal,terms_snapshot) values
 ('00000000-0000-4000-8000-000000271611','ALLOC-QA','00000000-0000-4000-8000-000000271602','54000000-0000-4000-8000-000000000001',1000,10000,
  '{"goodsScope":"all","targetGoodIds":[]}');

-- 1) 고객·익명은 읽지 못한다.
select 1/case when not has_function_privilege('anon','public.admin_order_item_allocation_inputs(uuid[])','execute')
 and has_function_privilege('authenticated','public.admin_order_item_allocation_inputs(uuid[])','execute')
 and not has_function_privilege('service_role','public.admin_order_item_allocation_inputs(uuid[])','execute')
 then 1 else 0 end as assert_allocation_inputs_grants;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271602',true);
do $$begin perform public.admin_order_item_allocation_inputs(array['54000000-0000-4000-8000-000000000001'::uuid]);raise exception 'customer read allocation inputs';
exception when insufficient_privilege then null;end$$;

-- 2) 운영자: 버전 1 주문의 첫 적용 쿠폰 기록과 품목 단가·수량·당시 정가를 그대로 준다.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271601',true);
select public.admin_order_item_allocation_inputs(array['54000000-0000-4000-8000-000000000001'::uuid,'54000000-0000-4000-8000-000000000009'::uuid]) as inputs \gset
select 1/case when jsonb_array_length(:'inputs'::jsonb)=1
 and :'inputs'::jsonb->0 @> '{"orderId":"54000000-0000-4000-8000-000000000001","calculationVersion":1,"couponDiscount":1000,"storeCredits":500,"volumeDiscount":0,
   "coupon":{"discountAmount":1000,"eligibleSubtotal":10000,"terms":{"goodsScope":"all"}}}'
 and :'inputs'::jsonb#>'{0,items}'=jsonb_build_array(
   jsonb_build_object('id','74000000-0000-4000-8000-000000000001','goodId','allocation-input','ipId','allocation-input','qty',1,'unitPrice',6000,'regularUnitPrice',7000,'couponEligible',true,'allocation',null),
   jsonb_build_object('id','74000000-0000-4000-8000-000000000002','goodId','allocation-input','ipId','allocation-input','qty',2,'unitPrice',2000,'regularUnitPrice',null,'couponEligible',true,'allocation',null))
 then 1 else 0 end as assert_legacy_inputs;
do $$begin perform public.admin_order_item_allocation_inputs('{}');raise exception 'empty allocation ids accepted';
exception when invalid_parameter_value then if sqlerrm<>'invalid_order_allocation_ids' then raise;end if;end$$;
do $$begin perform public.admin_order_item_allocation_inputs(array[null]::uuid[]);raise exception 'null allocation id accepted';
exception when invalid_parameter_value then null;end$$;

-- 3) 쿠폰 대상 판정: 상품(그룹 포함)·IP(주문 당시 IP)·카테고리(현재 분류, 상위 포함)·알 수 없는 범위.
reset role;
insert into public.catalog_categories(id,code,name) values('30000000-0000-4000-8000-000000271601','alloc-top','배분 상위');
insert into public.catalog_categories(id,code,name,parent_id,depth) values('30000000-0000-4000-8000-000000271602','alloc-child','배분 하위','30000000-0000-4000-8000-000000271601',2);
update public.goods set category_id='30000000-0000-4000-8000-000000271602' where id='allocation-input';
select 1/case when private.coupon_line_eligible_now('{"goodsScope":"selected_goods","targetGoodIds":["allocation-input"]}','allocation-input',null)
 and not private.coupon_line_eligible_now('{"goodsScope":"selected_goods","targetGoodIds":["other"]}','allocation-input',null)
 and private.coupon_line_eligible_now('{"goodsScope":"selected_ips","targetGoodIds":[],"targetIpIds":["allocation-input"]}','allocation-input','allocation-input')
 and not private.coupon_line_eligible_now('{"goodsScope":"selected_ips","targetGoodIds":[],"targetIpIds":["allocation-input"]}','allocation-input','other-ip')
 and private.coupon_line_eligible_now('{"goodsScope":"selected_categories","targetGoodIds":[],"targetCategoryIds":["30000000-0000-4000-8000-000000271601"]}','allocation-input',null)
 and not private.coupon_line_eligible_now('{"goodsScope":"selected_categories","targetGoodIds":[],"targetCategoryIds":["30000000-0000-4000-8000-000000271699"]}','allocation-input',null)
 and private.coupon_line_eligible_now('{"goodsScope":"selected_brands","targetGoodIds":[]}','allocation-input',null) is null
 and private.coupon_line_eligible_now(null,'allocation-input',null) is null
 and not has_function_privilege('authenticated','private.coupon_line_eligible_now(jsonb,text,text)','execute')
 and (select bool_and(position('couponEligible' in pg_get_functiondef(f::regprocedure))>0) from unnest(array['private.collect_settled_export(date,date,text)',
   'private.collect_settled_export_for_date(date,date,text,text)','private.collect_settled_export_for_search(date,date,text,text,text)']) f)
 then 1 else 0 end as assert_coupon_scope_eligibility;

-- 4) 버전 2 주문은 기록된 배분 원장을 준다(쿠폰 기록은 버전 1에만 싣는다).
reset role;
update public.orders set calculation_version=2 where id='54000000-0000-4000-8000-000000000001';
insert into private.order_price_allocations(order_item_id,order_id,calculation_version,subtotal,volume_discount,net_subtotal,coupon_discount,store_credit_discount,paid_goods_total)
values('74000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',2,6000,0,6000,600,300,5100),
      ('74000000-0000-4000-8000-000000000002','54000000-0000-4000-8000-000000000001',2,4000,0,4000,400,200,3400);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271601',true);
select 1/case when (select value->'coupon' from jsonb_array_elements(public.admin_order_item_allocation_inputs(array['54000000-0000-4000-8000-000000000001'::uuid])) value)='null'::jsonb
 and public.admin_order_item_allocation_inputs(array['54000000-0000-4000-8000-000000000001'::uuid])#>'{0,items,0,allocation}'
   ='{"volumeDiscount":0,"couponDiscount":600,"storeCreditDiscount":300,"paidGoodsTotal":5100}'::jsonb
 then 1 else 0 end as assert_recorded_allocations;
reset role;
rollback;
