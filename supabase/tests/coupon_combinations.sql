\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7160854-0000-4000-8000-000000000001','authenticated','authenticated','coupon-combination-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('c7160854-0000-4000-8000-000000000002','authenticated','authenticated','coupon-combination-check-buyer@example.test',now(),'{}','{}',now(),now()),
 ('c7160854-0000-4000-8000-000000000003','authenticated','authenticated','coupon-combination-check-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 전달 방식 회귀 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='c7160854-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('c7160854-0000-4000-8000-000000000001','c7160854-0000-4000-8000-000000000002','c7160854-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('c7160854-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('coupon-combination-check-ip','TEST 전달 방식 회귀 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c7160854-0000-4000-8000-000000000010','coupon-combination-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('coupon-combination-check-a','coupon-combination-check-ip','TEST 상품 A','문구',10000,'ok',100,'c7160854-0000-4000-8000-000000000010','policy',0),
 ('coupon-combination-check-b','coupon-combination-check-ip','TEST 상품 B','문구',5000,'ok',100,'c7160854-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='coupon-combination-check-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='coupon-combination-check-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='coupon-combination-check-ip';
select id as variant_a from public.goods_variants where good_id='coupon-combination-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='coupon-combination-check-b' and is_default \gset

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('c7160854-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('c7160854-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.coupon_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c7160854-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c7160854-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c7160854-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.production_values(days integer default 5) returns jsonb language sql as $$select jsonb_build_object('enabled',true,'leadDays',days,'dayBasis','calendar','closedDates','[]'::jsonb,'publicNote','TEST 결제 확인 후 제작','evidence','TEST 명시적 납기 설정','confirmed',true);$$;
select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','c7160854-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST 제작 기본운임',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST production regional policy','unlistedDisposition','standard','feeUnit','per_shipment',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',true,'rules','[]'::jsonb),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
select jsonb_build_object('state','active','contactName','TEST 전달 담당','contactPhone','01000000000','handoffLocation','TEST 합성 수령 장소',
 'handoffInstructions','TEST 실제 전달 안내','appointmentInstructions','TEST 일정 확인','allowDelegate',false,'completionInstructions','TEST 일회 코드 확인',
 'cancellationInstructions','TEST 요청 접수 후 검토','approvalReference','TEST 이행 조건 확인') as method_policy \gset
select public.admin_save_delivery_policy('c7160854-0000-4000-8000-000000000010',method,null,:'method_policy',null) from unnest(array['quick','pickup','direct','freight','none'])method;
create function pg_temp.fulfillment_values(mode text,methods jsonb,files jsonb default '[]') returns jsonb language sql as $$select jsonb_build_object('mode',mode,'methods',methods,'assetIds',files,'publicNote','TEST 전달 계약 안내','evidence','TEST 명시적 선결제 비용 설정','confirmed',true);$$;
select '[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":1200},{"method":"quick","feeAmount":5000,"feeBasis":"per_order","installationFee":1200},{"method":"direct","feeAmount":2000,"feeBasis":"per_item","installationFee":500},{"method":"freight","feeAmount":8000,"feeBasis":"per_order","installationFee":500},{"method":"pickup","feeAmount":0,"feeBasis":"per_order","installationFee":0}]' as methods \gset
select public.admin_save_goods_fulfillment('coupon-combination-check-a',pg_temp.fulfillment_values('shipping',:'methods'),0,'c7160854-0000-4002-8000-000000000001','c7160854-0000-4000-8000-000000000001','c7160854-0000-4000-9000-000000000001') as saved \gset
select 1/case when public.admin_save_goods_fulfillment('coupon-combination-check-a',pg_temp.fulfillment_values('shipping',:'methods'),0,'c7160854-0000-4002-8000-000000000001','c7160854-0000-4000-8000-000000000001','c7160854-0000-4000-9000-000000000001')=:'saved'::jsonb then 1 else 0 end as settings_idempotent;
reset role;select pg_temp.coupon_actor(2);set local role authenticated;
select public.set_cart_item_quantity('coupon-combination-check-a',:'variant_a',2);
select public.set_cart_item_quantity('coupon-combination-check-b',:'variant_b',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart from public.cart_items where user_id='c7160854-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 전달 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
reset role;
insert into public.coupons(code,name,discount_type,discount_value,starts_at,issued_count,benefit_kind,stackable) values
 ('COMBO-GOODS-3000','TEST 상품 3000','fixed',3000,now()-interval '1 day',1,'goods',true),
 ('COMBO-GOODS-10','TEST 상품 10%','percent',10,now()-interval '1 day',1,'goods',true),
 ('COMBO-SHIPPING-50','TEST 배송비 50%','percent',50,now()-interval '1 day',1,'shipping',true),
 ('COMBO-SHIPPING-100','TEST 배송비 전액','percent',100,now()-interval '1 day',1,'shipping',true),
 ('COMBO-EXCLUSIVE','TEST 단독 상품','fixed',1000,now()-interval '1 day',1,'goods',false);
insert into public.user_coupons(id,coupon_code,user_id,issued_source,usable_from)
 select ('c7160854-0000-4008-8000-'||lpad(n::text,12,'0'))::uuid,code,'c7160854-0000-4000-8000-000000000002','admin_grant',now()-interval '1 day'
 from (values(1,'COMBO-GOODS-3000'),(2,'COMBO-GOODS-10'),(3,'COMBO-SHIPPING-50'),(4,'COMBO-SHIPPING-100'),(5,'COMBO-EXCLUSIVE'))c(n,code);
select array['c7160854-0000-4008-8000-000000000001','c7160854-0000-4008-8000-000000000002','c7160854-0000-4008-8000-000000000003']::uuid[] as coupon_ids \gset
select '{"coupon-combination-check-a":{"method":"quick","paymentMode":"prepaid"}}' as choices \gset
set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',:'coupon_ids',0) as off_quote \gset
select 1/case when :'off_quote'::jsonb#>>'{issues,0,code}'='coupon_unavailable' then 1 else 0 end as default_off;
reset role;select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_coupon_combination_policy('{"stackingEnabled":true,"maxGoodsCoupons":3,"shippingEnabled":true,"evidence":"TEST 정책 활성","confirmed":true}',1,'c7160854-0000-4009-8000-000000000001','c7160854-0000-4000-8000-000000000001','c7160854-0000-4000-9000-000000000001') as policy \gset
select 1/case when public.admin_save_coupon_combination_policy('{"stackingEnabled":true,"maxGoodsCoupons":3,"shippingEnabled":true,"evidence":"TEST 정책 활성","confirmed":true}',1,'c7160854-0000-4009-8000-000000000001','c7160854-0000-4000-8000-000000000001','c7160854-0000-4000-9000-000000000001')=:'policy'::jsonb then 1 else 0 end as policy_replay;
reset role;set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',:'coupon_ids',0) as combined_quote \gset
select 1/case when :'combined_quote'::jsonb#>>'{display,totals,couponDiscountTotal}'='5200'
 and :'combined_quote'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='3500'
 and :'combined_quote'::jsonb#>>'{display,totals,prepaidShippingTotal}'='5900'
 and :'combined_quote'::jsonb#>>'{display,totals,onlineTotal}'='25700'
 and jsonb_array_length(:'combined_quote'::jsonb#>'{display,coupons}')=3 then 1 else 0 end as exact_ordered_goods_then_shipping;
reset role;
-- A changed global policy invalidates the quote even if its numeric result would be identical.
savepoint changed_policy;
update private.coupon_combination_policy set revision=revision+1;
set local role service_role;
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)','c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'combined_quote'::jsonb->>'quoteId'),gen_random_uuid(),'card'),'transaction_quote_changed');
reset role;rollback to changed_policy;set local role service_role;
select public.place_cart_goods_transaction('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'combined_quote'::jsonb->>'quoteId')::uuid,'c7160854-0000-4002-8000-000000000010','card') as combined_order \gset
select 1/case when public.place_cart_goods_transaction('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'combined_quote'::jsonb->>'quoteId')::uuid,'c7160854-0000-4002-8000-000000000010','card')=:'combined_order'::uuid then 1 else 0 end as order_replay;
reset role;
select 1/case when private.goods_transaction_snapshot_matches(:'combined_order',25700,5900)
 and (select count(*) from public.coupon_redemptions where order_id=:'combined_order' and status='applied')=3
 and (select sum(installation_fee) from private.shipping_charge_components where order_id=:'combined_order')=2400
 and (select sum(shipping_coupon_discount) from private.shipping_charge_components where order_id=:'combined_order')=3500 then 1 else 0 end as conserved_immutable_ledgers;
select pg_temp.transaction_expect_error('update public.coupons set benefit_kind=''shipping'' where code=''COMBO-GOODS-3000''','coupon_issued_benefit_immutable');
select 'COUPON_CONTRACT:'||jsonb_build_object('quote',:'combined_quote'::jsonb,'receipt',(select original_receipt from private.order_goods_transactions where order_id=:'combined_order'),'shipping',(select shipping_fee_breakdown from public.orders where id=:'combined_order'))::text;
savepoint retained_coupon_money;
update private.account_deletion_control set transaction_lookup_hmac_ready=true,legacy_transaction_evidence_ready=true,
 immutable_ticket_contract_ready=true,community_legal_records_ready=true,phase_one_enabled=true;
select pg_temp.coupon_actor(2);set local role authenticated;
select public.request_my_account_deletion('회원 탈퇴를 신청합니다','c7160854-0000-4009-8000-000000000099');
reset role;
select 1/case when exists(select 1 from private.account_deletion_legal_snapshots s
 where s.record_type='order' and s.record_ref=:'combined_order'
  and s.snapshot_data->>'shippingCouponDiscount'='3500'
  and s.snapshot_data->>'shippingFee'='5900'
  and jsonb_array_length(s.snapshot_data->'couponApplications')=3
  and (select sum((c->>'discountAmount')::bigint)=8700 from jsonb_array_elements(s.snapshot_data->'couponApplications')c)
  and (select sum((c->>'installationFee')::bigint)=2400 and sum((c->>'shippingCouponDiscount')::bigint)=3500
   and bool_and((c->>'baseFee')::bigint+(c->>'regionalFee')::bigint+(c->>'installationFee')::bigint-(c->>'shippingCouponDiscount')::bigint=(c->>'totalFee')::bigint)
   from jsonb_array_elements(s.snapshot_data->'shippingCharges')c)
  and s.snapshot_data::text!~'(TEST 전달 구매자|01000000000|TEST 합성 주소|sessionId|evidence|userCouponId)')
 then 1 else 0 end as erased_account_keeps_exact_coupon_and_installation_amounts_without_pii;
rollback to retained_coupon_money;
update public.orders set status='canceled' where id=:'combined_order';
select 1/case when (select count(*) from public.coupon_redemptions where order_id=:'combined_order' and status='released')=3
 and (select count(*) from public.user_coupons where id=any(:'coupon_ids'::uuid[]) and status='active' and used_at is null)=3 then 1 else 0 end as all_coupons_restored_once;
select pg_temp.coupon_actor(2);set local role authenticated;
select public.set_cart_item_quantity('coupon-combination-check-a',:'variant_a',2);
select public.set_cart_item_quantity('coupon-combination-check-b',:'variant_b',1);
select pg_temp.transaction_expect_error('select public.apply_cart_coupon(''c7160854-0000-4008-8000-000000000003'')','coupon_checkout_required');
reset role;set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',array['c7160854-0000-4008-8000-000000000004']::uuid[],0) as full_shipping \gset
select 1/case when :'full_shipping'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='7000' and :'full_shipping'::jsonb#>>'{display,totals,prepaidShippingTotal}'='2400' then 1 else 0 end as installation_excluded_from_shipping_coupon;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',array['c7160854-0000-4008-8000-000000000005','c7160854-0000-4008-8000-000000000002']::uuid[],0) as exclusive \gset
select 1/case when :'exclusive'::jsonb#>>'{issues,0,code}'='coupon_unavailable' then 1 else 0 end as exclusive_coupon_cannot_stack;
reset role;
-- Both first-purchase coupons share one reservation for the same order.
savepoint first_purchase_combined;
update public.coupons set recipient_segment='first_purchase' where code in('COMBO-GOODS-3000','COMBO-GOODS-10');
set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',array['c7160854-0000-4008-8000-000000000001','c7160854-0000-4008-8000-000000000002']::uuid[],0) as first_quote \gset
select public.place_cart_goods_transaction('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'first_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as first_order \gset
reset role;
select 1/case when (select count(*) from private.coupon_first_purchase_claims where order_id=:'first_order')=1 and (select count(*) from public.coupon_redemptions where order_id=:'first_order')=2 then 1 else 0 end as one_first_purchase_reservation_for_combination;
rollback to first_purchase_combined;
-- Minimum goods subtotal is independent from preceding coupons; transport scope is tied to the selected group's goods.
savepoint targeted_shipping;
update public.coupons set goods_scope='selected_goods',target_good_ids=array['coupon-combination-check-a'],min_subtotal=20000 where code='COMBO-SHIPPING-100';
set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',array['c7160854-0000-4008-8000-000000000001','c7160854-0000-4008-8000-000000000004']::uuid[],0) as targeted \gset
select 1/case when :'targeted'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='5000' and :'targeted'::jsonb#>>'{display,totals,onlineTotal}'='26400' then 1 else 0 end as targeted_shipping_and_original_minimum;
reset role;rollback to targeted_shipping;
reset role;
savepoint coupon_credit;
select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_store_credit_policy('c7160854-0000-4005-8000-000000000023',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY coupon combination"}');
select public.admin_adjust_store_credit('c7160854-0000-4005-8000-000000000024','c7160854-0000-4000-8000-000000000002',10000,now()+interval '1 day','TEST 쿠폰 조합 지급',0);
reset role;set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',:'choices',:'coupon_ids',1000) as credit_quote \gset
select 1/case when :'credit_quote'::jsonb#>>'{display,totals,onlineTotal}'='24700' then 1 else 0 end as credits_after_all_coupons;
select public.place_cart_goods_transaction('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'credit_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as credit_order \gset
reset role;
select 1/case when private.goods_transaction_snapshot_matches(:'credit_order',24700,5900) and (select sum(available_amount) from private.store_credit_lots where user_id='c7160854-0000-4000-8000-000000000002')=9000 then 1 else 0 end as credits_reserved_once;
update public.orders set status='canceled' where id=:'credit_order';
select 1/case when (select sum(available_amount) from private.store_credit_lots where user_id='c7160854-0000-4000-8000-000000000002')=10000 and private.goods_transaction_snapshot_matches(:'credit_order',24700,5900) then 1 else 0 end as original_snapshot_and_credits_restored;
rollback to coupon_credit;
savepoint collect_coupon;
select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_shipping_collect_contract('c7160854-0000-4000-8000-000000000010',0,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',gen_random_uuid(),'c7160854-0000-4000-8000-000000000001');
select public.admin_save_good_transaction_terms('coupon-combination-check-a',0,(select updated_at from public.goods where id='coupon-combination-check-a'),null,
 '{"status":"active","paymentMode":"collect","quantityTerms":null,"draftValues":{}}',gen_random_uuid(),'c7160854-0000-4000-8000-000000000001');
reset role;set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'expected_cart',:'address','{"coupon-combination-check-a":{"method":"parcel","paymentMode":"collect"}}',:'coupon_ids',0) as collect_quote \gset
select 1/case when :'collect_quote'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='1000' and :'collect_quote'::jsonb#>>'{display,totals,collectShippingTotal}'='3000' and :'collect_quote'::jsonb#>>'{display,totals,onlineTotal}'='23200' then 1 else 0 end as collect_transport_excluded;
reset role;rollback to collect_coupon;
savepoint minimum_payment;
update public.coupons set discount_value=50000 where code='COMBO-GOODS-3000';
select pg_temp.coupon_actor(2);set local role authenticated;
select public.set_cart_item_quantity('coupon-combination-check-a',:'variant_a',0);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as small_cart from public.cart_items where user_id='c7160854-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160854-0000-4000-8000-000000000002',:'small_cart',:'address','{}',array['c7160854-0000-4008-8000-000000000001','c7160854-0000-4008-8000-000000000004']::uuid[],0) as minimum_quote \gset
select 1/case when :'minimum_quote'::jsonb#>>'{display,totals,couponDiscountTotal}'='5000' and :'minimum_quote'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='1000' and :'minimum_quote'::jsonb#>>'{display,totals,onlineTotal}'='1000' then 1 else 0 end as combined_minimum_payment_cap;
reset role;rollback to minimum_payment;
reset role;
select 1/case when not has_function_privilege('authenticated','public.quote_cart_goods_transaction_combined(uuid,jsonb,jsonb,jsonb,uuid[],bigint)','execute')
 and not has_table_privilege('authenticated','private.coupon_combination_policy','update') then 1 else 0 end as boundaries_sealed;
rollback;
