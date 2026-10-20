\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7160850-0000-4000-8000-000000000001','authenticated','authenticated','fulfillment-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('c7160850-0000-4000-8000-000000000002','authenticated','authenticated','fulfillment-check-buyer@example.test',now(),'{}','{}',now(),now()),
 ('c7160850-0000-4000-8000-000000000003','authenticated','authenticated','fulfillment-check-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 전달 방식 회귀 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='c7160850-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-8000-000000000002','c7160850-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('c7160850-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('fulfillment-check-ip','TEST 전달 방식 회귀 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c7160850-0000-4000-8000-000000000010','fulfillment-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('fulfillment-check-a','fulfillment-check-ip','TEST 상품 A','문구',10000,'ok',100,'c7160850-0000-4000-8000-000000000010','policy',0),
 ('fulfillment-check-b','fulfillment-check-ip','TEST 상품 B','문구',5000,'ok',100,'c7160850-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='fulfillment-check-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='fulfillment-check-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='fulfillment-check-ip';
select id as variant_a from public.goods_variants where good_id='fulfillment-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='fulfillment-check-b' and is_default \gset

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('c7160850-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('c7160850-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.fulfillment_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c7160850-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c7160850-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c7160850-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.production_values(days integer default 5) returns jsonb language sql as $$select jsonb_build_object('enabled',true,'leadDays',days,'dayBasis','calendar','closedDates','[]'::jsonb,'publicNote','TEST 결제 확인 후 제작','evidence','TEST 명시적 납기 설정','confirmed',true);$$;
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','c7160850-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST 제작 기본운임',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST production regional policy','unlistedDisposition','standard','feeUnit','per_shipment',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',true,'rules','[]'::jsonb),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
select jsonb_build_object('state','active','contactName','TEST 전달 담당','contactPhone','01000000000','handoffLocation','TEST 합성 수령 장소',
 'handoffInstructions','TEST 실제 전달 안내','appointmentInstructions','TEST 일정 확인','allowDelegate',false,'completionInstructions','TEST 일회 코드 확인',
 'cancellationInstructions','TEST 요청 접수 후 검토','approvalReference','TEST 이행 조건 확인') as method_policy \gset
select public.admin_save_delivery_policy('c7160850-0000-4000-8000-000000000010',method,null,:'method_policy',null) from unnest(array['quick','pickup','direct','freight','none'])method;
create function pg_temp.fulfillment_values(mode text,methods jsonb,files jsonb default '[]') returns jsonb language sql as $$select jsonb_build_object('mode',mode,'methods',methods,'assetIds',files,'publicNote','TEST 전달 계약 안내','evidence','TEST 명시적 선결제 비용 설정','confirmed',true);$$;
select '[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":1200},{"method":"quick","feeAmount":5000,"feeBasis":"per_order","installationFee":1200},{"method":"direct","feeAmount":2000,"feeBasis":"per_item","installationFee":500},{"method":"freight","feeAmount":8000,"feeBasis":"per_order","installationFee":500},{"method":"pickup","feeAmount":0,"feeBasis":"per_order","installationFee":0}]' as methods \gset
select public.admin_save_goods_fulfillment('fulfillment-check-a',pg_temp.fulfillment_values('shipping',:'methods'),0,'c7160850-0000-4002-8000-000000000001','c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-9000-000000000001') as saved \gset
select 1/case when public.admin_save_goods_fulfillment('fulfillment-check-a',pg_temp.fulfillment_values('shipping',:'methods'),0,'c7160850-0000-4002-8000-000000000001','c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-9000-000000000001')=:'saved'::jsonb then 1 else 0 end as settings_idempotent;
reset role;select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',2);
select public.set_cart_item_quantity('fulfillment-check-b',:'variant_b',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 전달 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',null,0) as blocked \gset
select 1/case when :'blocked'::jsonb#>>'{issues,0,code}'='delivery_choice_required' then 1 else 0 end as required_method_choice;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'expected_cart',:'address','{"fulfillment-check-a":{"method":"quick","paymentMode":"prepaid"}}',null,0) as quote \gset
select 1/case when :'quote'::jsonb#>>'{display,totals,onlineTotal}'='34400' and jsonb_array_length(:'quote'::jsonb#>'{display,shipping}')=2 then 1 else 0 end as same_origin_methods_split_exact_fees;
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,'c7160850-0000-4002-8000-000000000010','card') as order_id \gset
reset role;
select 1/case when(select count(distinct fulfillment_partition) from public.order_shipments where order_id=:'order_id')=2 and private.goods_transaction_snapshot_matches(:'order_id',34400,9400)
 and(select installation_fee=2400 and base_fee=5000 and total_fee=7400 from private.shipping_charge_components where order_id=:'order_id' and good_id='fulfillment-check-a') then 1 else 0 end as independent_method_ledgers;
-- A selected method or charge changed after quotation requires a new quote.
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',2);
select public.set_cart_item_quantity('fulfillment-check-b',:'variant_b',1);
reset role;
set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'expected_cart',:'address','{"fulfillment-check-a":{"method":"direct","paymentMode":"prepaid"}}',null,0) as direct_quote \gset
select 1/case when :'direct_quote'::jsonb#>>'{display,totals,onlineTotal}'='32000' then 1 else 0 end as direct_per_item_fee;
reset role;select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_save_goods_fulfillment('fulfillment-check-a',pg_temp.fulfillment_values('shipping',jsonb_set(:'methods'::jsonb,'{2,feeAmount}','2500')),1,gen_random_uuid(),'c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-9000-000000000001');
reset role;set local role service_role;
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)','c7160850-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'direct_quote'::jsonb->>'quoteId'),gen_random_uuid(),'card'),'transaction_quote_changed');
reset role;
-- Private file fixture checks the DB contract; real Storage upload/download is
-- separately exercised through the application endpoint.
insert into private.goods_digital_assets(id,actor_id,session_id,filename,mime_type,path,size_bytes,sha256,state,expires_at,verified_at)
 values('c7160850-0000-4003-8000-000000000001','c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-9000-000000000001','TEST 구매 파일.txt','text/plain',
 'c7160850-0000-4000-8000-000000000001/c7160850-0000-4003-8000-000000000001.txt',32,repeat('a',64),'verified',now()+interval '1 day',now());
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_save_goods_fulfillment('fulfillment-check-b',pg_temp.fulfillment_values('digital','[{"method":"digital","feeAmount":0,"feeBasis":"per_order","installationFee":0}]','["c7160850-0000-4003-8000-000000000001"]'),0,gen_random_uuid(),'c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-9000-000000000001');
reset role;set local role anon;
select 1/case when public.get_goods_transaction_offers_v3(array['fulfillment-check-b'])#>>'{0,fulfillment,files,0,name}'='TEST 구매 파일.txt'
 and public.get_goods_transaction_offers_v3(array['fulfillment-check-b'])::text!~'(sha256|private|session_id|evidence)' then 1 else 0 end as public_file_metadata_only;
