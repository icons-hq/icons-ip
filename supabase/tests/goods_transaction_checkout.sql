\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bb140000-0000-4000-8000-000000000001','authenticated','authenticated','transaction-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('bb140000-0000-4000-8000-000000000002','authenticated','authenticated','transaction-check-buyer@example.test',now(),'{}','{}',now(),now()),
 ('bb140000-0000-4000-8000-000000000003','authenticated','authenticated','transaction-check-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 거래 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bb140000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bb140000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('bb140000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('transaction-check-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bb140000-0000-4000-8000-000000000010','transaction-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('transaction-check-a','transaction-check-ip','TEST 상품 A','문구',10000,'ok',100,'bb140000-0000-4000-8000-000000000010','policy',0),
 ('transaction-check-b','transaction-check-ip','TEST 상품 B','문구',5000,'ok',100,'bb140000-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='transaction-check-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='transaction-check-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='transaction-check-ip';
select id as variant_a from public.goods_variants where good_id='transaction-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='transaction-check-b' and is_default \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_price_period('transaction-check-a',:'variant_a',null,
 jsonb_build_object('state','active','discountPrice',8000,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'),null);
select public.admin_save_shipping_collect_contract('bb140000-0000-4000-8000-000000000010',0,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',
 'bb140000-0000-4000-8000-000000000020','bb140000-0000-4000-8000-000000000001');
select public.admin_save_good_transaction_terms('transaction-check-a',0,(select updated_at from public.goods where id='transaction-check-a'),
 '{"status":"active","terms":{"condition":"quantity","threshold":3,"discountKind":"fixed","discountValue":1000,"startsAt":null,"endsAt":null},"draftValues":{}}',
 '{"status":"active","paymentMode":"prepaid","quantityTerms":{"kind":"repeat","baseFee":3000,"interval":2},"draftValues":{}}',
 'bb140000-0000-4000-8000-000000000021','bb140000-0000-4000-8000-000000000001');
select public.admin_save_good_transaction_terms('transaction-check-b',0,(select updated_at from public.goods where id='transaction-check-b'),null,
 '{"status":"active","paymentMode":"collect","quantityTerms":null,"draftValues":{}}','bb140000-0000-4000-8000-000000000022','bb140000-0000-4000-8000-000000000001');
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','bb140000-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST 지역비',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST-ONLY: transaction region','unlistedDisposition','standard','feeUnit','per_shipment',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',false,
 'rules',jsonb_build_array(jsonb_build_object('id',null,'postalFrom','12345','postalTo','12345','addressPrefix','','regionLabel','TEST 지역','disposition','surcharge','amount',1000))),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
select public.admin_save_store_credit_policy('bb140000-0000-4000-8000-000000000023',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST-ONLY transaction policy"}');
select public.admin_adjust_store_credit('bb140000-0000-4000-8000-000000000024','bb140000-0000-4000-8000-000000000002',10000,now()+interval '1 day','TEST 지급',0);
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,goods_scope,target_good_ids)
 values('TRANSACTION10P','TEST 순액10%','percent',10,0,now()-interval '1 day','active','selected_goods',array['transaction-check-a']);
set local role authenticated;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000002',true);
select pg_temp.transaction_expect_error(format('insert into public.cart_items(user_id,good_id,variant_id,qty) values(%L,%L,%L,1)',
 'bb140000-0000-4000-8000-000000000002','transaction-check-a',:'variant_a'),'permission denied');
select pg_temp.transaction_expect_error('update public.cart_items set qty=1','permission denied');
select pg_temp.transaction_expect_error('delete from public.cart_items','permission denied');
select public.set_cart_item_quantity('transaction-check-a',:'variant_a',3);
select public.set_cart_item_quantity('transaction-check-b',:'variant_b',1);
select public.apply_cart_coupon_code('TRANSACTION10P') as held_coupon \gset
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart
 from public.cart_items where user_id='bb140000-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
select pg_temp.transaction_expect_error(format('select public.place_order(%L::jsonb,%L::uuid,%L::public.order_payment_method)',:'address','bb140000-0000-4000-8000-000000000030','card'),'checkout_contract_upgrade_required');
reset role;
set local role service_role;
select public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',null,'{}',:'held_coupon',2000) as blocked \gset
select 1/case when :'blocked'::jsonb->>'state'='blocked' and not :'blocked'::jsonb ? 'quoteId' then 1 else 0 end as assert_address_not_zero_fee;
select public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'held_coupon',2000) as quote \gset
select 1/case when :'quote'::jsonb->>'state'='quoted' and :'quote'::jsonb#>'{display,totals}'=
 '{"subtotal":29000,"volumeDiscountTotal":3000,"netGoodsTotal":26000,"couponDiscountTotal":2100,"storeCreditTotal":2000,"prepaidShippingTotal":6750,"collectShippingTotal":2250,"onlineTotal":28650,"customerTotal":30900}'::jsonb
 then 1 else 0 end as assert_full_independent_example_quote;
reset role;
update private.goods_transaction_runtime set enabled=false where singleton;
set local role service_role;
select pg_temp.transaction_expect_error(format('select public.quote_cart_goods_transaction(%L,%L,%L,%L,%L,2000)',
 'bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'held_coupon'),'transaction_runtime_disabled');
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)',
 'bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId'),'bb140000-0000-4000-8000-000000000031','card'),'transaction_runtime_disabled');
