\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the same connection. Everything rolls back.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_delivery_error(statement text,expected_message text,expected_code text default null) returns void
language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
create temporary table delivery_fixture_codes(shipment_id uuid primary key,value text,previous text);
grant select,insert,update on delivery_fixture_codes to authenticated;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000049201','authenticated','authenticated','delivery-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000049202','authenticated','authenticated','delivery-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000049203','authenticated','authenticated','delivery-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000049204','authenticated','authenticated','delivery-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='배송관리9201' where id='00000000-0000-4000-8000-000000049201';
update public.profiles set role='staff',nickname='배송운영9202' where id='00000000-0000-4000-8000-000000049202';
update public.profiles set nickname='배송구매'||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000049203','00000000-0000-4000-8000-000000049204');
insert into public.verticals(key,label,color) values('delivery-method-tests','배송 방식 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('delivery-method-tests','배송 방식 검증','delivery-method-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 ('00000000-0000-4000-8000-000000049230','delivery-quick-tests','퀵 검증 출고지','hanjin',1000,null,'배송 금지 검증 주소 1',true),
 ('00000000-0000-4000-8000-000000049231','delivery-pickup-tests','방문 검증 출고지','hanjin',2000,null,'배송 금지 검증 주소 2',true),
 ('00000000-0000-4000-8000-000000049232','delivery-parcel-tests','택배 검증 출고지','hanjin',3000,null,'배송 금지 검증 주소 3',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id) values
 ('delivery-quick','delivery-method-tests','퀵 상품','문구',10000,'ok',5,null,'00000000-0000-4000-8000-000000049230'),
 ('delivery-pickup','delivery-method-tests','방문수령 상품','문구',10000,'ok',5,null,'00000000-0000-4000-8000-000000049231'),
 ('delivery-parcel','delivery-method-tests','택배 상품','문구',10000,'ok',5,null,'00000000-0000-4000-8000-000000049232'),
 ('delivery-preorder','delivery-method-tests','방문수령 예약 상품','문구',10000,'ok',0,null,'00000000-0000-4000-8000-000000049231');
select id as preorder_variant from public.goods_variants where good_id='delivery-preorder' and is_default \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049201',true);
select public.admin_save_goods_preorder('delivery-preorder',:'preorder_variant',null,jsonb_build_object('state','active','capacityQty',2,
 'startsAt',clock_timestamp()-interval '1 hour','endsAt',clock_timestamp()+interval '1 hour','expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,
 'approvalReference','TEST-ONLY delivery supply'));
select public.admin_save_delivery_policy('00000000-0000-4000-8000-000000049230','quick',null,'{"state":"draft"}',null)->>'id' as quick_policy \gset
select pg_temp.expect_delivery_error(format('select public.admin_save_delivery_policy(%L,%L,%L,%L::jsonb,1)',
 '00000000-0000-4000-8000-000000049230','quick',:'quick_policy','{"state":"active"}'),'delivery_policy_incomplete','23514');
select 1/case when public.admin_list_delivery_policies('00000000-0000-4000-8000-000000049230')#>'{0,allowDelegate}'='null'::jsonb
 and public.admin_list_delivery_policies('00000000-0000-4000-8000-000000049230')#>'{0,contactPhone}'='null'::jsonb
 then 1 else 0 end as assert_unconfigured_draft_has_no_operating_defaults;
select jsonb_build_object('state','active','contactName','합성 운영 담당','contactPhone','02-0000-0000','handoffLocation','TEST-ONLY 인계 장소',
 'handoffInstructions','TEST-ONLY 실제 인계 안내','appointmentInstructions','TEST-ONLY 예약 시각 안내','allowDelegate',false,
 'completionInstructions','TEST-ONLY 주문자 확인값과 수령 기록','cancellationInstructions','TEST-ONLY 발주확인 이후 CS 검토',
 'approvalReference','TEST-ONLY 운영 승인') as policy_values \gset
select public.admin_save_delivery_policy('00000000-0000-4000-8000-000000049230','quick',:'quick_policy',:'policy_values',1);
select public.admin_save_delivery_policy('00000000-0000-4000-8000-000000049231','pickup',null,:'policy_values',null)->>'id' as pickup_policy \gset
select pg_temp.expect_delivery_error(format('select public.admin_save_delivery_policy(%L,%L,%L,%L::jsonb,2)',
 '00000000-0000-4000-8000-000000049230','quick',:'quick_policy',(:'policy_values'::jsonb||'{"contactPhone":"02-1111"}'::jsonb)::text),'activated_delivery_policy_immutable','23514');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select pg_temp.expect_delivery_error(format('select public.admin_save_delivery_policy(%L,%L,%L,%L::jsonb,2)',
 '00000000-0000-4000-8000-000000049230','quick',:'quick_policy','{"state":"stopped"}'),'admin_required','42501');
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('delivery-quick','delivery-pickup','delivery-parcel','delivery-preorder');
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000049203',good_id,id,1 from public.goods_variants
 where good_id in ('delivery-quick','delivery-pickup','delivery-parcel','delivery-preorder') and is_default;
select public.place_order('00000000-0000-4000-8000-000000049203','{"recipientName":"합성 구매자","phone":"01000000000","postalCode":"00000","address1":"배송 금지 검증 주소"}',
 '00000000-0000-4000-8000-000000049220','card') as test_order \gset
-- Trusted fixture setup isolates fulfillment from the separately-tested provider protocol.
update public.orders set status='confirmed' where id=:'test_order';
select id as quick_shipment,updated_at as quick_version from public.order_shipments where order_id=:'test_order' and origin_id='00000000-0000-4000-8000-000000049230' \gset
select id as pickup_shipment,updated_at as pickup_version from public.order_shipments where order_id=:'test_order' and origin_id='00000000-0000-4000-8000-000000049231' \gset
select id as parcel_shipment from public.order_shipments where order_id=:'test_order' and origin_id='00000000-0000-4000-8000-000000049232' \gset
select id as preorder_item from public.order_items where order_id=:'test_order' and good_id='delivery-preorder' \gset
select jsonb_build_object('total',total,'shippingFee',shipping_fee,'breakdown',shipping_fee_breakdown,'coupon',discount_total,'credit',store_credit_total) as financial_snapshot
 from public.orders where id=:'test_order' \gset
select jsonb_agg(jsonb_build_object('id',id,'fee',shipping_fee,'snapshot',shipping_fee_snapshot) order by id) as shipment_fee_snapshot
 from public.order_shipments where order_id=:'test_order' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049203',true);
select pg_temp.expect_delivery_error(format('select public.admin_read_shipment_delivery(%L)',:'quick_shipment'),'staff_required','42501');
select pg_temp.expect_delivery_error($sql$select * from private.shipment_receipt_confirmations$sql$,'permission denied','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select public.admin_select_shipment_delivery_method(:'quick_shipment','quick',:'quick_policy','TEST-ONLY 고객 요청','TEST-ONLY 배송비 불변 동의',true,
 :'quick_version','00000000-0000-4000-8000-000000049240');
select 1/case when (public.admin_select_shipment_delivery_method(:'quick_shipment','quick',:'quick_policy','TEST-ONLY 고객 요청','TEST-ONLY 배송비 불변 동의',true,
 :'quick_version','00000000-0000-4000-8000-000000049240')->>'replayed')::boolean then 1 else 0 end as assert_selection_retry_is_one_record;
select pg_temp.expect_delivery_error(format('select public.admin_select_shipment_delivery_method(%L,%L,%L,%L,%L,true,%L,%L)',
 :'quick_shipment','quick',:'quick_policy','DIFFERENT REQUEST','TEST-ONLY 배송비 불변 동의',:'quick_version','00000000-0000-4000-8000-000000049240'),'delivery_operation_conflict','PT409');
select public.admin_select_shipment_delivery_method(:'pickup_shipment','pickup',:'pickup_policy','TEST-ONLY 방문 요청','TEST-ONLY 기존 배송비 동의',true,
 :'pickup_version','00000000-0000-4000-8000-000000049241');
select updated_at as quick_selected_version from public.order_shipments where id=:'quick_shipment' \gset
select updated_at as pickup_selected_version from public.order_shipments where id=:'pickup_shipment' \gset
select pg_temp.expect_delivery_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'quick_shipment','shipping','hanjin','1234567890'),'delivery_method_evidence_required','23514');
select pg_temp.expect_delivery_error(format('select public.admin_shipment_export(array[%L]::uuid[])',:'pickup_shipment'),'delivery_method_evidence_required','23514');
select pg_temp.expect_delivery_error(format('select public.admin_import_shipment_tracking(%L,%L,%L)',:'quick_shipment','hanjin','1234567890'),'delivery_method_evidence_required','23514');
select pg_temp.expect_delivery_error(format('select public.issue_shipment_receipt_confirmation(%L)',:'pickup_shipment'),'shipment_not_found','P0002');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049203',true);
insert into delivery_fixture_codes(shipment_id,value) values(:'pickup_shipment',public.issue_shipment_receipt_confirmation(:'pickup_shipment')->>'code');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049204',true);
select pg_temp.expect_delivery_error(format('select public.issue_shipment_receipt_confirmation(%L)',:'pickup_shipment'),'shipment_not_found','P0002');
reset role;
select 1/case when not has_table_privilege('authenticated','private.shipment_delivery_operations','SELECT')
 and not has_function_privilege('anon','public.issue_shipment_receipt_confirmation(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamptz,uuid)','EXECUTE')
 and not exists(select 1 from information_schema.columns where table_schema='private' and table_name='shipment_receipt_confirmations' and column_name in ('code','token','confirmation_code'))
 then 1 else 0 end as assert_receipt_value_has_no_client_table_or_plaintext_storage;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select jsonb_build_object('operatorName','합성 인계 담당','receiptReference','TEST-ONLY 수령 문서','recipientKind','self','occurredAt',clock_timestamp()) as pickup_evidence \gset
