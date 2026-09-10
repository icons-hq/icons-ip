\set ON_ERROR_STOP on
-- All postal codes, amounts, addresses and proof references below are synthetic.
-- Prepend helpers/goods_kc_fixture.sql. Never deploy these rows as policy data.
begin;
create function pg_temp.region_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
create function pg_temp.region_items(good_ids text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',id,'qty',1) order by good_id),'[]')
  from public.goods_variants where good_id=any(good_ids) and is_default;
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000049301','authenticated','authenticated','region-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000049302','authenticated','authenticated','region-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000049303','authenticated','authenticated','region-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='region-'||right(id::text,4)||'@example.test',nickname='region_'||right(id::text,4),birth_date='2000-01-01',
  consents='{"terms":true,"privacy":true}',onboarded_at=now(),
  role=case id when '00000000-0000-4000-8000-000000049301' then 'admin'::public.user_role
    when '00000000-0000-4000-8000-000000049302' then 'staff'::public.user_role else 'user'::public.user_role end
  where id in ('00000000-0000-4000-8000-000000049301','00000000-0000-4000-8000-000000049302','00000000-0000-4000-8000-000000049303');
insert into public.ips(id,title,vertical_key,published_at) values('shipping-region-ip','지역 배송 합성 검증','character',now());
insert into public.shipping_carriers(code,label,tracking_url_template,is_active)
 values('region_test','TEST-ONLY 합성 택배사','https://example.test/{trackingNumber}',true);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 ('00000000-0000-4000-8000-000000049310','region-a','합성 출고지 A','hanjin',3000,30000,'배송 금지 합성 주소 A',true),
 ('00000000-0000-4000-8000-000000049311','region-b','합성 출고지 B','hanjin',4500,50000,'배송 금지 합성 주소 B',true),
 ('00000000-0000-4000-8000-000000049312','region-future','합성 미래 출고지','hanjin',3000,null,'배송 금지 합성 주소 C',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('region-policy-a','shipping-region-ip','정책 A','문구',10000,'ok',100,'00000000-0000-4000-8000-000000049310','policy',0),
 ('region-free-a','shipping-region-ip','무료 A','문구',7000,'ok',100,'00000000-0000-4000-8000-000000049310','free',0),
 ('region-individual-a','shipping-region-ip','개별 A','문구',5000,'ok',100,'00000000-0000-4000-8000-000000049310','individual',1200),
 ('region-policy-b','shipping-region-ip','정책 B','문구',11000,'ok',100,'00000000-0000-4000-8000-000000049311','policy',0),
 ('region-free-b','shipping-region-ip','무료 B','문구',7000,'ok',100,'00000000-0000-4000-8000-000000049311','free',0),
 ('region-individual-b','shipping-region-ip','개별 B','문구',5000,'ok',100,'00000000-0000-4000-8000-000000049311','individual',800),
 ('region-future','shipping-region-ip','미래 정책 상품','문구',10000,'ok',100,'00000000-0000-4000-8000-000000049312','policy',0);
insert into public.goods_variants(id,good_id,name,attributes,price,stock_qty)
 values('00000000-0000-4000-8000-000000049320','region-individual-a','합성 두번째 옵션','{"색":"합성"}',5000,100);
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='shipping-region-ip';
select jsonb_build_object('postalCode','10000','address1','합성시 검증구 검증로 1') as region_destination \gset
select public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb) as region_legacy \gset
select 1/case when :'region_legacy'::jsonb->>'finalTotalFee'='3000' and :'region_legacy'::jsonb->>'checkoutAllowed'='true'
  and :'region_legacy'::jsonb#>>'{groups,0,regionMode}'='legacy_base_only'
  and :'region_legacy'::jsonb#>>'{groups,0,regionalContractFee}' is null and :'region_legacy'::jsonb#>>'{groups,0,regionalFee}'='0'
  then 1 else 0 end as legacy_charge_preserved_without_inventing_a_contract_amount;
select 1/case when not has_table_privilege('authenticated','private.shipping_region_policies','select')
  and not has_table_privilege('anon','private.shipping_region_adoptions','select')
  and not has_function_privilege('authenticated','private.apply_shipping_region_quote(jsonb,jsonb,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_shipping_region_policy(uuid,jsonb,integer)','execute')
  then 1 else 0 end as policy_and_order_helpers_are_private;

select jsonb_build_object('originId','00000000-0000-4000-8000-000000049310','carrierCode','hanjin','name','',
  'startsAt',null,'endsAt',null,'openEnded',null,'sourceEvidence','','unlistedDisposition',null,'feeUnit',null,
  'chargePolicyGoods',null,'waivePolicyThreshold',null,'chargeFreeGoods',null,'chargeIndividualGoods',null,
  'noRulesConfirmed',false,'rules','[]'::jsonb) as region_blank \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049302',true);
select public.admin_list_shipping_region_policies();
select pg_temp.region_expect_error(format('select public.admin_save_shipping_region_policy(null,%L::jsonb,null)',:'region_blank'),'admin required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049303',true);
select pg_temp.region_expect_error('select public.admin_list_shipping_region_policies()','staff required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049301',true);
select public.admin_save_shipping_region_policy(null,:'region_blank'::jsonb,null) as region_draft \gset
select pg_temp.region_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,1,true)',
  :'region_draft'::jsonb->>'id','active'),'shipping_region_policy_incomplete','23514');
