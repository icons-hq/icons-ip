-- Prepend KC helper and checkout fixture through its successful payment.
-- The fixture is intentionally still inside one rollback-only transaction.
reset role;
select id as shipment_id from public.order_shipments where order_id=:'order_id' \gset
select clock_timestamp() as collected_at \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000001',true);
select pg_temp.transaction_expect_error(format('select public.admin_record_shipping_collect_event(%L,%L,1,%L,%L,2249,%L,%L,NULL,%L,%L,%L)',
 :'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000080','collected',:'collected_at','TEST 운송사','TEST 참조','TEST 잘못된금액','bb140000-0000-4000-8000-000000000001'),'shipping_collect_amount_or_state');
select public.admin_record_shipping_collect_event(:'order_id',:'shipment_id',1,'bb140000-0000-4000-8000-000000000081','collected',2250,:'collected_at','TEST 운송사',null,
 'TEST-COLLECT-RECEIPT','TEST 외부 수납 확인','bb140000-0000-4000-8000-000000000001') as collect_receipt \gset
select 1/case when public.admin_record_shipping_collect_event(:'order_id',:'shipment_id',1,'bb140000-0000-4000-8000-000000000081','collected',2250,:'collected_at','TEST 운송사',null,
 'TEST-COLLECT-RECEIPT','TEST 외부 수납 확인','bb140000-0000-4000-8000-000000000001')=:'collect_receipt'::jsonb
 and public.admin_get_shipping_collect_event_operation('bb140000-0000-4000-8000-000000000081','bb140000-0000-4000-8000-000000000001')=:'collect_receipt'::jsonb
 then 1 else 0 end as assert_cod_operation_exact_replay;
select pg_temp.transaction_expect_error(format('select public.admin_record_shipping_collect_event(%L,%L,1,%L,%L,2250,%L,%L,NULL,%L,%L,%L)',
 :'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000081','collected',:'collected_at','TEST 운송사','OTHER REF','TEST 외부 수납 확인','bb140000-0000-4000-8000-000000000001'),'operation_conflict');
select pg_temp.transaction_expect_error(format('select public.admin_record_shipping_collect_event(%L,%L,1,%L,%L,2250,%L,%L,NULL,%L,%L,%L)',
 :'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000082','refund_review',:'collected_at','TEST 운송사','TEST REF','TEST 오래된revision','bb140000-0000-4000-8000-000000000001'),'shipping_collect_changed');
select 1/case when public.admin_get_order_shipping_collect(:'order_id')#>>'{0,state}'='collected'
 and public.admin_get_order_shipping_collect(:'order_id')::text not like '%contractReference%'
 then 1 else 0 end as assert_cod_readback_excludes_private_carrier_contract;
reset role;
select 1/case when (select amount=28650 from public.payments where ref_id=:'order_id')
 and (select total=28650 and shipping_collect_total=2250 from public.orders where id=:'order_id')
 and (select count(*)=1 from private.shipping_collect_events where shipment_id=:'shipment_id' and event='collected')
 then 1 else 0 end as assert_cod_does_not_change_online_payment;
-- A savepoint models delivery/settlement in the same approved fixture and then
-- restores the paid order for the independent full-refund scenario below.
savepoint finance_snapshot;
-- Explicit synthetic policy: production defaults to automatic confirmation off.
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=7,
 evidence='TEST ONLY: settled export regression' where singleton;