select pg_temp.expect_delivery_error(format('select public.admin_record_shipment_delivery(%L,%L,%L::jsonb,(select value from delivery_fixture_codes where shipment_id=%L),%L,%L)',
 :'pickup_shipment','pickup_receive',:'pickup_evidence',:'pickup_shipment',:'pickup_selected_version','00000000-0000-4000-8000-000000049242'),'preorder_allocation_required','23514');
select public.admin_adjust_stock('00000000-0000-4000-8000-000000049249','delivery-preorder',:'preorder_variant',0,1,'TEST-ONLY 실제 입고 기록');
select public.admin_allocate_goods_preorders('delivery-preorder',array[:'preorder_item']::uuid[],jsonb_build_object(:'preorder_variant',1),'TEST-ONLY 입고 할당');
select updated_at as pickup_allocated_version from public.order_shipments where id=:'pickup_shipment' \gset
select pg_temp.expect_delivery_error(format('select public.admin_record_shipment_delivery(%L,%L,%L::jsonb,(select value from delivery_fixture_codes where shipment_id=%L),%L,%L)',
 :'pickup_shipment','pickup_receive',(:'pickup_evidence'::jsonb||'{"recipientKind":"delegate"}')::text,:'pickup_shipment',:'pickup_allocated_version','00000000-0000-4000-8000-000000049242'),
 'delivery_delegate_not_allowed','23514');