select jsonb_build_array(
  jsonb_build_object('id',null,'postalFrom','10000','postalTo','10010','addressPrefix','','regionLabel','합성 추가료 구간','disposition','surcharge','amount',2500),
  jsonb_build_object('id',null,'postalFrom','10011','postalTo','10020','addressPrefix','','regionLabel','합성 명시적 0원 구간','disposition','surcharge','amount',0),
  jsonb_build_object('id',null,'postalFrom','10021','postalTo','10030','addressPrefix','','regionLabel','합성 배송 불가 구간','disposition','unavailable','amount',null),
  jsonb_build_object('id',null,'postalFrom','10031','postalTo','10040','addressPrefix','','regionLabel','합성 개별 확인 구간','disposition','manual_review','amount',null),
  jsonb_build_object('id',null,'postalFrom','10041','postalTo','10050','addressPrefix','합성시 검증구','regionLabel','합성 주소 조건 A','disposition','surcharge','amount',1000),
  jsonb_build_object('id',null,'postalFrom','10041','postalTo','10050','addressPrefix','합성시 다른구','regionLabel','합성 주소 조건 B','disposition','surcharge','amount',2000)
  ) as region_rules \gset
select :'region_blank'::jsonb||jsonb_build_object('name','TEST-ONLY 합성 정책 A','startsAt',now()-interval '1 day','openEnded',true,
  'sourceEvidence','TEST-ONLY:carrier-reply-not-real','unlistedDisposition','standard','feeUnit','per_shipment',
  'chargePolicyGoods',true,'waivePolicyThreshold',true,'chargeFreeGoods',false,'chargeIndividualGoods',true,'rules',:'region_rules'::jsonb) as region_config \gset
select public.admin_save_shipping_region_policy((:'region_draft'::jsonb->>'id')::uuid,:'region_config'::jsonb,1) as region_ready \gset
select pg_temp.region_expect_error(format('select public.admin_save_shipping_region_policy(%L,%L::jsonb,1)',
  :'region_ready'::jsonb->>'id',:'region_config'),'shipping_region_policy_changed','PT409');
select pg_temp.region_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,2,false)',
  :'region_ready'::jsonb->>'id','active'),'shipping_region_attestation_required','23514');
select public.admin_set_shipping_region_policy_status((:'region_ready'::jsonb->>'id')::uuid,'active',2,true) as region_active \gset
select pg_temp.region_expect_error(format('select public.admin_save_shipping_region_policy(%L,%L::jsonb,3)',
  :'region_active'::jsonb->>'id',:'region_config'),'shipping_region_policy_immutable','23514');
select public.admin_save_shipping_region_policy(null,:'region_config'::jsonb,null) as region_overlap \gset
select pg_temp.region_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,1,true)',
  :'region_overlap'::jsonb->>'id','active'),'shipping_region_period_overlap','23514');
select public.admin_save_shipping_region_policy(null,:'region_config'::jsonb||jsonb_build_object('originId','00000000-0000-4000-8000-000000049311',
  'name','TEST-ONLY 합성 정책 B','feeUnit','per_good','chargeFreeGoods',true,'waivePolicyThreshold',false,
  'rules',jsonb_build_array(jsonb_build_object('id',null,'postalFrom','10000','postalTo','10010','addressPrefix','','regionLabel','합성 B 구간','disposition','surcharge','amount',1500))),null) as region_b \gset
select public.admin_set_shipping_region_policy_status((:'region_b'::jsonb->>'id')::uuid,'active',1,true);
reset role;

