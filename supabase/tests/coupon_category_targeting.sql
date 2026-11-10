\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7160930-0000-4000-8000-000000000001','authenticated','authenticated','coupon-category-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('c7160930-0000-4000-8000-000000000002','authenticated','authenticated','coupon-category-check-buyer@example.test',now(),'{}','{}',now(),now()),
 ('c7160930-0000-4000-8000-000000000003','authenticated','authenticated','coupon-category-check-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 카테고리 쿠폰 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='c7160930-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-8000-000000000002','c7160930-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('c7160930-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('coupon-category-check-ip','TEST 카테고리 쿠폰 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c7160930-0000-4000-8000-000000000010','coupon-category-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('coupon-category-check-a','coupon-category-check-ip','TEST 상품 A','문구',10000,'ok',100,'c7160930-0000-4000-8000-000000000010','policy',0),
 ('coupon-category-check-b','coupon-category-check-ip','TEST 상품 B','문구',5000,'ok',100,'c7160930-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='coupon-category-check-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='coupon-category-check-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='coupon-category-check-ip';
select id as variant_a from public.goods_variants where good_id='coupon-category-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='coupon-category-check-b' and is_default \gset

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('c7160930-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('c7160930-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.coupon_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c7160930-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c7160930-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c7160930-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.production_values(days integer default 5) returns jsonb language sql as $$select jsonb_build_object('enabled',true,'leadDays',days,'dayBasis','calendar','closedDates','[]'::jsonb,'publicNote','TEST 결제 확인 후 제작','evidence','TEST 명시적 납기 설정','confirmed',true);$$;
select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_shipping_region_policy(null,jsonb_build_object('originId','c7160930-0000-4000-8000-000000000010','carrierCode','hanjin','name','TEST 제작 기본운임',
 'startsAt',now()-interval '1 day','endsAt',null,'openEnded',true,'sourceEvidence','TEST production regional policy','unlistedDisposition','standard','feeUnit','per_shipment',
 'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,'noRulesConfirmed',true,'rules','[]'::jsonb),null) as region \gset
select public.admin_set_shipping_region_policy_status((:'region'::jsonb->>'id')::uuid,'active',1,true);
select jsonb_build_object('state','active','contactName','TEST 전달 담당','contactPhone','01000000000','handoffLocation','TEST 합성 수령 장소',
 'handoffInstructions','TEST 실제 전달 안내','appointmentInstructions','TEST 일정 확인','allowDelegate',false,'completionInstructions','TEST 일회 코드 확인',
 'cancellationInstructions','TEST 요청 접수 후 검토','approvalReference','TEST 이행 조건 확인') as method_policy \gset
select public.admin_save_delivery_policy('c7160930-0000-4000-8000-000000000010',method,null,:'method_policy',null) from unnest(array['quick','pickup','direct','freight','none'])method;
create function pg_temp.fulfillment_values(mode text,methods jsonb,files jsonb default '[]') returns jsonb language sql as $$select jsonb_build_object('mode',mode,'methods',methods,'assetIds',files,'publicNote','TEST 전달 계약 안내','evidence','TEST 명시적 선결제 비용 설정','confirmed',true);$$;
select '[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":1200},{"method":"quick","feeAmount":5000,"feeBasis":"per_order","installationFee":1200},{"method":"direct","feeAmount":2000,"feeBasis":"per_item","installationFee":500},{"method":"freight","feeAmount":8000,"feeBasis":"per_order","installationFee":500},{"method":"pickup","feeAmount":0,"feeBasis":"per_order","installationFee":0}]' as methods \gset
select public.admin_save_goods_fulfillment('coupon-category-check-a',pg_temp.fulfillment_values('shipping',:'methods'),0,'c7160930-0000-4002-8000-000000000001','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001') as saved \gset
select 1/case when public.admin_save_goods_fulfillment('coupon-category-check-a',pg_temp.fulfillment_values('shipping',:'methods'),0,'c7160930-0000-4002-8000-000000000001','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001')=:'saved'::jsonb then 1 else 0 end as settings_idempotent;
reset role;select pg_temp.coupon_actor(2);set local role authenticated;
select public.set_cart_item_quantity('coupon-category-check-a',:'variant_a',2);
select public.set_cart_item_quantity('coupon-category-check-b',:'variant_b',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart from public.cart_items where user_id='c7160930-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 전달 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
reset role;

-- Parent/leaf and independent category fixtures. The new good is created AFTER the coupon.
insert into public.catalog_categories(id,code,name,parent_id,depth) values
 ('c7160930-0000-4007-8000-000000000001','coupon-category-root','TEST 쿠폰 카테고리',null,1),
 ('c7160930-0000-4007-8000-000000000002','coupon-category-leaf','TEST 하위 분류','c7160930-0000-4007-8000-000000000001',2),
 ('c7160930-0000-4007-8000-000000000003','coupon-category-other','TEST 다른 분류',null,1);
update public.goods set category_id=case id when 'coupon-category-check-a' then 'c7160930-0000-4007-8000-000000000002'::uuid else 'c7160930-0000-4007-8000-000000000003'::uuid end where ip_id='coupon-category-check-ip';
create function pg_temp.category_coupon(p_code text,p_kind text,p_mode text default 'targeted') returns jsonb language sql as $$select jsonb_build_object(
 'target_code',p_code,'target_name','TEST 카테고리 쿠폰','target_discount_type','percent','target_discount_value',case when p_kind='goods' then 10 else 100 end,
 'target_max_discount_amount',null,'target_min_subtotal',0,'target_starts_at',now()-interval '1 day','target_ends_at',now()+interval '7 days',
 'target_issue_starts_at',now()-interval '1 day','target_issue_ends_at',now()+interval '7 days','target_valid_days',null,
 'target_issue_limit',10,'target_status','active','target_grade_benefit',null,'target_previous_code',null,'target_expected_revision',null,
 'target_recipient_segment','all','target_goods_scope','selected_categories','target_good_ids','[]'::jsonb,
 'target_category_ids',jsonb_build_array('c7160930-0000-4007-8000-000000000001'),'target_issuance_mode',p_mode,'target_benefit_kind',p_kind,'target_stackable',true)$$;
select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_upsert_coupon_scheduled(pg_temp.category_coupon('CATEGORY-GOODS','goods'));
select public.admin_upsert_coupon_scheduled(pg_temp.category_coupon('CATEGORY-SHIPPING','shipping'));
select public.admin_upsert_coupon_scheduled(pg_temp.category_coupon('CATEGORY-CODE','goods','code'));
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.category_coupon('CATEGORY-EMPTY','goods')||'{"target_category_ids":[]}'),'coupon_category_scope_ready');
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.category_coupon('CATEGORY-GRADE','goods')||'{"target_grade_benefit":"silver"}'),'coupon_targeted_grade_exclusive');
select pg_temp.transaction_expect_error(format('select public.admin_upsert_coupon_scheduled(%L)',pg_temp.category_coupon('CATEGORY-MISSING','goods')||'{"target_category_ids":["c7160930-0000-4007-8000-000000000099"]}'),'coupon_target_category_unavailable');
select 1/case when public.admin_search_coupon_categories('TEST 쿠폰 카테고리')->>'total'='2' then 1 else 0 end as search_parent_and_descendant_path;
select 1/case when (select count(*) from public.admin_search_coupon_console_v3('CATEGORY','all',20,0,'{"segment":"targeted"}'))=2 then 1 else 0 end as filtered_targeted_definitions;
select 1/case when (select target_categories#>>'{0,path}' from public.admin_search_coupon_console_v3('CATEGORY-GOODS'))='TEST 쿠폰 카테고리' then 1 else 0 end as selected_category_readback;
select 1/case when jsonb_array_length(public.admin_marketing_coupon_options('CATEGORY')->'rows')=1 then 1 else 0 end as targeted_excluded_from_download_messages;
select public.admin_save_coupon_combination_policy('{"stackingEnabled":true,"maxGoodsCoupons":3,"shippingEnabled":true,"evidence":"TEST 카테고리 조합","confirmed":true}',1,'c7160930-0000-4009-8000-000000000001','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001');
reset role;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,category_id) values('coupon-category-new','coupon-category-check-ip','TEST 나중에 추가한 상품','문구',1000,'ok',10,'c7160930-0000-4007-8000-000000000002');
select 1/case when private.coupon_good_matches('selected_categories','{}',array['c7160930-0000-4007-8000-000000000001']::uuid[],'coupon-category-new') then 1 else 0 end as future_good_automatically_eligible;
select pg_temp.coupon_actor(2);set local role authenticated;
select pg_temp.transaction_expect_error('select public.claim_coupon_code(''CATEGORY-GOODS'')','coupon_designated_recipient_required');
select pg_temp.transaction_expect_error('select public.admin_search_coupon_categories()','operator_capability_required');
select public.claim_coupon_code('CATEGORY-CODE') as code_coupon \gset
reset role;select pg_temp.coupon_actor(1);set local role authenticated;
select jsonb_build_object('kind','customers','userIds',jsonb_build_array('c7160930-0000-4000-8000-000000000002')) as targets \gset
select public.admin_preview_coupon_issue('c7160930-0000-4010-8000-000000000001','CATEGORY-GOODS',:'targets','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001');
select 1/case when public.admin_execute_coupon_issue('c7160930-0000-4010-8000-000000000001','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001')->>'issuedCount'='1' then 1 else 0 end as explicit_customer_grant;
select public.admin_preview_coupon_issue('c7160930-0000-4010-8000-000000000002','CATEGORY-SHIPPING',:'targets','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001');
select public.admin_execute_coupon_issue('c7160930-0000-4010-8000-000000000002','c7160930-0000-4000-8000-000000000001','c7160930-0000-4000-9000-000000000001');
select 1/case when public.admin_benefit_report(now()-interval '1 day',now()+interval '1 day','CATEGORY','all','targeted')->'summary'->>'issued'='2' then 1 else 0 end as targeted_report_filter;
select 1/case when public.admin_benefit_issuances(now()-interval '1 day',now()+interval '1 day','CATEGORY','all','targeted','CATEGORY-GOODS')->>'totalCount'='1' and public.admin_benefit_issuances(now()-interval '1 day',now()+interval '1 day','CATEGORY','all','targeted','CATEGORY-CODE')->>'totalCount'='0' then 1 else 0 end as targeted_detail_filter;
reset role;
select id as goods_coupon from public.user_coupons where coupon_code='CATEGORY-GOODS' \gset
select id as shipping_coupon from public.user_coupons where coupon_code='CATEGORY-SHIPPING' \gset
select array[:'goods_coupon',:'shipping_coupon']::uuid[] as category_coupons \gset
select pg_temp.coupon_actor(2);set local role authenticated;
select 1/case when public.claim_coupon_code('CATEGORY-GOODS')=:'goods_coupon'::uuid then 1 else 0 end as held_coupon_read_is_idempotent;
reset role;
select pg_temp.transaction_expect_error('update public.coupons set issuance_mode=''code'' where code=''CATEGORY-GOODS''','coupon_issued_benefit_immutable');
select 1/case when not(private.marketing_coupon_document('CATEGORY-GOODS')->>'available')::boolean
 and not private.marketing_content_available('{"goodIds":[],"couponCode":"CATEGORY-GOODS"}') then 1 else 0 end as stale_message_coupon_download_disabled;
set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160930-0000-4000-8000-000000000002',:'expected_cart',:'address','{"coupon-category-check-a":{"method":"quick","paymentMode":"prepaid"}}',:'category_coupons',0) as category_quote \gset
select 1/case when :'category_quote'::jsonb#>>'{display,totals,couponDiscountTotal}'='2000'
 and :'category_quote'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='5000'
 and :'category_quote'::jsonb#>>'{display,totals,onlineTotal}'='27400' then 1 else 0 end as exact_category_goods_and_shipping;
reset role;
savepoint changed_category;
update public.goods set category_id='c7160930-0000-4007-8000-000000000003' where id='coupon-category-check-a';
set local role service_role;
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)','c7160930-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'category_quote'::jsonb->>'quoteId'),gen_random_uuid(),'card'),'transaction_quote_changed');
reset role;rollback to changed_category;
savepoint additional_category;
insert into public.goods_additional_categories(good_id,category_id) values('coupon-category-check-b','c7160930-0000-4007-8000-000000000002');
set local role service_role;
select public.quote_cart_goods_transaction_combined('c7160930-0000-4000-8000-000000000002',:'expected_cart',:'address','{"coupon-category-check-a":{"method":"quick","paymentMode":"prepaid"}}',:'category_coupons',0) as additional_quote \gset
select 1/case when :'additional_quote'::jsonb#>>'{display,totals,couponDiscountTotal}'='2500' and :'additional_quote'::jsonb#>>'{display,totals,shippingCouponDiscountTotal}'='7000' then 1 else 0 end as additional_category_eligible;
reset role;rollback to additional_category;
savepoint archived_category;
update public.catalog_categories set archived_at=now() where id='c7160930-0000-4007-8000-000000000001';
select 1/case when not private.coupon_good_matches('selected_categories','{}',array['c7160930-0000-4007-8000-000000000002']::uuid[],'coupon-category-check-a') then 1 else 0 end as archived_ancestor_excluded;
rollback to archived_category;
set local role service_role;
select public.place_cart_goods_transaction('c7160930-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'category_quote'::jsonb->>'quoteId')::uuid,'c7160930-0000-4002-8000-000000000010','card') as category_order \gset
reset role;
select 1/case when private.goods_transaction_snapshot_matches(:'category_order',27400,4400)
 and (select count(*) from public.coupon_redemptions where order_id=:'category_order' and status='applied')=2 then 1 else 0 end as immutable_category_receipt;
update public.orders set status='canceled' where id=:'category_order';
select 1/case when (select count(*) from public.user_coupons where id=any(:'category_coupons'::uuid[]) and status='active')=2
 and (select count(*) from public.coupon_redemptions where order_id=:'category_order' and status='released')=2 then 1 else 0 end as cancellation_restores_both;
select 1/case when not has_function_privilege('authenticated','private.coupon_good_matches(text,text[],uuid[],text)','execute')
 and not has_function_privilege('anon','public.admin_search_coupon_categories(text,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_coupon_console_v3(text,text,integer,integer,jsonb)','execute') then 1 else 0 end as category_roles_sealed;
rollback;
