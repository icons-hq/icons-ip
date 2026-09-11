\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in this psql connection.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000004871','authenticated','authenticated','coupon-target-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004872','authenticated','authenticated','coupon-target-first@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004873','authenticated','authenticated','coupon-target-repeat@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='coupon-target-'||right(id::text,4)||'@example.test',nickname='coupon_target_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),role=case when id='00000000-0000-4000-8000-000000004871' then 'staff'::public.user_role else 'user'::public.user_role end
where id in ('00000000-0000-4000-8000-000000004871','00000000-0000-4000-8000-000000004872','00000000-0000-4000-8000-000000004873');
insert into public.ips(id,title,vertical_key,published_at) values('coupon-target-ip','쿠폰 대상 검증','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
values('00000000-0000-4000-8000-000000004870','coupon-target-origin','합성 출고지','hanjin',3000,'합성 반품 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('coupon-target-one','coupon-target-ip','대상 상품','문구',10000,'ok',100,'00000000-0000-4000-8000-000000004870'),
 ('coupon-target-two','coupon-target-ip','비대상 상품','문구',20000,'ok',100,'00000000-0000-4000-8000-000000004870');
select pg_temp.publish_goods_kc_fixture('coupon-target-one');
select pg_temp.publish_goods_kc_fixture('coupon-target-two');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004871',true);
set local role authenticated;
select public.admin_upsert_coupon_targeted(jsonb_build_object(
 'target_code','TARGETFIRST','target_name','첫구매 대상 상품','target_discount_type','percent','target_discount_value',50,
 'target_max_discount_amount',null,'target_min_subtotal',5000,'target_starts_at',now()-interval '1 day','target_ends_at',null,
 'target_issue_limit',null,'target_status','active','target_grade_benefit',null,'target_previous_code',null,
 'target_recipient_segment','first_purchase','target_goods_scope','selected_goods','target_good_ids',jsonb_build_array('coupon-target-one'),'target_expected_revision',null));
select public.admin_upsert_coupon_targeted(jsonb_build_object(
 'target_code','TARGETREPEAT','target_name','재구매 대상 상품','target_discount_type','fixed','target_discount_value',2000,
 'target_max_discount_amount',null,'target_min_subtotal',5000,'target_starts_at',now()-interval '1 day','target_ends_at',null,
 'target_issue_limit',null,'target_status','active','target_grade_benefit','silver','target_previous_code',null,
 'target_recipient_segment','repeat_purchase','target_goods_scope','selected_goods','target_good_ids',jsonb_build_array('coupon-target-one'),'target_expected_revision',null));
select 1/case when (select total_count=2 and recipient_segment='first_purchase' and target_goods->0->>'name'='대상 상품' from public.admin_search_coupons('TARGET','all',1,0)) then 1 else 0 end as targeting_does_not_truncate_search_total;
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004872',true);
set local role authenticated;
-- Recipient is eligible even with no target goods currently in the cart.
select public.apply_cart_coupon_code('TARGETFIRST');
select 1/case when (public.quote_goods_sales('[]')->'coupon'->>'reason')='coupon_no_eligible_goods' then 1 else 0 end as issuance_is_independent_from_discount_goods;
do $$ begin
 begin perform public.apply_cart_coupon_code('TARGETREPEAT'); raise exception 'unpaid user received repeat coupon';
 exception when check_violation then if sqlerrm<>'coupon_repeat_purchase_only' then raise; end if; end;
end $$;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004872',good_id,id,1 from public.goods_variants where good_id in ('coupon-target-one','coupon-target-two') and is_default;
select 1/case when (public.quote_goods_sales((select jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)) from public.cart_items where user_id='00000000-0000-4000-8000-000000004872'))->'coupon'->>'discount')::bigint=5000
 then 1 else 0 end as mixed_basket_discounts_only_target_amount;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004872','{"recipientName":"쿠폰 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','10000000-0000-4000-8000-000000004872','card',0) as first_order_id \gset
reset role;
select 1/case when (select total=28000 and discount_total=5000 and shipping_fee=3000 from public.orders where id=:'first_order_id')
 and (select eligible_subtotal=10000 and terms_snapshot->>'goodsScope'='selected_goods' from public.coupon_redemptions where order_id=:'first_order_id') then 1 else 0 end as order_keeps_target_subtotal_and_terms_snapshot;

-- An active first benefit prevents another payable order from becoming the
-- actual first valid payment. Once canceled, both coupon and claim are released.
set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004872','coupon-target-two',id,1 from public.goods_variants where good_id='coupon-target-two' and is_default;
reset role;
set local role service_role;
do $$ begin
 begin perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000004872','{"recipientName":"쿠폰 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','10000000-0000-4000-8000-000000004874','card',0); raise exception 'a competing order bypassed first benefit';
 exception when check_violation then if sqlerrm<>'coupon_first_purchase_reserved' then raise; end if; end;
end $$;
select public.request_order_cancellation(:'first_order_id','00000000-0000-4000-8000-000000004872','첫 혜택 주문 취소','change_of_mind');
reset role;
set local role authenticated;
select public.apply_cart_coupon_code('TARGETFIRST');
select 1/case when (public.quote_goods_sales((select jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)) from public.cart_items where user_id='00000000-0000-4000-8000-000000004872'))->'coupon'->>'reason')='coupon_no_eligible_goods'
 then 1 else 0 end as coupon_restores_without_discounting_other_goods;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004872','coupon-target-one',id,1 from public.goods_variants where good_id='coupon-target-one' and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004872','{"recipientName":"쿠폰 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','10000000-0000-4000-8000-000000004875','card',0) as paid_order_id \gset