-- Inclusive postal boundaries; missing/zero rates remain distinct.
do $$ declare postal text; expected bigint; actual jsonb; begin
  for postal,expected in values('09999',3000::bigint),('10000',5500),('10010',5500),('10011',3000),('10020',3000),('10051',3000) loop
    actual:=public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),jsonb_build_object('postalCode',postal,'address1','합성시 검증구 검증로 1'));
    if (actual->>'finalTotalFee')::bigint<>expected or actual->>'checkoutAllowed'<>'true' then raise exception 'postal boundary mismatch at %: %',postal,actual; end if;
  end loop;
end $$;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  '{"postalCode":"10011","address1":"합성시"}')#>>'{groups,0,regionalContractFee}'='0' then 1 else 0 end as explicit_zero_contract_is_known;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),null)->>'finalTotalFee' is null
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),null)#>>'{groups,0,regionStatus}'='address_required'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),null)->>'totalFee'='3000'
  then 1 else 0 end as missing_address_keeps_reference_fee_and_blocks_checkout;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-free-a']),
  '{"postalCode":"10021","address1":"합성시"}')->>'checkoutAllowed'='false'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  '{"postalCode":"10030","address1":"합성시"}')#>>'{groups,0,regionStatus}'='unavailable'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  '{"postalCode":"10040","address1":"합성시"}')#>>'{groups,0,regionStatus}'='manual_review'
  then 1 else 0 end as free_goods_do_not_bypass_unavailable_destinations;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  '{"postalCode":"10045","address1":"합성시 검증구 검증로 1"}')->>'finalTotalFee'='4000'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  '{"postalCode":"10045","address1":"합성시 다른구 검증로 1"}')->>'finalTotalFee'='5000'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  '{"postalCode":"10045","address1":"합성시 검증구역 검증로 1"}')#>>'{groups,0,regionStatus}'='manual_review'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),
  jsonb_build_object('postalCode','10045','address1',E'\t합성시'||chr(160)||'검증구  검증로 1'))#>>'{groups,0,matchedAddressPrefix}'='합성시 검증구'
  then 1 else 0 end as prefix_boundary_and_no_match_never_fall_back_to_standard;

select public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a','region-free-a','region-individual-a',
  'region-policy-b','region-free-b','region-individual-b'])||jsonb_build_array(jsonb_build_object('goodId','region-individual-a',
  'variantId','00000000-0000-4000-8000-000000049320','qty',3)),:'region_destination'::jsonb) as region_mixed \gset
select 1/case when :'region_mixed'::jsonb->>'finalTotalFee'='16500' and :'region_mixed'::jsonb#>>'{groups,0,regionalFee}'='2500'
  and :'region_mixed'::jsonb#>>'{groups,0,individualFee}'='1200' and :'region_mixed'::jsonb#>>'{groups,1,unitCount}'='3'
  and :'region_mixed'::jsonb#>>'{groups,1,regionalFee}'='4500' then 1 else 0 end as mixed_origins_per_shipment_and_per_good_count_distinct_goods;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-free-a']),:'region_destination'::jsonb)->>'finalTotalFee'='0'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-free-a']),:'region_destination'::jsonb)#>>'{groups,0,regionalContractFee}'='2500'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-free-b']),:'region_destination'::jsonb)->>'finalTotalFee'='1500'
  and public.quote_goods_shipping_for_address(jsonb_set(pg_temp.region_items(array['region-policy-a']),'{0,qty}','3'),:'region_destination'::jsonb)->>'finalTotalFee'='0'
  and public.quote_goods_shipping_for_address(jsonb_set(pg_temp.region_items(array['region-policy-a']),'{0,qty}','3')||pg_temp.region_items(array['region-individual-a']),
    :'region_destination'::jsonb)->>'finalTotalFee'='3700' then 1 else 0 end as free_threshold_waives_only_eligible_policy_goods;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb)::text
  not like '%TEST-ONLY:carrier-reply-not-real%' then 1 else 0 end as customer_quote_does_not_expose_internal_proof;

-- A zero base fee alone does not imply a reached free threshold. It also tests
-- coupon minimum-PG caps and store-credit limits against final regional fees.
update public.fulfillment_origins set base_fee=0 where id='00000000-0000-4000-8000-000000049310';
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb)->>'finalTotalFee'='2500'
  then 1 else 0 end as zero_base_does_not_waive_region_fee;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('REGION4932K','지역료 합성 2천원','fixed',2000,0,now()-interval '1 day','active'),
 ('REGION493FULL','지역료 합성 전액','fixed',10000,0,now()-interval '1 day','active');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049301',true);
set local role authenticated;
select public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000049301',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY:region-credit-fixture"}');
select public.admin_adjust_store_credit('20000000-0000-4000-8000-000000049301','00000000-0000-4000-8000-000000049303',30000,now()+interval '1 day','TEST-ONLY 검증 지급',0);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049303',true);
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000049303',good_id,id,1
  from public.goods_variants where good_id='region-policy-a' and is_default;