update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='0000141021107',shipped_at=clock_timestamp()-interval '10 days',delivered_at=clock_timestamp()-interval '9 days' where order_id=:'order_id';
update public.orders set status='delivered',delivered_at=clock_timestamp()-interval '9 days' where id=:'order_id';
set local role service_role;
select public.settle_delivered_orders();
reset role;
select 1/case when (select status='done' from public.orders where id=:'order_id') then 1 else 0 end as assert_finance_fixture_settled;
select private.collect_settled_export(null,null,:'order_id') as finance_snapshot \gset
select 1/case when :'finance_snapshot'::jsonb->>'schemaVersion'='2'
 and :'finance_snapshot'::jsonb#>>'{orders,0,calculationVersion}'='2'
 and :'finance_snapshot'::jsonb#>>'{orders,0,total}'='28650'
 and :'finance_snapshot'::jsonb#>>'{orders,0,volumeDiscount}'='3000'
 and :'finance_snapshot'::jsonb#>>'{orders,0,shippingCollectTotal}'='2250'
 and (select sum((item#>>'{allocation,volumeDiscount}')::bigint)=3000 from jsonb_array_elements(:'finance_snapshot'::jsonb#>'{orders,0,items}') item)
 and (select sum((component->>'totalFee')::bigint) filter(where component->>'paymentMode'='collect')=2250 from jsonb_array_elements(:'finance_snapshot'::jsonb#>'{orders,0,shippingComponents}') component)
 and private.collect_settled_export_for_date(null,null,:'order_id','ordered')->'orders'=:'finance_snapshot'::jsonb->'orders'
 and private.collect_settled_export_for_search(null,null,:'order_id','ordered','all')->'orders'=:'finance_snapshot'::jsonb->'orders'
 then 1 else 0 end as assert_all_settled_receipt_routes_preserve_v2_allocation;
set local role authenticated;
select 1/case when (select sum((item->>'revenue')::bigint)=26000 from jsonb_array_elements(public.admin_sales_goods_page(clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 hour',null,1,20)->'rows') item where item->>'goodId' like 'transaction-check-%')
 then 1 else 0 end as assert_sales_ranking_uses_net_before_coupon_credit;
reset role;
rollback to finance_snapshot;
set local role service_role;
select public.request_order_cancellation(:'order_id','bb140000-0000-4000-8000-000000000002','TEST 외부수납 주문 전액취소','change_of_mind');
reset role;
select id as cancellation_id from public.order_cancellation_requests where order_id=:'order_id' \gset
set local role service_role;
select public.complete_order_cancellation_request(:'cancellation_id',array['TEST-TRANSACTION-APPROVED'],'bb140000-0000-4000-8000-000000000001');
reset role;
select 1/case when (select state='refund_review' and revision=3 and amount=2250 from private.shipping_collect_obligations where shipment_id=:'shipment_id')
 then 1 else 0 end as assert_full_cancel_requires_external_cod_refund;
select clock_timestamp() as refund_at \gset
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_record_shipping_collect_event(%L,%L,3,%L,%L,0,%L,%L,NULL,%L,%L,%L)',
 :'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000083','void',:'refund_at','TEST 운송사','TEST REF','TEST 수납금액 소거금지','bb140000-0000-4000-8000-000000000001'),'shipping_collect_void_requires_uncollected_cancel');
select public.admin_record_shipping_collect_event(:'order_id',:'shipment_id',3,'bb140000-0000-4000-8000-000000000084','refunded',2250,:'refund_at','TEST 운송사',null,
 'TEST-EXTERNAL-FULL-REFUND','TEST 운송사 전액환급 확인','bb140000-0000-4000-8000-000000000001');
reset role;
select 1/case when (select state='refunded' and revision=4 from private.shipping_collect_obligations where shipment_id=:'shipment_id')
 and (select amount=28650 from public.payments where ref_id=:'order_id')
 and (select count(*)=1 from private.shipping_collect_events where shipment_id=:'shipment_id' and event='refunded')
 and not has_function_privilege('service_role','public.admin_record_shipping_collect_event(uuid,uuid,integer,uuid,text,bigint,timestamptz,text,uuid,text,text,uuid)','execute')
 and not has_function_privilege('authenticated','private.shipping_collect_document(uuid)','execute')
 then 1 else 0 end as assert_cod_refund_separate_ledger_and_acl;
set local role authenticated;
select public.admin_record_shipping_collect_event(:'order_id',:'shipment_id',4,'bb140000-0000-4000-8000-000000000085','correction',2250,:'refund_at',
 'TEST 운송사','bb140000-0000-4000-8000-000000000084','TEST-REFUND-CORRECTION','TEST 환급 확인 오류 정정','bb140000-0000-4000-8000-000000000001');
select 1/case when public.admin_get_order_shipping_collect(:'order_id')#>>'{0,state}'='refund_review'
 and public.admin_get_order_shipping_collect(:'order_id')#>>'{0,events,4,reversesOperationId}'='bb140000-0000-4000-8000-000000000084'
 then 1 else 0 end as assert_terminal_correction_is_append_only_and_reopens_review;
select pg_temp.transaction_expect_error(format('select public.admin_record_shipping_collect_event(%L,%L,5,%L,%L,2250,%L,%L,%L,%L,%L,%L)',
 :'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000086','correction',:'refund_at','TEST 운송사','bb140000-0000-4000-8000-000000000084','TEST REF','TEST 중복 정정 금지','bb140000-0000-4000-8000-000000000001'),'shipping_collect_correction_requires_latest');
select public.admin_record_shipping_collect_event(:'order_id',:'shipment_id',5,'bb140000-0000-4000-8000-000000000087','refunded',2250,:'refund_at',
 'TEST 운송사',null,'TEST-CORRECT-REFUND','TEST 올바른 환급 증빙','bb140000-0000-4000-8000-000000000001');
reset role;
select 1/case when (select state='refunded' and revision=6 from private.shipping_collect_obligations where shipment_id=:'shipment_id')
 and (select count(*)=6 from private.shipping_collect_events where shipment_id=:'shipment_id')
 and (select total=28650 and shipping_collect_total=2250 from public.orders where id=:'order_id') then 1 else 0 end as assert_correction_keeps_original_money_and_history;
set local role authenticated;
select 1/case when public.admin_seal_shipping_collect_operation(:'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000088','bb140000-0000-4000-8000-000000000001')->>'state'='sealed'
 and public.admin_seal_shipping_collect_operation(:'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000088','bb140000-0000-4000-8000-000000000001')->>'state'='sealed'
 and public.admin_seal_shipping_collect_operation(:'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000087','bb140000-0000-4000-8000-000000000001')->>'state'='recorded'
 then 1 else 0 end as assert_seal_idempotent_and_never_hides_committed_receipt;
select pg_temp.transaction_expect_error(format('select public.admin_record_shipping_collect_event(%L,%L,6,%L,%L,2250,%L,%L,NULL,%L,%L,%L)',
 :'order_id',:'shipment_id','bb140000-0000-4000-8000-000000000088','collected',:'refund_at','TEST 운송사','TEST REF','TEST 늦은 요청 거절','bb140000-0000-4000-8000-000000000001'),'operation_conflict');
set local role authenticated;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000002',true);
select pg_temp.transaction_expect_error(format('select public.admin_get_order_shipping_collect(%L)',:'order_id'),'operator_capability_required');
reset role;
-- Base shipping savings must honor repeat quantity terms before any address.
select 1/case when public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','transaction-check-a','variantId',:'variant_a','qty',3)))#>>'{totalFee}'='6000'
 and public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','transaction-check-a','variantId',:'variant_a','qty',1),jsonb_build_object('goodId','transaction-check-a','variantId',:'variant_a','qty',2)))#>>'{totalFee}'='6000'
 then 1 else 0 end as assert_address_free_quantity_quote_line_split_invariance;
rollback;