-- A stopped policy blocks new selections; its recorded shipments still drain.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049201',true);
select public.admin_save_delivery_policy('00000000-0000-4000-8000-000000049231','pickup',:'pickup_policy','{"state":"stopped"}',1);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select public.admin_record_shipment_delivery(:'pickup_shipment','pickup_receive',:'pickup_evidence',
 (select value from delivery_fixture_codes where shipment_id=:'pickup_shipment'),:'pickup_allocated_version','00000000-0000-4000-8000-000000049242');
select 1/case when (public.admin_record_shipment_delivery(:'pickup_shipment','pickup_receive',:'pickup_evidence',
 (select value from delivery_fixture_codes where shipment_id=:'pickup_shipment'),:'pickup_allocated_version','00000000-0000-4000-8000-000000049242')->>'replayed')::boolean
 and (select status from public.orders where id=:'test_order')='shipping'
 and (select carrier is null and tracking_number is null and shipped_at=delivered_at from public.order_shipments where id=:'pickup_shipment')
 then 1 else 0 end as assert_pickup_once_and_partial_order_aggregate;
select jsonb_build_object('providerName','합성 실제 퀵 업체','providerPhone','010-0000-0000','handoffReference','TEST-ONLY 퀵 인계',
 'operatorName','합성 인계 담당','occurredAt',clock_timestamp()) as quick_evidence \gset
select public.admin_record_shipment_delivery(:'quick_shipment','quick_handoff',:'quick_evidence',null,:'quick_selected_version','00000000-0000-4000-8000-000000049243');
select updated_at as quick_in_transit_version from public.order_shipments where id=:'quick_shipment' \gset
select pg_temp.expect_delivery_error(format('select public.admin_enqueue_shipment_emails(%L::jsonb)',
 jsonb_build_array(jsonb_build_object('orderId',:'test_order','shipmentId',:'quick_shipment'))::text),'delivery_method_evidence_required','23514');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049203',true);