reset role;
do $$ declare attempt public.payment_attempts; begin
 perform public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000004872',(select id from public.orders where checkout_key='10000000-0000-4000-8000-000000004875'),'toss');
 select * into attempt from public.payment_attempts where ref_id=(select id from public.orders where checkout_key='10000000-0000-4000-8000-000000004875');
 perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('f',64));
 perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('f',64),'20000000-0000-4000-8000-000000004872');
 perform public.finalize_goods_payment_attempt(attempt.id,'20000000-0000-4000-8000-000000004872','approved',null,'coupon-target-paid-key');
end $$;
set local role authenticated;
select public.apply_cart_coupon_code('TARGETREPEAT');
select 1/case when (public.get_my_coupon_purchase_status()->>'hasValidPayment')::boolean then 1 else 0 end as verified_payment_enables_repeat_benefit;
select 1/case when (select count(*) from public.cart_coupon_selections)=1 then 1 else 0 end as grade_and_targeted_benefits_remain_one_coupon;
reset role;
set local role service_role;
select public.request_order_cancellation(:'paid_order_id','00000000-0000-4000-8000-000000004872','전액 환불 뒤 자격 검증','change_of_mind');
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id=:'paid_order_id'),array['coupon-target-paid-key'],'00000000-0000-4000-8000-000000004871');
reset role;
set local role authenticated;
do $$ begin
 begin perform public.apply_cart_coupon_code('TARGETREPEAT'); raise exception 'fully refunded user still has repeat eligibility';
 exception when check_violation then if sqlerrm<>'coupon_repeat_purchase_only' then raise; end if; end;
end $$;
select public.apply_cart_coupon_code('TARGETFIRST');
reset role;

-- Changing conditions never rewrites the existing order's target snapshot.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004871',true);
set local role authenticated;
select public.admin_upsert_coupon_targeted(jsonb_build_object(
 'target_code','TARGETFIRST','target_name','첫구매 대상 변경','target_discount_type','percent','target_discount_value',25,
 'target_max_discount_amount',null,'target_min_subtotal',5000,'target_starts_at',now()-interval '1 day','target_ends_at',null,
 'target_issue_limit',null,'target_status','active','target_grade_benefit',null,'target_previous_code','TARGETFIRST',
 'target_recipient_segment','first_purchase','target_goods_scope','selected_goods','target_good_ids',jsonb_build_array('coupon-target-two'),
 'target_expected_revision',(select terms_revision from public.coupons where code='TARGETFIRST')));
do $$ begin
 begin
 perform public.admin_upsert_coupon_targeted(jsonb_build_object('target_code','TARGETFIRST','target_previous_code','TARGETFIRST','target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,'target_expected_revision',1));
 raise exception 'stale coupon revision accepted';
 exception when sqlstate 'PT409' then null; end;
end $$;
reset role;
select 1/case when (select bool_and(eligible_subtotal=10000 and terms_snapshot->>'discountValue'='50') from public.coupon_redemptions where coupon_code='TARGETFIRST') then 1 else 0 end as old_redemptions_preserve_their_original_conditions;
select 1/case when not has_table_privilege('authenticated','private.coupon_first_purchase_claims','select')
 and not has_function_privilege('authenticated','private.reserve_first_purchase_coupon(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','public.admin_upsert_coupon_targeted(jsonb)','execute') then 1 else 0 end as entitlement_and_staff_mutation_acl_is_sealed;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004873',true);
set local role authenticated;
do $$ begin
 begin perform public.admin_upsert_coupon_targeted('{}'); raise exception 'customer altered coupon targeting';
 exception when insufficient_privilege then null; end;
 begin perform public.coupon_recipient_state(jsonb_populate_record(null::public.coupons,'{"code":"TARGETFIRST","recipient_segment":"all"}'));
 raise exception 'composite input bypassed coupon ownership'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