reset role;select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',0);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as digital_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'digital_cart','{"kind":"none"}','{}',null,0) as digital_quote \gset
select 1/case when :'digital_quote'::jsonb#>>'{display,totals,onlineTotal}'='5000' and :'digital_quote'::jsonb#>>'{display,shipping,0,deliveryMethod}'='digital' then 1 else 0 end as no_address_no_delivery_fee;
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'digital_cart','{"kind":"none"}',(:'digital_quote'::jsonb->>'quoteId')::uuid,'c7160850-0000-4002-8000-000000000011','card') as digital_order \gset
reset role;
select 1/case when(select address is null and shipping_fee=0 from public.orders where id=:'digital_order') and private.goods_transaction_snapshot_matches(:'digital_order',5000,0)
 and(select fulfillment_terms_snapshot#>>'{files,0,id}'='c7160850-0000-4003-8000-000000000001' from public.order_items where order_id=:'digital_order') then 1 else 0 end as digital_contract_frozen;
select 1/case when private.digital_asset_referenced('c7160850-0000-4003-8000-000000000001') then 1 else 0 end as purchased_asset_not_cleanup_candidate;
select pg_temp.fulfillment_actor(1);set local role authenticated;
select 1/case when public.admin_get_order_downloads(:'digital_order')#>>'{items,0,files,0,providedCount}'='0'
 and public.admin_get_order_downloads(:'digital_order')#>'{items,0,files,0,firstProvidedAt}'='null'::jsonb then 1 else 0 end as admin_unprovided_file_evidence;
reset role;select pg_temp.fulfillment_actor(2);set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_get_order_downloads(%L)',:'digital_order'),'operator_capability_required');
reset role;

select 1/case when not has_table_privilege('authenticated','private.goods_digital_assets','select') and not has_function_privilege('authenticated','public.service_verify_digital_asset(uuid,uuid,uuid,text)','execute')
 and not(select public from storage.buckets where id='goods-digital-private') then 1 else 0 end as private_asset_boundary;
-- Installation remains prepaid even if the transport charge is collected.
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_save_shipping_collect_contract('c7160850-0000-4000-8000-000000000010',0,'active',
 '{"collectorName":"TEST 수납사","collectionMethod":"TEST 배송 시 지급","refundContact":"TEST 환급담당","customerInstructions":"TEST 합성 계약","contractReference":"TEST 계약","dispatchMappingReference":"TEST 인계","receiptReference":"TEST 영수증","disputeContact":"TEST 분쟁담당"}',
 'c7160850-0000-4002-8000-000000000020','c7160850-0000-4000-8000-000000000001');
select public.admin_save_good_transaction_terms('fulfillment-check-a',0,(select updated_at from public.goods where id='fulfillment-check-a'),null,
 '{"status":"active","paymentMode":"collect","quantityTerms":null,"draftValues":{}}','c7160850-0000-4002-8000-000000000021','c7160850-0000-4000-8000-000000000001');
reset role;select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',2);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as install_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'install_cart',:'address','{"fulfillment-check-a":{"method":"parcel","paymentMode":"collect"}}',null,0) as install_quote \gset
select 1/case when :'install_quote'::jsonb#>>'{display,totals,onlineTotal}'='22400' and :'install_quote'::jsonb#>>'{display,totals,collectShippingTotal}'='3000'
 and :'install_quote'::jsonb#>>'{display,shipping,0,components,0,installationFee}'='2400' then 1 else 0 end as installation_prepaid_transport_collect;
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'install_cart',:'address',(:'install_quote'::jsonb->>'quoteId')::uuid,'c7160850-0000-4002-8000-000000000022','card') as install_order \gset
reset role;
select 1/case when private.goods_transaction_snapshot_matches(:'install_order',22400,2400) and(select amount=3000 from private.shipping_collect_obligations where order_id=:'install_order') then 1 else 0 end as separate_installation_and_collect_ledgers;