select public.apply_cart_coupon_code('REGION4932K');
select 1/case when public.get_my_store_credit_checkout(7500)->>'valid'='false'
  and public.get_my_store_credit_checkout_for_address(7500,:'region_destination'::jsonb)->>'valid'='true'
  and public.get_my_store_credit_checkout_for_address(7500,:'region_destination'::jsonb)->>'maxUse'='8000'
  and public.get_my_store_credit_checkout_for_address(100,null)->>'valid'='false'
  and public.get_my_store_credit_checkout_for_address(0,null)->>'valid'='true'
  and public.get_my_store_credit_checkout_for_address(0,null)->>'reason'='shipping_region_unresolved'
  then 1 else 0 end as address_credit_quote_uses_final_shipping_and_pending_state;
select public.apply_cart_coupon_code('REGION493FULL');
select 1/case when public.quote_goods_sales(pg_temp.region_items(array['region-policy-a']))#>>'{coupon,discount}'='9000'
  and public.quote_goods_sales_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb)#>>'{coupon,discount}'='10000'
  then 1 else 0 end as selected_coupon_minimum_pg_cap_recalculated_with_region_fee;
select public.clear_cart_coupon();
reset role;
update public.fulfillment_origins set base_fee=3000 where id='00000000-0000-4000-8000-000000049310';

-- Both payment modes ultimately use the address stored in the same order.
set local role service_role;
select pg_temp.region_expect_error($sql$select public.place_order_with_store_credits('00000000-0000-4000-8000-000000049303',
 '{"recipientName":"합성 지역 구매자","phone":"01012345678","postalCode":"10021","address1":"합성시"}',
 '30000000-0000-4000-8000-000000049300','card',0)$sql$,'shipping_region_unavailable','23514');
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000049303',
 '{"recipientName":"합성 지역 구매자","phone":"01012345678","postalCode":"10000","address1":"합성시 검증구 검증로 1"}',
 '30000000-0000-4000-8000-000000049301','card',0) as region_order \gset
reset role;
select 1/case when (select shipping_fee=5500 and total=15500 and shipping_fee_breakdown#>>'{0,regionalFee}'='2500'
  from public.orders where id=:'region_order') and (select count(*)=1 and bool_and(shipping_fee=5500
    and shipping_fee_snapshot->>'policyId'=(:'region_active'::jsonb->>'id') and shipping_fee_snapshot->>'policyVersion'='1'
    and shipping_fee_snapshot->>'regionalFee'='2500' and shipping_fee_snapshot->>'destinationPostalCode'='10000')
  from public.order_shipments where order_id=:'region_order') then 1 else 0 end as order_and_shipment_freeze_region_amount_version_and_matching_basis;
select 1/case when private.order_shipment_records(:'region_order')#>>'{0,regionalShipping,regionalFee}'='2500'
  then 1 else 0 end as receipt_projection_reads_frozen_shipping;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049301',true);
set local role authenticated;
select public.admin_set_shipping_region_policy_status((:'region_active'::jsonb->>'id')::uuid,'retired',3,true);
reset role;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb)->>'checkoutAllowed'='false'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb)#>>'{groups,0,regionStatus}'='policy_unavailable'
  then 1 else 0 end as retirement_never_falls_back_to_legacy;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049301',true);
set local role authenticated;
select public.admin_save_shipping_region_policy((:'region_overlap'::jsonb->>'id')::uuid,
  jsonb_set(:'region_config'::jsonb,'{rules,0,amount}','6000'),1) as region_v2 \gset
select public.admin_set_shipping_region_policy_status((:'region_v2'::jsonb->>'id')::uuid,'active',2,true);
reset role;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-policy-a']),:'region_destination'::jsonb)->>'finalTotalFee'='9000'
  and (select shipping_fee=5500 from public.orders where id=:'region_order')
  and (select shipping_fee_snapshot->>'regionalFee'='2500' and shipping_fee_snapshot->>'policyVersion'='1' from public.order_shipments where order_id=:'region_order')
  then 1 else 0 end as policy_change_does_not_recalculate_historical_orders;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000049303',good_id,id,1
  from public.goods_variants where good_id='region-policy-a' and is_default;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000049303',
 '{"recipientName":"합성 지역 구매자","phone":"01012345678","postalCode":"10000","address1":"합성시 검증구 검증로 1"}',
 '30000000-0000-4000-8000-000000049302','bank_transfer',0) as region_bank_order \gset