select pg_temp.transaction_expect_error(format('select public.resume_cart_goods_transaction(%L,%L,%L,%L,true)',
 'bb140000-0000-4000-8000-000000000002',(:'quote'::jsonb->>'quoteId'),'bb140000-0000-4000-8000-000000000031','card'),'transaction_runtime_disabled');
reset role;
select 1/case when not exists(select 1 from public.orders where user_id='bb140000-0000-4000-8000-000000000002')
 and (select count(*)=1 from private.goods_transaction_quotes where actor_id='bb140000-0000-4000-8000-000000000002')
 and (select count(*)=2 from public.cart_items where user_id='bb140000-0000-4000-8000-000000000002')
 and (select stock_qty=100 from public.goods_variants where id=:'variant_a')
 and not exists(select 1 from public.coupon_redemptions where user_coupon_id=:'held_coupon')
 and not exists(select 1 from private.store_credit_allocations where user_id='bb140000-0000-4000-8000-000000000002') then 1 else 0 end as assert_runtime_off_direct_rpc_atomicity;
update private.goods_transaction_runtime set enabled=true where singleton;
update public.goods set sale_starts_at=clock_timestamp()-interval '2 hours',sale_ends_at=clock_timestamp()-interval '1 hour' where id='transaction-check-a';
set local role service_role;
select 1/case when public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'held_coupon',2000)
 #>>'{issues,0,code}'='goods_unavailable' then 1 else 0 end as assert_ended_sale_quote_blocked;
reset role;
update public.goods set sale_starts_at=null,sale_ends_at=null where id='transaction-check-a';
set local role authenticated;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000001',true);
select public.admin_register_purchase_restriction('bb140000-0000-4000-8000-000000000070','bb140000-0000-4000-8000-000000000002','other','TEST 견적구매제한',null);
reset role;
set local role service_role;
select 1/case when public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'held_coupon',2000)
 #>>'{issues,0,code}'='purchase_restricted' then 1 else 0 end as assert_purchase_restricted_quote_blocked;
reset role;
set local role authenticated;
select public.admin_release_purchase_restriction('bb140000-0000-4000-8000-000000000070','TEST 견적구매제한해제');
reset role;
set local role service_role;
-- The deliberate sale-period edits above changed its immutable revision.
select public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',:'held_coupon',2000) as quote \gset
select public.place_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,
 'bb140000-0000-4000-8000-000000000031','card') as order_id \gset
select public.place_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,
 'bb140000-0000-4000-8000-000000000031','card') as replay_id \gset
reset role;
select 1/case when :'order_id'=:'replay_id' and (select calculation_version=2 and total=28650 and volume_discount_total=3000 and discount_total=2100
 and store_credit_total=2000 and shipping_fee=6750 and shipping_collect_total=2250 from public.orders where id=:'order_id')
 and not exists(select 1 from public.cart_items where user_id='bb140000-0000-4000-8000-000000000002')
 and (select count(*)=1 and min(shipping_fee)=6750 and min(shipping_collect_fee)=2250 from public.order_shipments where order_id=:'order_id')
 and private.goods_order_snapshot_matches(:'order_id',28650,6750)
 then 1 else 0 end as assert_order_receipt_cart_consumption_one_physical_shipment;