-- Approved payment evidence and actual receiver confirmation are independent
-- of fixture order status. No external payment provider is contacted.
create function pg_temp.fulfillment_pay(target uuid) returns void language plpgsql as $$declare payment uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();begin
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) select payment,user_id,'order',id,'toss',total,'paid','fulfillment-paid-'||target from public.orders where id=target;
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select attempt,'toss',user_id,'order',id,total,'approved','fulfillment-attempt-'||target,'fulfillment-provider-'||target,'fulfillment-code-'||target,payment,now()+interval '1 hour' from public.orders where id=target;
 insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',now());
 update public.orders set status='paid' where id=target;
end $$;
select id as digital_item from public.order_items where order_id=:'digital_order' \gset
set local role service_role;
select pg_temp.transaction_expect_error(format('select public.service_get_digital_download_info(%L,%L,%L,%L)','c7160850-0000-4000-8000-000000000002','c7160850-0000-4000-9000-000000000002',:'digital_item','c7160850-0000-4003-8000-000000000001'),'digital_access_unavailable');
reset role;
select pg_temp.fulfillment_pay(:'digital_order');
select pg_temp.fulfillment_actor(2);set local role authenticated;
select 1/case when public.get_my_order_downloads(:'digital_order')#>>'{items,0,available}'='true' and not has_function_privilege('authenticated','public.service_get_digital_download_info(uuid,uuid,uuid,uuid)','execute') then 1 else 0 end as purchased_download_listing_without_private_paths;
reset role;set local role service_role;
select pg_temp.transaction_expect_error(format('select public.service_get_digital_download_info(%L,%L,%L,%L)','c7160850-0000-4000-8000-000000000003','c7160850-0000-4000-9000-000000000003',:'digital_item','c7160850-0000-4003-8000-000000000001'),'digital_access_unavailable');
select public.service_record_digital_download('c7160850-0000-4000-8000-000000000002','c7160850-0000-4000-9000-000000000002',:'digital_item','c7160850-0000-4003-8000-000000000001','c7160850-0000-4006-8000-000000000001',repeat('a',64)) as downloaded \gset
select 1/case when public.service_record_digital_download('c7160850-0000-4000-8000-000000000002','c7160850-0000-4000-9000-000000000002',:'digital_item','c7160850-0000-4003-8000-000000000001','c7160850-0000-4006-8000-000000000001',repeat('a',64))=:'downloaded'::jsonb then 1 else 0 end as downloaded_replay;
reset role;
select 1/case when(select count(*) from private.order_digital_downloads where order_id=:'digital_order')=1 and(select status='delivered' and delivered_at is not null from public.order_shipments where order_id=:'digital_order') and private.order_cancel_eligible(:'digital_order') then 1 else 0 end as file_provision_and_cancel_review;