insert into delivery_fixture_codes(shipment_id,value) values(:'quick_shipment',public.issue_shipment_receipt_confirmation(:'quick_shipment')->>'code');
update delivery_fixture_codes set previous=value,value=public.issue_shipment_receipt_confirmation(:'quick_shipment')->>'code' where shipment_id=:'quick_shipment';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select jsonb_build_object('operatorName','합성 수령 확인 담당','receiptReference','TEST-ONLY 퀵 수령','recipientKind','self','occurredAt',clock_timestamp()) as quick_receipt \gset
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt',
 (select previous from delivery_fixture_codes where shipment_id=:'quick_shipment'),:'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'error'='delivery_receipt_code_invalid'
 then 1 else 0 end as assert_reissue_invalidates_previous_receipt_value;
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt','000000000000',
 :'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'ok'='false' then 1 else 0 end as assert_bad_receipt_2;
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt','000000000000',
 :'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'ok'='false' then 1 else 0 end as assert_bad_receipt_3;
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt','000000000000',
 :'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'ok'='false' then 1 else 0 end as assert_bad_receipt_4;
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt','000000000000',
 :'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'error'='delivery_receipt_code_unavailable' then 1 else 0 end as assert_receipt_attempt_limit;
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt',
 (select value from delivery_fixture_codes where shipment_id=:'quick_shipment'),:'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'error'='delivery_receipt_code_unavailable'
 then 1 else 0 end as assert_correct_value_cannot_bypass_exhausted_attempts;
reset role;
select 1/case when (select failed_attempts=5 and consumed_at is null from private.shipment_receipt_confirmations where shipment_id=:'quick_shipment')
 and (select status from public.order_shipments where id=:'quick_shipment')='shipping' then 1 else 0 end as assert_attempts_commit_without_fulfillment;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049203',true);
update delivery_fixture_codes set value=public.issue_shipment_receipt_confirmation(:'quick_shipment')->>'code' where shipment_id=:'quick_shipment';
reset role;
update private.shipment_receipt_confirmations set issued_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' where shipment_id=:'quick_shipment';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select 1/case when public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt',
 (select value from delivery_fixture_codes where shipment_id=:'quick_shipment'),:'quick_in_transit_version','00000000-0000-4000-8000-000000049244')->>'error'='delivery_receipt_code_unavailable'
 then 1 else 0 end as assert_expired_code_cannot_complete;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049203',true);
update delivery_fixture_codes set value=public.issue_shipment_receipt_confirmation(:'quick_shipment')->>'code' where shipment_id=:'quick_shipment';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049202',true);
select public.admin_record_shipment_delivery(:'quick_shipment','quick_receive',:'quick_receipt',
 (select value from delivery_fixture_codes where shipment_id=:'quick_shipment'),:'quick_in_transit_version','00000000-0000-4000-8000-000000049244');
select public.admin_update_shipment_status(:'parcel_shipment','shipping','hanjin','1234567890');
select public.admin_update_shipment_status(:'parcel_shipment','delivered',null,null);
select 1/case when (select status from public.orders where id=:'test_order')='delivered'
 and jsonb_array_length(public.admin_order_detail(:'test_order')->'shipments')=3
 and (select count(*) from jsonb_array_elements(public.admin_order_detail(:'test_order')->'shipments') row where row#>>'{delivery,method}' in ('quick','pickup'))=2
 and (public.order_claim_eligibility(:'test_order')->>'return')::boolean and not (public.order_claim_eligibility(:'test_order')->>'cancel')::boolean
 then 1 else 0 end as assert_all_methods_share_order_aggregate_and_existing_claims;
reset role;
select 1/case when (select count(*) from public.order_shipment_email_jobs where order_id=:'test_order')=1
 and exists(select 1 from public.order_shipment_email_jobs where shipment_id=:'parcel_shipment') then 1 else 0 end as assert_only_parcel_queues_tracking_email;
select 1/case when (select jsonb_build_object('total',total,'shippingFee',shipping_fee,'breakdown',shipping_fee_breakdown,'coupon',discount_total,'credit',store_credit_total)
 from public.orders where id=:'test_order')=:'financial_snapshot'::jsonb
 and (select jsonb_agg(jsonb_build_object('id',id,'fee',shipping_fee,'snapshot',shipping_fee_snapshot) order by id) from public.order_shipments where order_id=:'test_order')=:'shipment_fee_snapshot'::jsonb
 and (select count(*) from private.shipment_delivery_operations where shipment_id in (:'quick_shipment',:'pickup_shipment'))=5
 and not exists(select 1 from private.shipment_delivery_operations operation join delivery_fixture_codes code on code.shipment_id=operation.shipment_id
   where operation.evidence::text like '%'||code.value||'%')
 then 1 else 0 end as assert_fee_snapshot_and_exactly_once_evidence_preserved;
rollback;