select 1/case when (select sum(volume_discount)=3000 and sum(coupon_discount)=2100 and sum(store_credit_discount)=2000 and sum(paid_goods_total)=21900
 from private.order_price_allocations where order_id=:'order_id')
 and (select state='planned' and amount=2250 from private.shipping_collect_obligations where order_id=:'order_id')
 and (select count(*)=1 from private.store_credit_allocations where order_id=:'order_id') then 1 else 0 end as assert_private_amount_allocations;
-- PII quote cleanup cannot destroy a completed checkout's immutable receipt.
delete from private.goods_transaction_quotes where id=(:'quote'::jsonb->>'quoteId')::uuid;
update private.goods_transaction_runtime set enabled=false where singleton;
set local role service_role;
select 1/case when public.place_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,
 'bb140000-0000-4000-8000-000000000031','card')=:'order_id'::uuid then 1 else 0 end as assert_success_replay_after_quote_pii_cleanup;
select 1/case when public.resume_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',(:'quote'::jsonb->>'quoteId')::uuid,
 'bb140000-0000-4000-8000-000000000031','card',false)=:'order_id'::uuid then 1 else 0 end as assert_metadata_only_resume_when_new_payment_disabled;
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)',
 'bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId'),'bb140000-0000-4000-8000-000000000031','bank_transfer'),'checkout_key_conflict');
select public.prepare_goods_payment_attempt('bb140000-0000-4000-8000-000000000002',:'order_id','toss')->>'id' as attempt_id \gset
select public.bind_goods_payment_callback_nonce(:'attempt_id',repeat('d',64));
reset role;
select provider_order_id from public.payment_attempts where id=:'attempt_id' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_order_id',repeat('d',64),'bb140000-0000-4000-8000-000000000032');
select 1/case when public.finalize_goods_payment_attempt(:'attempt_id','bb140000-0000-4000-8000-000000000032','approved',null,'TEST-TRANSACTION-APPROVED')='approved' then 1 else 0 end as assert_existing_provider_finalizer_accepts_v2_snapshot;
select public.finalize_goods_payment_attempt(:'attempt_id','bb140000-0000-4000-8000-000000000032','approved');
select public.request_order_cancellation(:'order_id','bb140000-0000-4000-8000-000000000002','TEST 전액 취소','change_of_mind');
reset role;
select id as cancellation_id from public.order_cancellation_requests where order_id=:'order_id' \gset
set local role service_role;
select public.complete_order_cancellation_request(:'cancellation_id',array['TEST-TRANSACTION-APPROVED'],'bb140000-0000-4000-8000-000000000001');
select public.complete_order_cancellation_request(:'cancellation_id',array['TEST-TRANSACTION-APPROVED'],'bb140000-0000-4000-8000-000000000001');
reset role;
select 1/case when (select status='canceled' from public.orders where id=:'order_id')
 and (select amount=28650 from public.payments where ref_id=:'order_id')
 and (select state='void' and amount=2250 from private.shipping_collect_obligations where order_id=:'order_id')
 and (select stock_qty=100 from public.goods_variants where id=:'variant_a')
 and (select stock_qty=100 from public.goods_variants where id=:'variant_b')
 and (select coalesce(sum(available_amount),0)=10000 from private.store_credit_lots where user_id='bb140000-0000-4000-8000-000000000002')
 then 1 else 0 end as assert_full_refund_online_only_supply_credit_once_collect_void;
set local role authenticated;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000002',true);
select 1/case when public.get_my_goods_transaction_receipt(:'order_id')#>>'{display,totals,onlineTotal}'='28650' then 1 else 0 end as assert_original_customer_receipt_survives_cancel;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000003',true);
select 1/case when public.get_my_goods_transaction_receipt(:'order_id') is null then 1 else 0 end as assert_receipt_other_actor_denied;
rollback;