select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_get_order_downloads(:'digital_order') as admin_downloads \gset
select 1/case when :'admin_downloads'::jsonb#>>'{items,0,files,0,providedCount}'='1'
 and (:'admin_downloads'::jsonb#>>'{items,0,files,0,firstProvidedAt}')::timestamptz=(:'downloaded'::jsonb->>'recordedAt')::timestamptz
 and (:'admin_downloads'::jsonb#>'{items,0,files,0}')-array['id','name','mimeType','size','providedCount','firstProvidedAt','lastProvidedAt']='{}'::jsonb
 then 1 else 0 end as admin_provision_matches_durable_receipt_without_private_fields;
reset role;select pg_temp.fulfillment_actor(2);
-- 2026-10-19: digital exchange is redownload/support/refund review only.
select pg_temp.fulfillment_actor(1);set local role authenticated;
select 1/case when public.admin_seller_claim_intake_context(:'digital_order')->>'digitalExchangeBlocked'='true'
 and public.admin_seller_claim_intake_context(:'digital_order')->'cancelBlockedReason'='null'::jsonb then 1 else 0 end as digital_admin_uses_cancel_review;
reset role;select pg_temp.fulfillment_actor(2);set local role authenticated;
select 1/case when public.order_claim_eligibility(:'digital_order')->>'exchange'='false'
 and public.order_claim_eligibility(:'digital_order')->>'cancel'='true' then 1 else 0 end as digital_exchange_not_available;
reset role;set local role service_role;
select 1/case when public.request_order_claim(:'digital_order','c7160850-0000-4000-8000-000000000002','exchange','TEST 파일 교환','defect')='not_claimable' then 1 else 0 end as digital_exchange_intake_rejected;
reset role;
select pg_temp.transaction_expect_error(format('insert into public.order_cancellation_requests(order_id,requested_by,claim_type,reason_type,reason,stage) values(%L,%L,%L,%L,%L,%L)',
 :'digital_order','c7160850-0000-4000-8000-000000000002','exchange','defect','TEST 파일 교환','requested'),'digital_exchange_unavailable');
savepoint digital_cancel_review;
set local role service_role;
select public.request_order_cancellation(:'digital_order','c7160850-0000-4000-8000-000000000002','TEST 파일 제공 후 취소 검토','change_of_mind') as digital_cancel \gset
select 1/case when :'digital_cancel'='requested' then 1 else 0 end as downloaded_cancel_not_auto_rejected;
select pg_temp.transaction_expect_error(format('select public.service_get_digital_download_info(%L,%L,%L,%L)','c7160850-0000-4000-8000-000000000002','c7160850-0000-4000-9000-000000000002',:'digital_item','c7160850-0000-4003-8000-000000000001'),'digital_access_unavailable');
reset role;
select 1/case when not exists(select 1 from public.refunds where cancellation_request_id in(select id from public.order_cancellation_requests where order_id=:'digital_order')) then 1 else 0 end as downloaded_cancel_requires_review;
rollback to digital_cancel_review;
savepoint digital_session_fence;
update auth.sessions set not_after=now()-interval '1 second' where id='c7160850-0000-4000-9000-000000000002';
set local role service_role;
select pg_temp.transaction_expect_error(format('select public.service_get_digital_download_info(%L,%L,%L,%L)','c7160850-0000-4000-8000-000000000002','c7160850-0000-4000-9000-000000000002',:'digital_item','c7160850-0000-4003-8000-000000000001'),'insufficient_privilege');
reset role;rollback to digital_session_fence;
-- Every explicit method uses its own frozen policy and matching transition.
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as method_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart',:'address','{"fulfillment-check-a":{"method":"quick","paymentMode":"prepaid"}}',null,0) as method_quote \gset
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart',:'address',(:'method_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as method_order \gset
reset role;select pg_temp.fulfillment_pay(:'method_order');
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_update_order_status(:'method_order','confirmed',null,null);
reset role;select id as method_shipment,updated_at as method_updated from public.order_shipments where order_id=:'method_order' \gset
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'method_shipment','shipping','hanjin','TESTINVALID1234'),'delivery_method_evidence_required');
select public.admin_record_shipment_delivery(:'method_shipment','quick_handoff',jsonb_build_object('operatorName','TEST 담당','providerName','TEST 배송사','providerPhone','01000000000','handoffReference','TEST 실제 인계','occurredAt',clock_timestamp()),null,:'method_updated',gen_random_uuid());
reset role;select updated_at as method_updated from public.order_shipments where id=:'method_shipment' \gset
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.issue_shipment_receipt_confirmation(:'method_shipment') as receipt \gset
reset role;select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_record_shipment_delivery(:'method_shipment','quick_receive',jsonb_build_object('operatorName','TEST 담당','recipientKind','self','receiptReference','TEST 실제 수령 확인','occurredAt',clock_timestamp()),:'receipt'::jsonb->>'code',:'method_updated',gen_random_uuid());
reset role;
select 1/case when(select status='delivered' and delivered_at is not null from public.order_shipments where id=:'method_shipment') then 1 else 0 end as quick_actual_receipt;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as method_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart',:'address','{"fulfillment-check-a":{"method":"direct","paymentMode":"prepaid"}}',null,0) as method_quote \gset
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart',:'address',(:'method_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as method_order \gset
reset role;select pg_temp.fulfillment_pay(:'method_order');
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_update_order_status(:'method_order','confirmed',null,null);
reset role;select id as method_shipment,updated_at as method_updated from public.order_shipments where order_id=:'method_order' \gset
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'method_shipment','shipping','hanjin','TESTINVALID1234'),'delivery_method_evidence_required');
select public.admin_record_shipment_delivery(:'method_shipment','direct_handoff',jsonb_build_object('operatorName','TEST 담당','providerName','TEST 배송사','providerPhone','01000000000','handoffReference','TEST 실제 인계','occurredAt',clock_timestamp()),null,:'method_updated',gen_random_uuid());
reset role;select updated_at as method_updated from public.order_shipments where id=:'method_shipment' \gset
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.issue_shipment_receipt_confirmation(:'method_shipment') as receipt \gset
reset role;select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_record_shipment_delivery(:'method_shipment','direct_receive',jsonb_build_object('operatorName','TEST 담당','recipientKind','self','receiptReference','TEST 실제 수령 확인','occurredAt',clock_timestamp()),:'receipt'::jsonb->>'code',:'method_updated',gen_random_uuid());
reset role;
select 1/case when(select status='delivered' and delivered_at is not null from public.order_shipments where id=:'method_shipment') then 1 else 0 end as direct_actual_receipt;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as method_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart',:'address','{"fulfillment-check-a":{"method":"freight","paymentMode":"prepaid"}}',null,0) as method_quote \gset
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart',:'address',(:'method_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as method_order \gset
reset role;select pg_temp.fulfillment_pay(:'method_order');
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_update_order_status(:'method_order','confirmed',null,null);
reset role;select id as method_shipment,updated_at as method_updated from public.order_shipments where order_id=:'method_order' \gset
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'method_shipment','shipping','hanjin','TESTINVALID1234'),'delivery_method_evidence_required');
select public.admin_record_shipment_delivery(:'method_shipment','freight_handoff',jsonb_build_object('operatorName','TEST 담당','providerName','TEST 배송사','providerPhone','01000000000','handoffReference','TEST 실제 인계','occurredAt',clock_timestamp()),null,:'method_updated',gen_random_uuid());
reset role;select updated_at as method_updated from public.order_shipments where id=:'method_shipment' \gset
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.issue_shipment_receipt_confirmation(:'method_shipment') as receipt \gset
reset role;select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_record_shipment_delivery(:'method_shipment','freight_receive',jsonb_build_object('operatorName','TEST 담당','recipientKind','self','receiptReference','TEST 실제 수령 확인','occurredAt',clock_timestamp()),:'receipt'::jsonb->>'code',:'method_updated',gen_random_uuid());
reset role;
select 1/case when(select status='delivered' and delivered_at is not null from public.order_shipments where id=:'method_shipment') then 1 else 0 end as freight_actual_receipt;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as method_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart','{"kind":"none"}','{"fulfillment-check-a":{"method":"pickup","paymentMode":"prepaid"}}',null,0) as method_quote \gset
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart','{"kind":"none"}',(:'method_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as method_order \gset
reset role;select pg_temp.fulfillment_pay(:'method_order');
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_update_order_status(:'method_order','confirmed',null,null);
reset role;select id as method_shipment,updated_at as method_updated from public.order_shipments where order_id=:'method_order' \gset
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'method_shipment','shipping','hanjin','TESTINVALID1234'),'delivery_method_evidence_required');
reset role;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.issue_shipment_receipt_confirmation(:'method_shipment') as receipt \gset
reset role;select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_record_shipment_delivery(:'method_shipment','pickup_receive',jsonb_build_object('operatorName','TEST 담당','recipientKind','self','receiptReference','TEST 실제 수령 확인','occurredAt',clock_timestamp()),:'receipt'::jsonb->>'code',:'method_updated',gen_random_uuid());
reset role;
select 1/case when(select status='delivered' and delivered_at is not null from public.order_shipments where id=:'method_shipment') then 1 else 0 end as pickup_actual_receipt;
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_save_goods_fulfillment('fulfillment-check-a',pg_temp.fulfillment_values('no_delivery','[{"method":"none","feeAmount":0,"feeBasis":"per_order","installationFee":0}]'),2,gen_random_uuid(),'c7160850-0000-4000-8000-000000000001','c7160850-0000-4000-9000-000000000001');
reset role;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.set_cart_item_quantity('fulfillment-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as method_cart from public.cart_items where user_id='c7160850-0000-4000-8000-000000000002' \gset
reset role;set local role service_role;
select public.quote_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart','{"kind":"none"}','{"fulfillment-check-a":{"method":"none","paymentMode":"prepaid"}}',null,0) as method_quote \gset
select public.place_cart_goods_transaction('c7160850-0000-4000-8000-000000000002',:'method_cart','{"kind":"none"}',(:'method_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as method_order \gset
reset role;select pg_temp.fulfillment_pay(:'method_order');
select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_update_order_status(:'method_order','confirmed',null,null);
reset role;select id as method_shipment,updated_at as method_updated from public.order_shipments where order_id=:'method_order' \gset
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'method_shipment','shipping','hanjin','TESTINVALID1234'),'delivery_method_evidence_required');
reset role;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.issue_shipment_receipt_confirmation(:'method_shipment') as receipt \gset
reset role;select pg_temp.fulfillment_actor(1);set local role authenticated;
select public.admin_record_shipment_delivery(:'method_shipment','none_receive',jsonb_build_object('operatorName','TEST 담당','recipientKind','self','receiptReference','TEST 실제 수령 확인','occurredAt',clock_timestamp()),:'receipt'::jsonb->>'code',:'method_updated',gen_random_uuid());
reset role;
select 1/case when(select status='delivered' and delivered_at is not null from public.order_shipments where id=:'method_shipment') then 1 else 0 end as none_actual_receipt;

-- Both shipping and dispatch read RPCs retain all newly supported methods.
select pg_temp.fulfillment_actor(1);set local role authenticated;
do $$declare method text;document jsonb;begin
 foreach method in array array['direct','freight','none','digital'] loop
  document:=public.admin_search_shipments_console(p_tab=>'delivered',p_method=>method);
  if (document->>'total')::integer<1 or exists(select 1 from jsonb_array_elements(document->'rows') row where row->'delivery'->>'method' is distinct from method) then
   raise exception 'Shipping filter lost or mixed method: %',method;end if;
  document:=public.admin_search_shipments_notice_console(p_tab=>'delivered',p_method=>method);
  if (document->>'total')::integer<1 or exists(select 1 from jsonb_array_elements(document->'rows') row where row->'delivery'->>'method' is distinct from method) then
   raise exception 'Dispatch filter lost or mixed method: %',method;end if;
 end loop;
end $$;
reset role;

update private.account_deletion_control set transaction_lookup_hmac_ready=true,legacy_transaction_evidence_ready=true,
 immutable_ticket_contract_ready=true,community_legal_records_ready=true,phase_one_enabled=true where singleton;
select pg_temp.fulfillment_actor(2);set local role authenticated;
select public.request_my_account_deletion('회원 탈퇴를 신청합니다','c7160850-0000-4007-8000-000000000001');
reset role;
select 1/case when exists(select 1 from private.account_deletion_legal_snapshots s join private.account_deletion_requests d on d.deletion_event_id=s.deletion_event_id
 where d.subject_user_id='c7160850-0000-4000-8000-000000000002' and s.record_type='order_fulfillment' and s.snapshot_data#>>'{provided,0,sha256}'=repeat('a',64)
 and s.snapshot_data::text!~'(sessionId|path|filename|publicNote|TEST)') then 1 else 0 end as fulfillment_evidence_minimized;
rollback;
