\set ON_ERROR_STOP on
-- The fixture helper is prepended by the leased-clone runner. All IDs/data are synthetic.
begin;
-- This suite exercises both gate states regardless of earlier clone fixtures.
update private.goods_transaction_runtime set enabled=false where singleton;
create function pg_temp.aggregation_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bc140000-0000-4000-8000-000000000001','authenticated','authenticated','aggregation-admin@example.test',now(),'{}','{}',now(),now()),
 ('bc140000-0000-4000-8000-000000000002','authenticated','authenticated','aggregation-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 합산 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bc140000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bc140000-0000-4000-8000-000000000001','bc140000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('bc140000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('aggregation-ip','TEST 합산 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bc140000-0000-4000-8000-000000000010','aggregation-origin','TEST 합산출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('aggregation-root','aggregation-ip','TEST 원상품','문구',10000,'ok',100,'bc140000-0000-4000-8000-000000000010','individual',3001),
 ('aggregation-child','aggregation-ip','TEST 분리상품','문구',5000,'ok',100,'bc140000-0000-4000-8000-000000000010','individual',3001),
 ('aggregation-child-two','aggregation-ip','TEST 후속분리상품','문구',7000,'ok',100,'bc140000-0000-4000-8000-000000000010','individual',3001);
select set_config('request.jwt.claim.sub','bc140000-0000-4000-8000-000000000001',true);
select private.bind_goods_aggregation('aggregation-root',array['aggregation-child'],'bc140000-0000-4000-8000-000000000011','bc140000-0000-4000-8000-000000000001') as family_id \gset
select private.bind_goods_aggregation('aggregation-child',array['aggregation-child-two'],'bc140000-0000-4000-8000-000000000012','bc140000-0000-4000-8000-000000000001');
select 1/case when private.goods_aggregation_owner('aggregation-child-two')='aggregation-root' and
 (select count(*)=3 from private.goods_aggregation_members where root_good_id='aggregation-root') then 1 else 0 end as assert_flattened_immutable_family;
select pg_temp.aggregation_expect_error('delete from private.goods_aggregation_members where good_id=''aggregation-child''','goods_aggregation_identity_immutable');
select pg_temp.aggregation_expect_error('update private.goods_aggregation_members set root_good_id=''aggregation-child'' where good_id=''aggregation-child-two''','goods_aggregation_identity_immutable');
select pg_temp.aggregation_expect_error('update public.goods set individual_fee=9999 where id=''aggregation-child''','goods_aggregation_policy_owned_by_source');
-- Stale but unchanged policy fields in an unrelated editor roundtrip remain accepted.
update public.goods set individual_fee=individual_fee,name=name where id='aggregation-child';
update public.goods set order_quantity_limit_enabled=true,min_order_qty=2,max_order_qty=3,member_purchase_limit_enabled=true,member_lifetime_qty_limit=5 where id='aggregation-root';
select 1/case when private.check_goods_purchase_quantity(g,'bc140000-0000-4000-8000-000000000002',4,true)='order_quantity_above_maximum'
 and private.check_goods_purchase_quantity(g,'bc140000-0000-4000-8000-000000000002',1,true)='order_quantity_below_minimum' then 1 else 0 end as assert_owner_limits
 from public.goods g where g.id='aggregation-child' \gset
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','aggregation-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='aggregation-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='aggregation-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='aggregation-ip';
select id as variant_a from public.goods_variants where good_id='aggregation-root' and is_default \gset
select id as variant_b from public.goods_variants where good_id='aggregation-child' and is_default \gset
select id as variant_c from public.goods_variants where good_id='aggregation-child-two' and is_default \gset
set local role anon;
select public.get_goods_transaction_offers(array['aggregation-root','aggregation-child']) as disabled_offers \gset
select 1/case when (:'disabled_offers'::jsonb#>>'{0,aggregation,runtimeEnabled}')::boolean=false
 and :'disabled_offers'::jsonb#>>'{0,aggregation,id}'=:'family_id'
 and :'disabled_offers'::jsonb#>>'{0,sharedPolicy,maxOrderQty}'='3'
 and not (:'disabled_offers'::jsonb#>'{0,aggregation}') ? 'ownerGoodId' then 1 else 0 end as assert_public_opaque_family_gate_and_owner_policy;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','bc140000-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('aggregation-root',:'variant_a',2);
set local role service_role;
select pg_temp.aggregation_expect_error('select public.place_order(''bc140000-0000-4000-8000-000000000002''::uuid,''{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}''::jsonb,''bc140000-0000-4000-8000-000000000019'',''card'')','checkout_contract_upgrade_required');
set local role authenticated;
reset role;
select 1/case when not exists(select 1 from public.orders where user_id='bc140000-0000-4000-8000-000000000002')
 and (select stock_qty=100 from public.goods_variants where id=:'variant_a') then 1 else 0 end as assert_runtime_off_no_active_terms_legacy_atomicity;
-- Without an active quantity policy, original per-good shipping is charged once.
select private.calculate_goods_transaction_shipping(
 '[{"good_id":"aggregation-root","origin_id":"bc140000-0000-4000-8000-000000000010","qty":1,"unit_price":10000,"fee_type":"individual","individual_fee":3001},
 {"good_id":"aggregation-child","origin_id":"bc140000-0000-4000-8000-000000000010","qty":1,"unit_price":5000,"fee_type":"individual","individual_fee":3001}]',
 '{"postalCode":"12345","address1":"TEST 합성 주소"}','{}',now()) as individual_shipping \gset
select 1/case when :'individual_shipping'::jsonb->>'prepaidFee'='3001'
 and (select sum((value->>'baseFee')::numeric)=3001 from jsonb_array_elements(:'individual_shipping'::jsonb#>'{displayGroups,0,components}'))
 and (select (value->>'baseFee')::numeric=2001 from jsonb_array_elements(:'individual_shipping'::jsonb#>'{displayGroups,0,components}') where value->>'goodId'='aggregation-root')
 then 1 else 0 end as assert_individual_fee_once_and_exact_integer_allocation;
select 1/case when private.calculate_goods_transaction_shipping(
 '[{"good_id":"aggregation-child-two","origin_id":"bc140000-0000-4000-8000-000000000010","qty":1,"unit_price":7000,"fee_type":"individual","individual_fee":3001}]',
 '{"postalCode":"12345","address1":"TEST 합성 주소"}','{}',now())#>>'{displayGroups,0,components,0,goodId}'='aggregation-child-two'
 then 1 else 0 end as assert_no_unselected_owner_in_shipping;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','bc140000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_price_period('aggregation-root',:'variant_a',null,
 jsonb_build_object('state','active','discountPrice',8000,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'),null);
select public.admin_save_good_transaction_terms('aggregation-root',0,(select updated_at from public.goods where id='aggregation-root'),
 '{"status":"active","terms":{"condition":"quantity","threshold":3,"discountKind":"fixed","discountValue":1000,"startsAt":null,"endsAt":null},"draftValues":{}}',
 '{"status":"active","paymentMode":"prepaid","quantityTerms":{"kind":"repeat","baseFee":3000,"interval":2},"draftValues":{}}',
 'bc140000-0000-4000-8000-000000000021','bc140000-0000-4000-8000-000000000001');
select pg_temp.aggregation_expect_error(format('select public.admin_save_good_transaction_terms(%L,0,%L::timestamptz,%L::jsonb,null,%L,%L)',
 'aggregation-child',(select updated_at from public.goods where id='aggregation-child'),'{"status":"disabled","terms":null,"draftValues":{}}',
 'bc140000-0000-4000-8000-000000000022','bc140000-0000-4000-8000-000000000001'),'goods_aggregation_policy_owned_by_source');
select 1/case when public.admin_get_goods_aggregation('aggregation-child')->>'ownerGoodId'='aggregation-root'
 and public.admin_get_good_transaction_terms('aggregation-child')#>>'{volume,goodId}'='aggregation-child' then 1 else 0 end as assert_admin_source_terms;
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,goods_scope,target_good_ids)
 values('AGGREGATION10','TEST 원상품10%','percent',10,0,now()-interval '1 day','active','selected_goods',array['aggregation-root']),
 ('AGGREGATIONCHILD','TEST 자상품10%','percent',10,0,now()-interval '1 day','active','selected_goods',array['aggregation-child']);
set local role authenticated;
select set_config('request.jwt.claim.sub','bc140000-0000-4000-8000-000000000002',true);
select public.set_cart_item_quantity('aggregation-root',:'variant_a',2);
select public.set_cart_item_quantity('aggregation-child',:'variant_b',1);
select public.apply_cart_coupon_code('AGGREGATION10') as held_coupon \gset
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart
 from public.cart_items where user_id='bc140000-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
set local role service_role;
select pg_temp.aggregation_expect_error(format('select public.place_order(%L::uuid,%L::jsonb,%L::uuid,%L::public.order_payment_method)','bc140000-0000-4000-8000-000000000002',:'address','bc140000-0000-4000-8000-000000000030','card'),'checkout_contract_upgrade_required');
set local role authenticated;
reset role;
set local role service_role;
select public.quote_cart_goods_transaction('bc140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'held_coupon',0) as quote \gset
select 1/case when :'quote'::jsonb->>'state'='quoted' and :'quote'::jsonb#>'{display,totals}'=
 '{"subtotal":21000,"volumeDiscountTotal":3000,"netGoodsTotal":18000,"couponDiscountTotal":1800,"storeCreditTotal":0,"prepaidShippingTotal":6000,"collectShippingTotal":0,"onlineTotal":22200,"customerTotal":22200}'::jsonb
 then 1 else 0 end as assert_family_quantities_discount_shipping_and_original_coupon;
select public.place_cart_goods_transaction('bc140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,
 'bc140000-0000-4000-8000-000000000031','card') as order_id \gset
reset role;
select 1/case when private.goods_transaction_snapshot_matches(:'order_id',22200,6000)
 and (select count(*)=2 and sum(volume_discount)=3000 and sum(coupon_discount)=1800 from private.order_price_allocations where order_id=:'order_id')
 and (select count(*)=2 and sum(total_fee)=6000 from private.shipping_charge_components where order_id=:'order_id')
 and (select count(*)=2 from public.order_items where order_id=:'order_id' and good_id in('aggregation-root','aggregation-child'))
 and private.member_goods_reserved_qty('bc140000-0000-4000-8000-000000000002','aggregation-child-two')=3
 then 1 else 0 end as assert_actual_items_shipping_components_and_historical_family_limit;
select 1/case when private.check_goods_purchase_quantity(g,'bc140000-0000-4000-8000-000000000002',3,true)='member_purchase_limit_exceeded'
 then 1 else 0 end as assert_lifetime_limit_other_family_member from public.goods g where g.id='aggregation-child-two';
-- Existing coupons may explicitly target one new member; a root target includes all members exactly once.
insert into public.user_coupons(id,user_id,coupon_code,issued_source) values('bc140000-0000-4000-8000-000000000040','bc140000-0000-4000-8000-000000000002','AGGREGATIONCHILD','admin_grant');
select 1/case when o_eligible_subtotal=4000 and o_discount=400 then 1 else 0 end as assert_child_specific_coupon
 from private.evaluate_coupon_target_lines_at('bc140000-0000-4000-8000-000000000040','bc140000-0000-4000-8000-000000000002',
 '[{"good_id":"aggregation-root","subtotal":14000},{"good_id":"aggregation-child","subtotal":4000}]',null,now());
-- Family delivery choices cannot split one aggregate charge between payment modes.
select 1/case when private.calculate_goods_transaction_shipping(
 '[{"good_id":"aggregation-root","origin_id":"bc140000-0000-4000-8000-000000000010","qty":2,"unit_price":8000,"fee_type":"individual","individual_fee":3001},
 {"good_id":"aggregation-child","origin_id":"bc140000-0000-4000-8000-000000000010","qty":1,"unit_price":5000,"fee_type":"individual","individual_fee":3001}]',
 '{"postalCode":"12345","address1":"TEST 합성 주소"}','{"aggregation-root":"prepaid","aggregation-child":"collect"}',now())#>>'{issues,0,code}'='delivery_choice_required'
 then 1 else 0 end as assert_family_delivery_choice_consistency;
set local role authenticated;
select set_config('request.jwt.claim.sub','bc140000-0000-4000-8000-000000000001',true);
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','bc140000-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST 상품당지역비',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST-ONLY: aggregation region','unlistedDisposition','standard','feeUnit','per_good',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',false,
 'rules',jsonb_build_array(jsonb_build_object('id',null,'postalFrom','12345','postalTo','12345','addressPrefix','','regionLabel','TEST 지역','disposition','surcharge','amount',1001))),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
reset role;
select private.calculate_goods_transaction_shipping(
 '[{"good_id":"aggregation-root","origin_id":"bc140000-0000-4000-8000-000000000010","qty":2,"unit_price":8000,"fee_type":"individual","individual_fee":3001},
 {"good_id":"aggregation-child","origin_id":"bc140000-0000-4000-8000-000000000010","qty":1,"unit_price":5000,"fee_type":"individual","individual_fee":3001}]',
 '{"postalCode":"12345","address1":"TEST 합성 주소"}','{}',now()) as regional_shipping \gset
select 1/case when :'regional_shipping'::jsonb->>'prepaidFee'='7001'
 and (select sum((value->>'regionalFee')::numeric)=1001 from jsonb_array_elements(:'regional_shipping'::jsonb#>'{displayGroups,0,components}'))
 and (select count(*)=2 from jsonb_array_elements(:'regional_shipping'::jsonb#>'{displayGroups,0,components}'))
 and private.goods_transaction_snapshot_matches(:'order_id',22200,6000)
 then 1 else 0 end as assert_per_good_regional_fee_once_and_old_snapshot_preserved;
rollback;