reset role;
select 1/case when (select shipping_fee=9000 and total=19000 from public.orders where id=:'region_bank_order')
  and (select amount=19000 from public.payment_attempts where ref_id=:'region_bank_order') then 1 else 0 end as bank_transfer_uses_same_final_region_fee;

-- Contract-carrier mismatch blocks after adoption, including a free-only basket.
update public.fulfillment_origins set default_carrier='region_test' where id='00000000-0000-4000-8000-000000049310';
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-free-a']),:'region_destination'::jsonb)#>>'{groups,0,regionStatus}'='carrier_mismatch'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-free-a']),:'region_destination'::jsonb)->>'finalTotalFee' is null
  then 1 else 0 end as carrier_change_requires_matching_contract;
update public.fulfillment_origins set default_carrier='hanjin' where id='00000000-0000-4000-8000-000000049310';

-- Future adoption preserves today's legacy fee; [start,end) changes are exact.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049301',true);
set local role authenticated;
select public.admin_save_shipping_region_policy(null,:'region_config'::jsonb||jsonb_build_object(
  'originId','00000000-0000-4000-8000-000000049312','name','TEST-ONLY 미래 정책','startsAt',now()+interval '1 day',
  'endsAt',now()+interval '2 days','openEnded',false,'rules','[]'::jsonb,'noRulesConfirmed',true),null) as region_future \gset
select public.admin_set_shipping_region_policy_status((:'region_future'::jsonb->>'id')::uuid,'active',1,true);
reset role;
select 1/case when public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-future']),:'region_destination'::jsonb)#>>'{groups,0,regionMode}'='legacy_base_only'
  and public.quote_goods_shipping_for_address(pg_temp.region_items(array['region-future']),:'region_destination'::jsonb)->>'nextChangeAt' is not null
  then 1 else 0 end as future_adoption_keeps_legacy_until_its_start;
select private.apply_shipping_region_quote(public.quote_goods_shipping(pg_temp.region_items(array['region-future'])),
  '[{"origin_id":"00000000-0000-4000-8000-000000049312","good_id":"region-future","fee_type":"policy"}]',
  :'region_destination'::jsonb,(:'region_future'::jsonb->>'startsAt')::timestamptz) as region_at_start \gset
select private.apply_shipping_region_quote(public.quote_goods_shipping(pg_temp.region_items(array['region-future'])),
  '[{"origin_id":"00000000-0000-4000-8000-000000049312","good_id":"region-future","fee_type":"policy"}]',
  :'region_destination'::jsonb,(:'region_future'::jsonb->>'endsAt')::timestamptz) as region_at_end \gset
select 1/case when :'region_at_start'::jsonb#>>'{groups,0,regionStatus}'='standard'
  and :'region_at_end'::jsonb#>>'{groups,0,regionStatus}'='policy_unavailable' and :'region_at_end'::jsonb->>'checkoutAllowed'='false'
  then 1 else 0 end as exact_effective_and_expiry_boundaries;

-- Incomplete and overlapping rule sets are rejected at activation even when a
-- caller bypasses every UI check; changing the draft is still allowed.
set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_set(:'region_config'::jsonb,'{rules}',
  jsonb_build_array(:'region_rules'::jsonb->0,(:'region_rules'::jsonb->0)||'{"postalFrom":"10010","postalTo":"10020"}'::jsonb)),null) as region_bad \gset
select pg_temp.region_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,1,true)',
  :'region_bad'::jsonb->>'id','active'),'shipping_region_rules_overlap','23514');
select public.admin_save_shipping_region_policy((:'region_bad'::jsonb->>'id')::uuid,jsonb_set(:'region_config'::jsonb,'{rules,0,amount}','null'),1) as region_missing_rate \gset
select pg_temp.region_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,2,true)',
  :'region_missing_rate'::jsonb->>'id','active'),'shipping_region_policy_incomplete','23514');
select public.admin_save_shipping_region_policy((:'region_bad'::jsonb->>'id')::uuid,
  jsonb_set(:'region_config'::jsonb,'{chargeFreeGoods}','null'),2);
select pg_temp.region_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,3,true)',
  :'region_missing_rate'::jsonb->>'id','active'),'shipping_region_policy_incomplete','23514');
reset role;
select 1/case when exists(select 1 from public.audit_log where action='admin.shipping_region.active'
  and diff#>>'{after,sourceEvidence}'='TEST-ONLY:carrier-reply-not-real')
  and exists(select 1 from public.audit_log where action='admin.shipping_region.retired')
  then 1 else 0 end as activation_and_retirement_have_source_bound_audit_records;
rollback;
